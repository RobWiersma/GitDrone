using System.Globalization;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Nodes;
using DroneLogger.Api.Contracts;
using DroneLogger.Api.Data;
using DroneLogger.Api.Domain;
using DroneLogger.Api.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace DroneLogger.Api.Endpoints;

public static class FlightEndpoints
{
    public static void MapFlights(this IEndpointRouteBuilder app)
    {
        var g = app.MapGroup("/api/aircraft/{aircraftId:int}/flights");
        g.MapGet("/", List);
        g.MapPost("/", Upload)
            .WithMetadata(new RequestSizeLimitAttribute(LogStore.MaxBytes + 1024 * 1024)); // Kestrel's default is 30 MB

        var f = app.MapGroup("/api/flights");
        f.MapGet("/", Feed);
        f.MapGet("/{id:int}", Get);
        f.MapGet("/{id:int}/track", Track);
        f.MapGet("/{id:int}/sticks", Sticks);
        f.MapGet("/{id:int}/battery", Battery);
        f.MapPost("/{id:int}/reprocess", Reprocess);
        f.MapPut("/{id:int}", Update);
        f.MapDelete("/{id:int}", Delete);

        // LovelyOSD: read a log for stats and an overlay without keeping anything.
        app.MapPost("/api/osd/analyze", Analyze)
            .WithMetadata(new RequestSizeLimitAttribute(LogStore.MaxBytes + 1024 * 1024));
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
        if (file.Length > LogStore.MaxBytes)
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
                    x.MinVoltage!.Value, x.MahUsed, x.PeakCurrentA, x.AvgCurrentA, x.PeakPowerW));
            return new OsdSessionDto(dto, Json(x.TrackJson), Json(x.SticksJson), Json(x.BatteryJson));
        }).ToList();
        return Results.Ok(new OsdAnalysisDto(name, sessions));

        static JsonElement? Json(string? s) => s is null ? null : JsonDocument.Parse(s).RootElement;
    }

    private static async Task<IResult> List(int aircraftId, AppDbContext db, CancellationToken ct)
    {
        if (!await db.Fleet.AnyAsync(a => a.Id == aircraftId, ct)) return Results.NotFound();
        var flights = await Project(db.Flights.AsNoTracking().Where(x => x.AircraftId == aircraftId)
            .OrderByDescending(x => x.StartedAt ?? x.CreatedAt).ThenByDescending(x => x.LogIndex))
            .ToListAsync(ct);
        return Results.Ok(flights);
    }

    private const int MaxPageSize = 100;

    /// <summary>Every aircraft's flights, newest first. Flights without a log date sort by upload time.</summary>
    private static async Task<IResult> Feed(int? skip, int? take, AppDbContext db, CancellationToken ct)
    {
        var s = Math.Max(0, skip ?? 0);
        var t = Math.Clamp(take ?? 50, 1, MaxPageSize);
        var page = await Project(db.Flights.AsNoTracking()
                .OrderByDescending(x => x.StartedAt ?? x.CreatedAt).ThenByDescending(x => x.LogIndex).ThenByDescending(x => x.Id)
                .Skip(s).Take(t + 1)) // one extra row tells us whether there's another page
            .ToListAsync(ct);
        return Results.Ok(new FlightFeedPage(page.Take(t).ToList(), page.Count > t));
    }

    private static async Task<IResult> Get(int id, AppDbContext db, CancellationToken ct)
    {
        var flight = await Project(db.Flights.AsNoTracking().Where(x => x.Id == id)).FirstOrDefaultAsync(ct);
        return flight is null ? Results.NotFound() : Results.Ok(flight);
    }

    /// <summary>multipart/form-data: file, tuneSnapshotId? ("" or missing = match by date), notes?</summary>
    private static async Task<IResult> Upload(int aircraftId, HttpRequest req, AppDbContext db, LogStore store, CancellationToken ct)
    {
        if (!await db.Fleet.AnyAsync(a => a.Id == aircraftId, ct)) return Results.NotFound();
        if (!req.HasFormContentType) return Results.BadRequest(new { error = "Send multipart/form-data." });
        var form = await req.ReadFormAsync(ct);

        var errors = new Dictionary<string, string[]>();
        var file = form.Files["file"];
        if (file is null || file.Length == 0) errors["file"] = ["Choose a blackbox log file."];
        else if (file.Length > LogStore.MaxBytes) errors["file"] = ["That log is over 64 MB."];

        var notes = form["notes"].ToString().Trim();
        if (notes.Length > 1000) errors["notes"] = ["Keep notes under 1000 characters."];

        int? tuneId = null;
        var tuneText = form["tuneSnapshotId"].ToString().Trim();
        if (tuneText.Length > 0)
        {
            if (int.TryParse(tuneText, out var t) && await db.TuneSnapshots.AnyAsync(s => s.Id == t && s.AircraftId == aircraftId, ct))
                tuneId = t;
            else errors["tuneSnapshotId"] = ["Pick one of this aircraft's tunes."];
        }
        if (errors.Count > 0) return Results.ValidationProblem(errors);

        var bytes = await ReadAllAsync(file!, ct);
        var hash = Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant();
        var existing = await Project(db.Flights.AsNoTracking().Where(x => x.AircraftId == aircraftId && x.FileHash == hash)
            .OrderBy(x => x.LogIndex)).ToListAsync(ct);
        if (existing.Count > 0) return Results.Ok(new FlightUploadResult(existing, true));

        List<BlackboxLog> logs;
        try { logs = BlackboxDecoder.Decode(bytes); }
        catch (Exception) { logs = []; }
        if (logs.Count == 0) return NotALog();

        // Tunes for date matching, oldest first.
        var tunes = tuneId is null
            ? await db.TuneSnapshots.AsNoTracking().Where(s => s.AircraftId == aircraftId)
                .OrderBy(s => s.CreatedAt).Select(s => new { s.Id, s.CreatedAt }).ToListAsync(ct)
            : [];

        var stored = await store.SaveAsync(bytes, ct);
        var now = DateTime.UtcNow;
        var originalName = OriginalName(file!);

        var flights = logs.Select(log =>
        {
            var flight = NewFlight(log, originalName, now);
            var when = flight.StartedAt ?? now;
            flight.AircraftId = aircraftId;
            // A tune applies to flights after it was saved. Fall back to the oldest tune for flights before any.
            flight.TuneSnapshotId = tuneId ?? tunes.LastOrDefault(t => t.CreatedAt <= when)?.Id ?? tunes.FirstOrDefault()?.Id;
            flight.Notes = notes.Length == 0 ? null : notes;
            flight.StoredFileName = stored;
            flight.FileHash = hash;
            return flight;
        }).ToList();

        try
        {
            db.Flights.AddRange(flights);
            await db.SaveChangesAsync(ct);
        }
        catch
        {
            store.Delete(stored);
            throw;
        }

        var ids = flights.Select(x => x.Id).ToList();
        var dtos = await Project(db.Flights.AsNoTracking().Where(x => ids.Contains(x.Id)).OrderBy(x => x.LogIndex)).ToListAsync(ct);
        return Results.Created($"/api/aircraft/{aircraftId}/flights", new FlightUploadResult(dtos, false));
    }

    /// <summary>
    /// The stored GPS track, or 404 when the flight has none. <paramref name="max"/> thins it to roughly that many
    /// points (always keeping the last), for thumbnails.
    /// </summary>
    private static async Task<IResult> Track(int id, int? max, AppDbContext db, LogStore store, CancellationToken ct)
    {
        await EnsureCurrentAsync(id, db, store, ct);
        var json = await db.Flights.AsNoTracking().Where(x => x.Id == id).Select(x => x.TrackJson).FirstOrDefaultAsync(ct);
        if (json is null) return Results.NotFound();
        if (max is not { } limit || limit < 2) return Results.Content(json, "application/json");

        var node = JsonNode.Parse(json)!;
        var points = node["points"]!.AsArray();
        if (points.Count > limit)
        {
            var stride = (int)Math.Ceiling(points.Count / (double)limit);
            var kept = new JsonArray();
            for (var i = 0; i < points.Count; i++)
                if (i % stride == 0 || i == points.Count - 1) kept.Add(points[i]!.DeepClone());
            node["points"] = kept;
        }
        return Results.Content(node.ToJsonString(), "application/json");
    }

    /// <summary>Stick positions for playback, or 404 when the log has no rcCommand fields.</summary>
    private static async Task<IResult> Sticks(int id, AppDbContext db, LogStore store, CancellationToken ct)
    {
        await EnsureCurrentAsync(id, db, store, ct);
        var json = await db.Flights.AsNoTracking().Where(x => x.Id == id).Select(x => x.SticksJson).FirstOrDefaultAsync(ct);
        return json is null ? Results.NotFound() : Results.Content(json, "application/json");
    }

    /// <summary>Pack voltage/current series, or 404 when the log has no battery fields.</summary>
    private static async Task<IResult> Battery(int id, AppDbContext db, LogStore store, CancellationToken ct)
    {
        await EnsureCurrentAsync(id, db, store, ct);
        var json = await db.Flights.AsNoTracking().Where(x => x.Id == id).Select(x => x.BatteryJson).FirstOrDefaultAsync(ct);
        return json is null ? Results.NotFound() : Results.Content(json, "application/json");
    }

    /// <summary>Bumped whenever WithLogData starts storing something new, so older flights rebuild themselves.</summary>
    private const int CurrentDataVersion = 4; // 2: sticks, 3: battery and average speed, 4: satellites and acceleration in the track

    /// <summary>Rebuilds track and sticks from the stored log when a flight predates the current data version.</summary>
    private static async Task EnsureCurrentAsync(int id, AppDbContext db, LogStore store, CancellationToken ct)
    {
        var flight = await db.Flights.FirstOrDefaultAsync(x => x.Id == id && x.DataVersion < CurrentDataVersion, ct);
        if (flight is null) return;
        var bytes = await store.ReadAsync(flight.StoredFileName, ct);
        var log = bytes is null ? null : BlackboxDecoder.Decode(bytes).FirstOrDefault(l => l.Index == flight.LogIndex);
        if (log is null) return; // file gone: keep whatever is stored
        flight.WithLogData(log);
        await db.SaveChangesAsync(ct);
    }

    /// <summary>Re-reads the stored log file, e.g. to pick up GPS for flights uploaded before the decoder handled it.</summary>
    private static async Task<IResult> Reprocess(int id, AppDbContext db, LogStore store, CancellationToken ct)
    {
        var flight = await db.Flights.FindAsync([id], ct);
        if (flight is null) return Results.NotFound();

        var bytes = await store.ReadAsync(flight.StoredFileName, ct);
        if (bytes is null) return Results.Problem("The original log file is no longer stored.", statusCode: 409);

        var log = BlackboxDecoder.Decode(bytes).FirstOrDefault(l => l.Index == flight.LogIndex);
        if (log is null) return Results.Problem("That session could not be read from the stored file.", statusCode: 409);

        flight.DurationMs = log.DurationMs;
        flight.AvgThrottlePercent = Round(log.AvgThrottlePercent);
        flight.MaxThrottlePercent = Round(log.MaxThrottlePercent);
        flight.CorruptFrames = log.CorruptFrames;
        flight.WithLogData(log);
        await db.SaveChangesAsync(ct);
        return Results.Ok(await Project(db.Flights.AsNoTracking().Where(x => x.Id == id)).FirstAsync(ct));
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

    private static async Task<IResult> Update(int id, FlightUpdateRequest body, AppDbContext db, CancellationToken ct)
    {
        var flight = await db.Flights.FindAsync([id], ct);
        if (flight is null) return Results.NotFound();

        var notes = body.Notes?.Trim();
        if (notes is { Length: > 1000 })
            return Results.ValidationProblem(new Dictionary<string, string[]> { ["notes"] = ["Keep notes under 1000 characters."] });
        if (body.TuneSnapshotId is { } t && !await db.TuneSnapshots.AnyAsync(s => s.Id == t && s.AircraftId == flight.AircraftId, ct))
            return Results.ValidationProblem(new Dictionary<string, string[]> { ["tuneSnapshotId"] = ["Pick one of this aircraft's tunes."] });

        flight.TuneSnapshotId = body.TuneSnapshotId;
        flight.Notes = string.IsNullOrEmpty(notes) ? null : notes;
        await db.SaveChangesAsync(ct);
        return Results.Ok(await Project(db.Flights.AsNoTracking().Where(x => x.Id == id)).FirstAsync(ct));
    }

    private static async Task<IResult> Delete(int id, AppDbContext db, LogStore store, CancellationToken ct)
    {
        var flight = await db.Flights.FindAsync([id], ct);
        if (flight is null) return Results.NotFound();

        db.Flights.Remove(flight);
        await db.SaveChangesAsync(ct);

        // Other sessions from the same upload keep the file alive.
        if (!await db.Flights.AnyAsync(x => x.StoredFileName == flight.StoredFileName, ct))
            store.Delete(flight.StoredFileName);
        return Results.NoContent();
    }

    // ---- helpers ----

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

    private static IQueryable<FlightDto> Project(IQueryable<Flight> q) =>
        q.Select(x => new FlightDto(
            x.Id, x.AircraftId, x.Aircraft!.Name, x.TuneSnapshotId, x.TuneSnapshot != null ? x.TuneSnapshot.Label : null, x.Notes,
            x.OriginalFileName, x.LogIndex, x.StartedAt, x.DurationMs, x.FirmwareRevision, x.Board,
            x.AvgThrottlePercent, x.MaxThrottlePercent, x.CorruptFrames, x.CreatedAt,
            x.TrackJson != null, x.DistanceM, x.MaxSpeedMs, x.MaxHeightM, x.MaxDistanceM,
            x.SticksJson != null || x.DataVersion < CurrentDataVersion, // old rows: find out on first request
            x.AvgSpeedMs,
            x.CellCount == null ? null : new FlightBatteryDto(x.CellCount.Value, x.StartVoltage!.Value, x.EndVoltage!.Value,
                x.MinVoltage!.Value, x.MahUsed, x.PeakCurrentA, x.AvgCurrentA, x.PeakPowerW)));

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
