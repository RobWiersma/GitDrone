using System.Globalization;
using System.Text;

namespace DroneLogger.Api.Services;

public record GpsSample(long TimeUs, double Lat, double Lon, double AltitudeM, double SpeedMs, int Satellites);

/// <summary>Stick positions from rcCommand: roll/pitch/yaw are -500..500, throttle is 1000..2000 (Betaflight 4.x+).</summary>
public record StickSample(long TimeUs, int Roll, int Pitch, int Yaw, int Throttle);

/// <summary>Every main-frame field at 25 Hz, in MainFields order (raw firmware units).</summary>
public record MainSample(long TimeUs, int[] Values);

/// <summary>Slow-frame state change: flight mode bits, arming state, failsafe phase.</summary>
public record SlowSample(long TimeUs, long FlightModeFlags, long StateFlags, int FailsafePhase, bool RxSignal);

/// <summary>Event frames worth keeping. Data is the disarm reason or the new flight-mode flags.</summary>
public record LogEvent(long TimeUs, string Kind, long Data);

/// <summary>One armed session inside a .bbl file. A single file can hold several.</summary>
public record BlackboxLog(
    int Index,
    IReadOnlyDictionary<string, string> Headers,
    long FirstTimeUs,
    long LastTimeUs,
    int MainFrames,
    int CorruptFrames,
    double? AvgThrottlePercent,
    double? MaxThrottlePercent,
    (double Lat, double Lon)? Home,
    double? HomeAltitudeM,
    IReadOnlyList<GpsSample> Gps,
    IReadOnlyList<StickSample> Sticks,
    IReadOnlyList<string> MainFields,
    IReadOnlyList<MainSample> Samples,
    IReadOnlyList<SlowSample> Slow,
    IReadOnlyList<LogEvent> Events)
{
    public long DurationMs => Math.Max(0, (LastTimeUs - FirstTimeUs) / 1000);
}

/// <summary>
/// Decoder for Betaflight blackbox logs (.bbl/.bfl), ported from betaflight/blackbox-log-viewer
/// (flightlog_parser.js, decoders.js). Keeps the viewer's resync rules so corrupt frames are skipped the same way.
/// </summary>
public static class BlackboxDecoder
{
    private static readonly byte[] LogStart = "H Product:Blackbox flight data recorder by Nicholas Sherlock"u8.ToArray();

    public static List<BlackboxLog> Decode(byte[] data)
    {
        var starts = new List<int>();
        for (var i = data.AsSpan().IndexOf(LogStart); i >= 0;)
        {
            starts.Add(i);
            var next = data.AsSpan(i + 1).IndexOf(LogStart);
            i = next < 0 ? -1 : i + 1 + next;
        }

        var logs = new List<BlackboxLog>();
        for (var n = 0; n < starts.Count; n++)
        {
            var end = n + 1 < starts.Count ? starts[n + 1] : data.Length;
            var log = new LogParser(data, starts[n], end).Parse(n);
            if (log is not null) logs.Add(log);
        }
        return logs;
    }

    private const int PredZero = 0, PredPrevious = 1, PredStraightLine = 2, PredAverage2 = 3, PredMinThrottle = 4,
        PredMotor0 = 5, PredInc = 6, PredHomeCoord = 7, Pred1500 = 8, PredVbatRef = 9, PredLastMainFrameTime = 10,
        PredMinMotor = 11, PredHomeCoord1 = 256;

    private const int EncSignedVb = 0, EncUnsignedVb = 1, EncNeg14Bit = 3, EncTag8_8Svb = 6, EncTag2_3S32 = 7,
        EncTag8_4S16 = 8, EncNull = 9, EncTag2_3SVariable = 10;

    private const int EvSyncBeep = 0, EvAutotuneCycleStart = 10, EvAutotuneCycleResult = 11, EvAutotuneTargets = 12,
        EvInflightAdjustment = 13, EvLoggingResume = 14, EvDisarm = 15, EvGtuneCycleResult = 20, EvFlightMode = 30,
        EvTwitchTest = 40, EvLogEnd = 255;

    private const int MaxFrameLength = 256;
    private const long MaxTimeJump = 10 * 1_000_000;
    private const long MaxIterationJump = 500 * 10;
    private const int FieldIteration = 0, FieldTime = 1;

