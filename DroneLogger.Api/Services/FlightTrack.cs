using System.Globalization;
using System.Text;

namespace DroneLogger.Api.Services;

public record GpsSummary(double DistanceM, double MaxSpeedMs, double AvgSpeedMs, double MaxHeightM, double MaxDistanceM, double? HomeLat, double? HomeLon);

public record BatterySummary(int Cells, double StartV, double EndV, double MinV, double? MahUsed, double? PeakCurrentA, double? AvgCurrentA, double? PeakPowerW);

/// <summary>Turns a decoded log's GPS samples into flight stats and a compact track for the map.</summary>
public static class FlightTrack
{
    /// <summary>Enough for a smooth line on a map; a 7 minute flight at 10 Hz is ~4,300 samples.</summary>
    private const int MaxPoints = 3000;

    /// <summary>Null when the log has no usable GPS fix.</summary>
    public static (GpsSummary Summary, string Json)? Build(BlackboxLog log)
    {
        var gps = log.Gps;
        if (gps.Count < 2) return null;

        // Height is relative to this flight's takeoff, not the home point: Betaflight can keep home from an
        // earlier flight (gps_set_home_point_once), and GPS altitude drifts metres between flights.
        var baseAlt = gps.Take(10).Average(p => p.AltitudeM);
        (double Lat, double Lon) origin = log.Home ?? (gps[0].Lat, gps[0].Lon);

        double distance = 0, maxSpeed = 0, maxHeight = 0, maxFromHome = 0, movingSpeedSum = 0;
        var movingCount = 0;
        for (var i = 0; i < gps.Count; i++)
        {
            var p = gps[i];
            if (i > 0) distance += Haversine(gps[i - 1].Lat, gps[i - 1].Lon, p.Lat, p.Lon);
            maxSpeed = Math.Max(maxSpeed, p.SpeedMs);
            if (p.SpeedMs > 1) { movingSpeedSum += p.SpeedMs; movingCount++; } // average while moving, not while sitting on the pad
            maxHeight = Math.Max(maxHeight, p.AltitudeM - baseAlt);
            maxFromHome = Math.Max(maxFromHome, Haversine(origin.Lat, origin.Lon, p.Lat, p.Lon));
        }

        var stride = (int)Math.Ceiling(gps.Count / (double)MaxPoints);
        var t0 = log.FirstTimeUs; // same clock as the stick data, so playback lines up
        var sb = new StringBuilder();
        sb.Append("{\"home\":");
        sb.Append(log.Home is { } h ? $"[{F(h.Lat, 7)},{F(h.Lon, 7)}]" : "null");
        sb.Append(",\"points\":[");
        for (var i = 0; i < gps.Count; i += stride)
        {
            var p = gps[i];
            if (i > 0) sb.Append(',');
            // [seconds since log start, lat, lon, height above takeoff (m), ground speed (m/s)]
            sb.Append('[').Append(F((p.TimeUs - t0) / 1e6, 1)).Append(',').Append(F(p.Lat, 7)).Append(',').Append(F(p.Lon, 7))
              .Append(',').Append(F(p.AltitudeM - baseAlt, 1)).Append(',').Append(F(p.SpeedMs, 1)).Append(']');
        }
        sb.Append("]}");

        var avgSpeed = movingCount > 0 ? movingSpeedSum / movingCount : 0;
        var summary = new GpsSummary(Math.Round(distance), Math.Round(maxSpeed, 1), Math.Round(avgSpeed, 1), Math.Round(maxHeight, 1), Math.Round(maxFromHome),
            log.Home?.Lat, log.Home?.Lon);
        return (summary, sb.ToString());
    }

    /// <summary>{"points":[[t,roll,pitch,yaw,throttle],...]}, t in seconds since log start. Null without stick fields.</summary>
    public static string? BuildSticks(BlackboxLog log)
    {
        if (log.Sticks.Count == 0) return null;
        var sb = new StringBuilder("{\"points\":[");
        for (var i = 0; i < log.Sticks.Count; i++)
        {
            var s = log.Sticks[i];
            if (i > 0) sb.Append(',');
            sb.Append('[').Append(F((s.TimeUs - log.FirstTimeUs) / 1e6, 2)).Append(',').Append(s.Roll).Append(',').Append(s.Pitch)
              .Append(',').Append(s.Yaw).Append(',').Append(s.Throttle).Append(']');
        }
        return sb.Append("]}").ToString();
    }

