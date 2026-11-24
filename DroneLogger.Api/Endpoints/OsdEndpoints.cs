using System.Globalization;
using System.Text.Json;
using DroneLogger.Api.Contracts;
using DroneLogger.Api.Domain;
using DroneLogger.Api.Services;
using Microsoft.AspNetCore.Mvc;

namespace DroneLogger.Api.Endpoints;

/// <summary>
/// LovelyOSD Editor and the Inspector send a blackbox log here to be read. Nothing is kept: the log is decoded in memory
/// and each armed session comes back with its stats and series. (GitDrone used to store flights too; the Flight class
/// and its table stay, untouched, but nothing reads or writes them any more.)
/// </summary>
public static class OsdEndpoints
{
    /// <summary>The largest log accepted.</summary>
    private const long MaxBytes = 64 * 1024 * 1024;
    /// <summary>What version of the decoded data a Flight holds (see Flight.DataVersion).</summary>
    private const int CurrentDataVersion = 9; // 2: sticks, 3: battery and average speed, 4: satellites and acceleration in the track, 5: RSSI and baro, 6: link quality, 7: RF mode, 8: gyro and accelerometer with the sticks, 9: the accelerometer per axis

    public static void MapOsd(this IEndpointRouteBuilder app)
    {
        app.MapPost("/api/osd/analyze", Analyze)
            .WithMetadata(new RequestSizeLimitAttribute(MaxBytes + 1024 * 1024)) // Kestrel's default is 30 MB
            .RequireRateLimiting("osd"); // open to visitors, so limited (Program.cs)
    }

    /// <summary>
    /// multipart/form-data: file. Decodes the log in memory and returns every armed session with the same stats and
    /// series a stored flight has. Nothing is written to the database or to disk.
    /// </summary>
    private static async Task<IResult> Analyze(HttpRequest req, CancellationToken ct)
    {
        if (!req.HasFormContentType) return Results.BadRequest(new { error = "Send multipart/form-data." });
        var form = await req.ReadFormAsync(ct);
        var file = form.Files["file"];
        if (file is null || file.Length == 0)
            return Results.ValidationProblem(new Dictionary<string, string[]> { ["file"] = ["Choose a blackbox log file."] });
        if (file.Length > MaxBytes)
            return Results.ValidationProblem(new Dictionary<string, string[]> { ["file"] = ["That log is over 64 MB."] });

        var bytes = await ReadAllAsync(file, ct);
        List<BlackboxLog> logs;
        try { logs = BlackboxDecoder.Decode(bytes); }
        catch (Exception) { logs = []; }
        if (logs.Count == 0) return NotALog();

        var now = DateTime.UtcNow;
        var name = OriginalName(file);
        var sessions = logs.Select(log =>
        {
            var x = NewFlight(log, name, now);
            var dto = new FlightDto(0, 0, "", null, null, null, x.OriginalFileName, x.LogIndex, x.StartedAt, x.DurationMs,
                x.FirmwareRevision, x.Board, x.AvgThrottlePercent, x.MaxThrottlePercent, x.CorruptFrames, x.CreatedAt,
                x.TrackJson != null, x.DistanceM, x.MaxSpeedMs, x.MaxHeightM, x.MaxDistanceM, x.SticksJson != null, x.AvgSpeedMs,
                x.CellCount == null ? null : new FlightBatteryDto(x.CellCount.Value, x.StartVoltage!.Value, x.EndVoltage!.Value,
                    x.MinVoltage!.Value, x.MahUsed, x.PeakCurrentA, x.AvgCurrentA, x.PeakPowerW),
                x.TelemetryJson != null, x.MinRssiPercent, x.MaxBaroHeightM);
            return new OsdSessionDto(dto, Json(x.TrackJson), Json(x.SticksJson), Json(x.BatteryJson), Json(x.TelemetryJson));
        }).ToList();
        return Results.Ok(new OsdAnalysisDto(name, sessions));

        static JsonElement? Json(string? s) => s is null ? null : JsonDocument.Parse(s).RootElement;
    }

    private static Flight WithLogData(this Flight flight, BlackboxLog log)
    {
        flight.SticksJson = FlightTrack.BuildSticks(log);
        var battery = FlightTrack.BuildBattery(log);
        var b = battery?.Summary;
        flight.BatteryJson = battery?.Json;
        flight.CellCount = b?.Cells;
        flight.StartVoltage = b?.StartV;
        flight.EndVoltage = b?.EndV;
        flight.MinVoltage = b?.MinV;
        flight.MahUsed = b?.MahUsed;
        flight.PeakCurrentA = b?.PeakCurrentA;
        flight.AvgCurrentA = b?.AvgCurrentA;
        flight.PeakPowerW = b?.PeakPowerW;
        var telemetry = FlightTrack.BuildTelemetry(log);
        flight.TelemetryJson = telemetry?.Json;
        flight.MinRssiPercent = telemetry?.Summary.MinRssiPercent;
        flight.MaxBaroHeightM = telemetry?.Summary.MaxBaroHeightM;
        flight.DataVersion = CurrentDataVersion;
        var track = FlightTrack.Build(log);
        var s = track?.Summary;
        flight.DistanceM = s?.DistanceM;
        flight.MaxSpeedMs = s?.MaxSpeedMs;
        flight.AvgSpeedMs = s?.AvgSpeedMs;
        flight.MaxHeightM = s?.MaxHeightM;
        flight.MaxDistanceM = s?.MaxDistanceM;
        flight.HomeLat = s?.HomeLat;
        flight.HomeLon = s?.HomeLon;
        flight.TrackJson = track?.Json;
        return flight;
    }

    /// <summary>A flight built from one decoded session: stats and series filled in, not linked to anything yet.</summary>
    private static Flight NewFlight(BlackboxLog log, string originalName, DateTime now) => new Flight
    {
        OriginalFileName = originalName,
        LogIndex = log.Index,
        StartedAt = StartTime(log),
        DurationMs = log.DurationMs,
        FirmwareRevision = Clamp(log.Headers.GetValueOrDefault("Firmware revision") ?? "", 80),
        Board = Clamp(log.Headers.GetValueOrDefault("Board information") ?? "", 80),
        AvgThrottlePercent = Round(log.AvgThrottlePercent),
        MaxThrottlePercent = Round(log.MaxThrottlePercent),
        CorruptFrames = log.CorruptFrames,
        CreatedAt = now,
    }.WithLogData(log);

    private static async Task<byte[]> ReadAllAsync(IFormFile file, CancellationToken ct)
    {
        await using var src = file.OpenReadStream();
        using var ms = new MemoryStream((int)file.Length);
        await src.CopyToAsync(ms, ct);
        return ms.ToArray();
    }

    private static string OriginalName(IFormFile file) => Clamp(Path.GetFileName(file.FileName), 120);

    private static IResult NotALog() => Results.ValidationProblem(new Dictionary<string, string[]>
    {
        ["file"] = ["This doesn't look like a Betaflight blackbox log (.bbl / .bfl), or it has no flight data."],
    });

    /// <summary>Each session has its own "Log start datetime". FCs without a clock write year 0000, which we drop.</summary>
    private static DateTime? StartTime(BlackboxLog log)
    {
        var raw = log.Headers.GetValueOrDefault("Log start datetime");
        if (raw is null || !DateTimeOffset.TryParse(raw, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal, out var dto))
            return null;
        return dto.Year < 2000 ? null : dto.UtcDateTime;
    }

    private static double? Round(double? v) => v is null ? null : Math.Round(v.Value, 1);

    private static string Clamp(string s, int max) => s.Length <= max ? s : s[..max];
}