    private sealed class FrameDef
    {
        public string[] Names = [];
        public int[] Predictor = [];
        public int[] Encoding = [];
        public int Count => Names.Length;
        public int IndexOf(string name) => Array.IndexOf(Names, name);
    }

    private sealed class LogParser(byte[] data, int start, int end)
    {
        private int pos = start;
        private int streamEnd = end;
        private bool eof;

        private readonly Dictionary<string, string> headers = new(StringComparer.Ordinal);
        private readonly Dictionary<char, FrameDef> defs = new();
        private int dataVersion = 2;
        private int intervalI = 32, intervalPNum = 1, intervalPDenom = 1;
        private long minThrottle, minMotor, vbatRef;

        // Main frame history: prev = mainHistory[1], prev2 = mainHistory[2] in the viewer.
        private long[]? cur, prev, prev2;
        private bool mainValid;
        private long lastIteration = -1, lastTime = -1;
        private long lastSkipped;

        private long[] gpsHomeTmp = [];
        private long[] gpsHome = [];
        private bool gpsHomeValid;
        private long[] gpsTmp = [];
        private long[] slowTmp = [];
        private int? lastEvent;

        // Collected output
        private long firstTime = -1;
        private int mainFrames, corrupt;
        private int throttleIndex = -1;
        private double throttleSum;
        private long throttleCount;
        private long throttleMax = long.MinValue;
        private readonly List<GpsSample> gps = [];
        private readonly List<StickSample> sticks = [];
        private readonly List<MainSample> samples = [];
        private readonly List<SlowSample> slow = [];
        private readonly List<LogEvent> events = [];
        private int[] rcIndex = [];
        private long nextStickUs = long.MinValue;
        /// <summary>25 Hz: smooth enough to animate, small enough to store per flight.</summary>
        private const long StickIntervalUs = 40_000;

        public BlackboxLog? Parse(int index)
        {
            ParseHeader();
            if (!defs.TryGetValue('I', out var i) || i.Count < 2 || !defs.TryGetValue('P', out var p)) return null;
            p.Names = i.Names;
            if (p.Predictor.Length != i.Count || p.Encoding.Length != i.Count) return null;

            if (defs.TryGetValue('H', out var h) && defs.TryGetValue('G', out var g))
            {
                gpsHomeTmp = new long[h.Count];
                gpsHome = new long[h.Count];
                gpsTmp = new long[g.Count];
                for (var k = 1; k < g.Count; k++)
                    if (g.Predictor[k - 1] == PredHomeCoord && g.Predictor[k] == PredHomeCoord) g.Predictor[k] = PredHomeCoord1;
            }
            if (defs.TryGetValue('S', out var s)) slowTmp = new long[s.Count];

            throttleIndex = i.IndexOf("rcCommand[3]");
            rcIndex = [i.IndexOf("rcCommand[0]"), i.IndexOf("rcCommand[1]"), i.IndexOf("rcCommand[2]"), throttleIndex];
            if (rcIndex.Any(x => x < 0)) rcIndex = [];
            ParseData();

            if (mainFrames == 0) return null;

            (double, double)? home = null;
            double? homeAlt = null;
            if (defs.TryGetValue('H', out var hd) && gpsHomeValid)
            {
                var la = hd.IndexOf("GPS_home[0]");
                var lo = hd.IndexOf("GPS_home[1]");
                var al = hd.IndexOf("GPS_home[2]"); // newer firmware only
                if (la >= 0 && lo >= 0) home = (gpsHome[la] / 1e7, gpsHome[lo] / 1e7);
                if (al >= 0) homeAlt = gpsHome[al] / 10.0; // same decimetre units as GPS_altitude
            }

            return new BlackboxLog(index, headers, firstTime, lastTime, mainFrames, corrupt,
                throttleCount > 0 ? ThrottlePercent(throttleSum / throttleCount) : null,
                throttleCount > 0 ? ThrottlePercent(throttleMax) : null,
                home, homeAlt, gps, sticks, i.Names, samples, slow, events);
        }