    /// <summary>
    /// Pack stats and a 10 Hz series from vbatLatest (0.01 V) and amperageLatest (0.01 A).
    /// JSON: {"cells":4,"points":[[t,volts,amps|null],...]}, t in seconds since log start. Null without voltage.
    /// </summary>
    public static (BatterySummary Summary, string Json)? BuildBattery(BlackboxLog log)
    {
        var fields = log.MainFields.ToList();
        var vi = fields.IndexOf("vbatLatest");
        var ai = fields.IndexOf("amperageLatest");
        var samples = log.Samples;
        if (vi < 0 || samples.Count < 10) return null;

        double V(int k) => samples[k].Values[vi] / 100.0;
        double A(int k) => samples[k].Values[ai] / 100.0;
        var hasCurrent = ai >= 0;
        var seconds = Math.Max(1, (samples[^1].TimeUs - samples[0].TimeUs) / 1e6);
        var perSecond = Math.Max(1, (int)Math.Round(samples.Count / seconds));

        // Resting voltages from the first and last second; the low point from a 0.5 s average so one noisy sample
        // does not count as the minimum.
        var startV = Enumerable.Range(0, Math.Min(perSecond, samples.Count)).Average(V);
        var endV = Enumerable.Range(Math.Max(0, samples.Count - perSecond), Math.Min(perSecond, samples.Count)).Average(V);
        var window = Math.Max(1, perSecond / 2);
        double minV = double.MaxValue, sum = 0;
        for (var k = 0; k < samples.Count; k++)
        {
            sum += V(k);
            if (k >= window) sum -= V(k - window);
            if (k >= window - 1) minV = Math.Min(minV, sum / window);
        }

        double? mah = null, peakA = null, avgA = null, peakW = null;
        if (hasCurrent)
        {
            double ah = 0, maxA = 0, maxW = 0;
            for (var k = 1; k < samples.Count; k++)
                ah += A(k) * (samples[k].TimeUs - samples[k - 1].TimeUs) / 3.6e9; // amp-hours
            for (var k = 0; k < samples.Count; k++)
            {
                maxA = Math.Max(maxA, A(k));
                maxW = Math.Max(maxW, A(k) * V(k));
            }
            mah = Math.Round(ah * 1000);
            peakA = Math.Round(maxA, 1);
            avgA = Math.Round(Enumerable.Range(0, samples.Count).Average(A), 1);
            peakW = Math.Round(maxW);
        }

        var cells = CellCount(log, startV);
        var sb = new StringBuilder("{\"cells\":").Append(cells).Append(",\"points\":[");
        var next = long.MinValue;
        var first = true;
        for (var k = 0; k < samples.Count; k++)
        {
            if (samples[k].TimeUs < next) continue;
            next = (samples[k].TimeUs / 100_000 + 1) * 100_000; // even 10 Hz grid; plenty for a battery chart
            if (!first) sb.Append(',');
            first = false;
            sb.Append('[').Append(F((samples[k].TimeUs - log.FirstTimeUs) / 1e6, 1)).Append(',').Append(F(V(k), 2)).Append(',')
              .Append(hasCurrent ? F(A(k), 2) : "null").Append(']');
        }
        sb.Append("]}");

        var summary = new BatterySummary(cells, Math.Round(startV, 2), Math.Round(endV, 2), Math.Round(minV, 2), mah, peakA, avgA, peakW);
        return (summary, sb.ToString());
    }

    /// <summary>Same rule as Betaflight: cells = voltage at arming / max cell voltage, rounded down, plus one.</summary>
    private static int CellCount(BlackboxLog log, double startV)
    {
        var maxCell = 4.3;
        if (log.Headers.TryGetValue("vbatcellvoltage", out var cv) && cv.Split(',') is { Length: 3 } parts
            && int.TryParse(parts[2], out var maxCv) && maxCv > 0)
            maxCell = maxCv / 100.0;
        var armV = log.Headers.TryGetValue("vbatref", out var r) && int.TryParse(r, out var refCv) && refCv > 0 ? refCv / 100.0 : startV;
        return Math.Clamp((int)(armV / maxCell) + 1, 1, 12);
    }

    private static string F(double v, int decimals) => Math.Round(v, decimals).ToString(CultureInfo.InvariantCulture);

    private static double Haversine(double lat1, double lon1, double lat2, double lon2)
    {
        const double R = 6_371_000;
        var dLat = (lat2 - lat1) * Math.PI / 180;
        var dLon = (lon2 - lon1) * Math.PI / 180;
        var a = Math.Sin(dLat / 2) * Math.Sin(dLat / 2) +
                Math.Cos(lat1 * Math.PI / 180) * Math.Cos(lat2 * Math.PI / 180) * Math.Sin(dLon / 2) * Math.Sin(dLon / 2);
        return 2 * R * Math.Asin(Math.Sqrt(a));
    }
}