        // rcCommand[3] runs 1000..2000 in Betaflight 4.x and later.
        private static double ThrottlePercent(double v) => Math.Clamp((v - 1000) / 10.0, 0, 100);

        // ---------- header ----------

        private void ParseHeader()
        {
            while (true)
            {
                var c = ReadByte();
                if (c < 0) break;
                if (c == 'H')
                {
                    ParseHeaderLine();
                }
                else if (IsFrameMarker(c))
                {
                    pos--;
                    eof = false;
                    break;
                }
            }
        }

        private void ParseHeaderLine()
        {
            // "H name:value\n" — the 'H' has been consumed.
            if (pos < streamEnd && data[pos] == ' ') pos++;
            var lineStart = pos;
            while (pos < streamEnd && data[pos] != '\n') pos++;
            var line = Encoding.Latin1.GetString(data, lineStart, pos - lineStart).TrimEnd('\r');
            if (pos < streamEnd) pos++;

            var colon = line.IndexOf(':');
            if (colon <= 0) return;
            var name = line[..colon];
            var value = line[(colon + 1)..];
            headers[name] = value;

            if (name.StartsWith("Field ") && name.Length > 8 && name[7] == ' ')
            {
                var def = defs.TryGetValue(name[6], out var d) ? d : defs[name[6]] = new FrameDef();
                switch (name[8..])
                {
                    case "name": def.Names = value.Split(','); break;
                    case "predictor": def.Predictor = Ints(value); break;
                    case "encoding": def.Encoding = Ints(value); break;
                }
                return;
            }

            switch (name)
            {
                case "Data version": dataVersion = Int(value, 2); break;
                case "I interval": intervalI = Math.Max(1, Int(value, 32)); break;
                case "P interval":
                    var slash = value.IndexOf('/');
                    if (slash < 0) { intervalPNum = 1; intervalPDenom = Math.Max(1, Int(value, 1)); }
                    else { intervalPNum = Int(value[..slash], 1); intervalPDenom = Math.Max(1, Int(value[(slash + 1)..], 1)); }
                    break;
                case "minthrottle": minThrottle = Int(value, 0); minMotor = minThrottle; break;
                case "motorOutput": minMotor = Ints(value).FirstOrDefault(); break;
                case "vbatref": vbatRef = Int(value, 0); break;
            }
        }

        private static int Int(string s, int fallback) =>
            int.TryParse(s.Trim(), NumberStyles.Integer, CultureInfo.InvariantCulture, out var v) ? v : fallback;

        private static int[] Ints(string s) => s.Split(',').Select(x => Int(x, 0)).ToArray();

        // ---------- data ----------

        private bool IsFrameMarker(int c) => c is 'I' or 'P' or 'G' or 'H' or 'S' or 'E';

        private void ParseData()
        {
            char? lastType = null;
            var frameStart = 0;
            var prematureEof = false;
            Invalidate();

            while (true)
            {
                var c = ReadByte();

                if (lastType is { } t)
                {
                    var size = pos - frameStart;
                    var looksComplete = (c >= 0 && IsFrameMarker(c)) || (!prematureEof && c < 0);
                    if (size <= MaxFrameLength && looksComplete)
                    {
                        Complete(t);
                    }
                    else
                    {
                        mainValid = false;
                        corrupt++;
                        pos = frameStart + 1;
                        lastType = null;
                        prematureEof = false;
                        eof = false;
                        continue;
                    }
                }

                if (c < 0) break;

                frameStart = pos - 1;
                var marker = (char)c;
                if (IsFrameMarker(c) && (marker == 'E' || defs.ContainsKey(marker)))
                {
                    lastType = marker;
                    ParseFrameOfType(marker);
                    if (eof) prematureEof = true;
                }
                else
                {
                    mainValid = false;
                    lastType = null;
                }
            }
        }

        private void Invalidate()
        {
            mainValid = false;
            prev = null;
            prev2 = null;
        }

        private void ParseFrameOfType(char t)
        {
            switch (t)
            {
                case 'I':
                    cur = new long[defs['I'].Count];
                    ParseFrame(defs['I'], cur, prev, null, 0);
                    break;
                case 'P':
                    cur = new long[defs['I'].Count];
                    lastSkipped = CountSkippedFrames();
                    ParseFrame(defs['P'], cur, prev, prev2, lastSkipped);
                    break;
                case 'G':
                    if (gpsTmp.Length > 0) ParseFrame(defs['G'], gpsTmp, null, null, 0);
                    break;
                case 'H':
                    if (gpsHomeTmp.Length > 0) ParseFrame(defs['H'], gpsHomeTmp, null, null, 0);
                    break;
                case 'S':
                    ParseFrame(defs['S'], slowTmp, null, null, 0);
                    break;
                case 'E':
                    ParseEvent();
                    break;
            }
        }

        private void Complete(char t)
        {
            switch (t)
            {
                case 'I': CompleteIntraframe(); break;
                case 'P': CompleteInterframe(); break;
                case 'H':
                    if (gpsHomeTmp.Length > 0) { Array.Copy(gpsHomeTmp, gpsHome, gpsHome.Length); gpsHomeValid = true; }
                    break;
                case 'G':
                    if (gpsHomeValid && gpsTmp.Length > 0) AddGps();
                    break;
                case 'S':
                    AddSlow();
                    break;
                case 'E':
                    if (lastEvent == EvLoggingResume) { /* lastIteration/lastTime already set while parsing */ }
                    break;
            }
        }

        private void CompleteIntraframe()
        {
            var accept = lastIteration == -1 ||
                (cur![FieldIteration] >= lastIteration && cur[FieldIteration] < lastIteration + MaxIterationJump &&
                 cur[FieldTime] >= lastTime && cur[FieldTime] < lastTime + MaxTimeJump);

            if (accept)
            {
                lastIteration = cur![FieldIteration];
                lastTime = cur[FieldTime];
                mainValid = true;
                Emit(cur);
            }
            else Invalidate();

            prev = cur;
            prev2 = cur;
        }

        private void CompleteInterframe()
        {
            if (mainValid && (cur![FieldTime] > lastTime + MaxTimeJump || cur[FieldIteration] > lastIteration + MaxIterationJump))
                mainValid = false;

            if (!mainValid) return; // a P frame can't resync the stream

            lastIteration = cur![FieldIteration];
            lastTime = cur[FieldTime];
            Emit(cur);
            prev2 = prev;
            prev = cur;
        }

        private void Emit(long[] frame)
        {
            mainFrames++;
            if (firstTime < 0) firstTime = frame[FieldTime];
            if (frame[FieldTime] >= nextStickUs)
            {
                samples.Add(new MainSample(frame[FieldTime], frame.Select(v => (int)v).ToArray()));
                if (rcIndex.Length == 4) sticks.Add(new StickSample(frame[FieldTime], (int)frame[rcIndex[0]], (int)frame[rcIndex[1]], (int)frame[rcIndex[2]], (int)frame[rcIndex[3]]));
                nextStickUs = (frame[FieldTime] / StickIntervalUs + 1) * StickIntervalUs; // even grid, no drift
            }
            if (throttleIndex >= 0)
            {
                var v = frame[throttleIndex];
                throttleSum += v;
                throttleCount++;
                if (v > throttleMax) throttleMax = v;
            }
        }

        private void AddSlow()
        {
            var d = defs['S'];
            long Get(string n) => d.IndexOf(n) is var k and >= 0 ? slowTmp[k] : 0;
            var next = new SlowSample(lastTime, Get("flightModeFlags"), Get("stateFlags"), (int)Get("failsafePhase"), Get("rxSignalReceived") != 0);
            var prev = slow.LastOrDefault();
            if (prev is null || prev with { TimeUs = next.TimeUs } != next) slow.Add(next); // keep changes only
        }

        private void AddGps()
        {
            var g = defs['G'];
            int Idx(string n) => g.IndexOf(n);
            long Get(int i) => i >= 0 ? gpsTmp[i] : 0;

            var lat = Get(Idx("GPS_coord[0]")) / 1e7;
            var lon = Get(Idx("GPS_coord[1]")) / 1e7;
            if (lat == 0 && lon == 0) return; // no fix yet
            if (Math.Abs(lat) > 90 || Math.Abs(lon) > 180) return;

            gps.Add(new GpsSample(
                Get(Idx("time")),
                lat, lon,
                Get(Idx("GPS_altitude")) / 10.0,  // decimetres
                Get(Idx("GPS_speed")) / 100.0,    // cm/s
                (int)Get(Idx("GPS_numSat"))));
        }

        private bool ShouldHaveFrame(long frameIndex) =>
            ((frameIndex % intervalI) + intervalPNum - 1) % intervalPDenom < intervalPNum;

        private long CountSkippedFrames()
        {
            if (lastIteration == -1) return 0;
            long count = 0;
            for (var i = lastIteration + 1; !ShouldHaveFrame(i) && count < MaxIterationJump; i++) count++;
            return count;
        }

        private void ParseFrame(FrameDef def, long[] current, long[]? previous, long[]? previous2, long skipped)
        {
            var values = new long[8];
            var i = 0;
            while (i < def.Count)
            {
                var predictor = i < def.Predictor.Length ? def.Predictor[i] : PredZero;
                var encoding = i < def.Encoding.Length ? def.Encoding[i] : EncNull;

                if (predictor == PredInc)
                {
                    current[i] = skipped + 1 + (previous?[i] ?? 0);
                    i++;
                    continue;
                }

                switch (encoding)
                {
                    case EncTag8_4S16:
                        if (dataVersion < 2) ReadTag8_4S16V1(values); else ReadTag8_4S16V2(values);
                        for (var j = 0; j < 4 && i < def.Count; j++, i++)
                            current[i] = Predict(def, i, values[j], current, previous, previous2);
                        continue;
                    case EncTag2_3S32:
                        ReadTag2_3S32(values);
                        for (var j = 0; j < 3 && i < def.Count; j++, i++)
                            current[i] = Predict(def, i, values[j], current, previous, previous2);
                        continue;
                    case EncTag2_3SVariable:
                        ReadTag2_3SVariable(values);
                        for (var j = 0; j < 3 && i < def.Count; j++, i++)
                            current[i] = Predict(def, i, values[j], current, previous, previous2);
                        continue;
                    case EncTag8_8Svb:
                        var groupCount = 1;
                        while (i + groupCount < def.Count && groupCount < 8 && def.Encoding[i + groupCount] == EncTag8_8Svb) groupCount++;
                        ReadTag8_8Svb(values, groupCount);
                        for (var j = 0; j < groupCount; j++, i++)
                            current[i] = Predict(def, i, values[j], current, previous, previous2);
                        continue;
                }

                long value = encoding switch
                {
                    EncSignedVb => ReadSignedVb(),
                    EncUnsignedVb => ReadUnsignedVb(),
                    EncNeg14Bit => -SignExtend((long)ReadUnsignedVb(), 14),
                    _ => 0, // EncNull and unknown encodings
                };
                current[i] = Predict(def, i, value, current, previous, previous2);
                i++;
            }
        }

        private long Predict(FrameDef def, int i, long value, long[] current, long[]? previous, long[]? previous2)
        {
            var predictor = i < def.Predictor.Length ? def.Predictor[i] : PredZero;
            switch (predictor)
            {
                case PredZero: return value;
                case PredMinThrottle: return value + minThrottle;
                case PredMinMotor: return value + minMotor;
                case Pred1500: return value + 1500;
                case PredMotor0:
                    var m0 = defs['I'].IndexOf("motor[0]");
                    return m0 >= 0 ? value + current[m0] : value;
                case PredVbatRef: return value + vbatRef;
                case PredPrevious: return previous is null ? value : value + previous[i];
                case PredStraightLine: return previous is null ? value : value + 2 * previous[i] - previous2![i];
                case PredAverage2:
                    // Truncates toward zero like the C firmware and the JS viewer.
                    return previous is null ? value : value + (previous[i] + previous2![i]) / 2;
                case PredHomeCoord: return value + HomeValue("GPS_home[0]");
                case PredHomeCoord1: return value + HomeValue("GPS_home[1]");
                case PredLastMainFrameTime: return prev is null ? value : value + prev[FieldTime];
                default: return value;
            }
        }

        private long HomeValue(string name)
        {
            if (!defs.TryGetValue('H', out var h)) return 0;
            var idx = h.IndexOf(name);
            return idx >= 0 ? gpsHome[idx] : 0;
        }

        // ---------- events ----------

        private void ParseEvent()
        {
            var type = ReadByte();
            lastEvent = type;
            switch (type)
            {
                case EvSyncBeep: ReadUnsignedVb(); break;
                case EvFlightMode:
                    var flags = ReadUnsignedVb();
                    ReadUnsignedVb();
                    events.Add(new LogEvent(lastTime, "flightMode", flags));
                    break;
                case EvDisarm:
                    events.Add(new LogEvent(lastTime, "disarm", ReadUnsignedVb()));
                    break;
                case EvAutotuneCycleStart: Skip(5); break;
                case EvAutotuneCycleResult: Skip(4); break;
                case EvAutotuneTargets: Skip(8); break;
                case EvGtuneCycleResult: ReadByte(); ReadSignedVb(); Skip(2); break;
                case EvInflightAdjustment:
                    var func = ReadByte();
                    if (func < 128) ReadSignedVb(); else Skip(4);
                    break;
                case EvTwitchTest: ReadByte(); Skip(4); break;
                case EvLoggingResume:
                    lastIteration = ReadUnsignedVb();
                    lastTime = ReadUnsignedVb();
                    break;
                case EvLogEnd:
                    const string message = "End of log\0";
                    var ok = pos + message.Length <= streamEnd &&
                             Encoding.Latin1.GetString(data, pos, message.Length) == message;
                    if (ok)
                    {
                        pos += message.Length;
                        streamEnd = pos; // this log is done
                    }
                    else lastEvent = null;
                    break;
                default:
                    lastEvent = null;
                    break;
            }
        }

        // ---------- primitive readers (mirror datastream.js / decoders.js) ----------

        private int ReadByte()
        {
            if (pos >= streamEnd) { eof = true; return -1; }
            return data[pos++];
        }

        private int ReadByteOrZero() => Math.Max(0, ReadByte());

        private void Skip(int n) { for (var k = 0; k < n; k++) ReadByte(); }

        private uint ReadUnsignedVb()
        {
            uint result = 0;
            var shift = 0;
            for (var i = 0; i < 5; i++)
            {
                var b = ReadByte();
                if (b < 0) return 0;
                result |= (uint)(b & 0x7F) << shift;
                if (b < 128) return result;
                shift += 7;
            }
            return 0;
        }

        private int ReadSignedVb()
        {
            var u = ReadUnsignedVb();
            return (int)(u >> 1) ^ -(int)(u & 1);
        }

        private static long SignExtend(long v, int bits)
        {
            var shift = 64 - bits;
            return (v << shift) >> shift;
        }

        private void ReadTag2_3S32(long[] values)
        {
            var lead = ReadByteOrZero();
            switch (lead >> 6)
            {
                case 0:
                    values[0] = SignExtend((lead >> 4) & 0x03, 2);
                    values[1] = SignExtend((lead >> 2) & 0x03, 2);
                    values[2] = SignExtend(lead & 0x03, 2);
                    break;
                case 1:
                    values[0] = SignExtend(lead & 0x0F, 4);
                    lead = ReadByteOrZero();
                    values[1] = SignExtend(lead >> 4, 4);
                    values[2] = SignExtend(lead & 0x0F, 4);
                    break;
                case 2:
                    values[0] = SignExtend(lead & 0x3F, 6);
                    values[1] = SignExtend(ReadByteOrZero() & 0x3F, 6);
                    values[2] = SignExtend(ReadByteOrZero() & 0x3F, 6);
                    break;
                case 3:
                    ReadVariableTriple(lead, values);
                    break;
            }
        }

        private void ReadTag2_3SVariable(long[] values)
        {
            // Bit layouts follow the firmware encoder; the JS viewer has typos in cases 1 and 2.
            var lead = ReadByteOrZero();
            switch (lead >> 6)
            {
                case 0:
                    values[0] = SignExtend((lead >> 4) & 0x03, 2);
                    values[1] = SignExtend((lead >> 2) & 0x03, 2);
                    values[2] = SignExtend(lead & 0x03, 2);
                    break;
                case 1: // ss11 1112 2222 3333
                {
                    values[0] = SignExtend((lead & 0x3E) >> 1, 5);
                    var b = ReadByteOrZero();
                    values[1] = SignExtend(((lead & 0x01) << 4) | (b >> 4), 5);
                    values[2] = SignExtend(b & 0x0F, 4);
                    break;
                }
                case 2: // ss11 1111 1122 2222 2333 3333
                {
                    var b1 = ReadByteOrZero();
                    var b2 = ReadByteOrZero();
                    values[0] = SignExtend(((lead & 0x3F) << 2) | (b1 >> 6), 8);
                    values[1] = SignExtend(((b1 & 0x3F) << 1) | (b2 >> 7), 7);
                    values[2] = SignExtend(b2 & 0x7F, 7);
                    break;
                }
                case 3:
                    ReadVariableTriple(lead, values);
                    break;
            }
        }

        private void ReadVariableTriple(int lead, long[] values)
        {
            for (var i = 0; i < 3; i++)
            {
                switch (lead & 0x03)
                {
                    case 0: values[i] = SignExtend(ReadByteOrZero(), 8); break;
                    case 1: values[i] = SignExtend(ReadByteOrZero() | (ReadByteOrZero() << 8), 16); break;
                    case 2: values[i] = SignExtend(ReadByteOrZero() | (ReadByteOrZero() << 8) | (ReadByteOrZero() << 16), 24); break;
                    case 3: values[i] = (int)(ReadByteOrZero() | (ReadByteOrZero() << 8) | (ReadByteOrZero() << 16) | (ReadByteOrZero() << 24)); break;
                }
                lead >>= 2;
            }
        }

        private void ReadTag8_4S16V1(long[] values)
        {
            var selector = ReadByteOrZero();
            for (var i = 0; i < 4; i++)
            {
                switch (selector & 0x03)
                {
                    case 0: values[i] = 0; break;
                    case 1:
                        var combined = ReadByteOrZero();
                        values[i] = SignExtend(combined & 0x0F, 4);
                        i++;
                        selector >>= 2;
                        if (i < 4) values[i] = SignExtend(combined >> 4, 4);
                        break;
                    case 2: values[i] = SignExtend(ReadByteOrZero(), 8); break;
                    case 3: values[i] = SignExtend(ReadByteOrZero() | (ReadByteOrZero() << 8), 16); break;
                }
                selector >>= 2;
            }
        }

        private void ReadTag8_4S16V2(long[] values)
        {
            var selector = ReadByteOrZero();
            var nibbleIndex = 0;
            var buffer = 0;
            for (var i = 0; i < 4; i++)
            {
                switch (selector & 0x03)
                {
                    case 0: values[i] = 0; break;
                    case 1:
                        if (nibbleIndex == 0)
                        {
                            buffer = ReadByteOrZero();
                            values[i] = SignExtend(buffer >> 4, 4);
                            nibbleIndex = 1;
                        }
                        else
                        {
                            values[i] = SignExtend(buffer & 0x0F, 4);
                            nibbleIndex = 0;
                        }
                        break;
                    case 2:
                        if (nibbleIndex == 0) values[i] = SignExtend(ReadByteOrZero(), 8);
                        else
                        {
                            var c1 = (buffer & 0x0F) << 4;
                            buffer = ReadByteOrZero();
                            values[i] = SignExtend(c1 | (buffer >> 4), 8);
                        }
                        break;
                    case 3:
                        if (nibbleIndex == 0)
                        {
                            var c1 = ReadByteOrZero();
                            var c2 = ReadByteOrZero();
                            values[i] = SignExtend((c1 << 8) | c2, 16);
                        }
                        else
                        {
                            var c1 = ReadByteOrZero();
                            var c2 = ReadByteOrZero();
                            values[i] = SignExtend(((buffer & 0x0F) << 12) | (c1 << 4) | (c2 >> 4), 16);
                            buffer = c2;
                        }
                        break;
                }
                selector >>= 2;
            }
        }

        private void ReadTag8_8Svb(long[] values, int count)
        {
            if (count == 1)
            {
                values[0] = ReadSignedVb();
                return;
            }
            var header = ReadByteOrZero();
            for (var i = 0; i < 8; i++, header >>= 1)
                values[i] = (header & 0x01) != 0 ? ReadSignedVb() : 0;
        }
    }
}
