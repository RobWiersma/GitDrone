using DroneLogger.Api.Contracts;
using DroneLogger.Api.Data;
using DroneLogger.Api.Domain;
using DroneLogger.Api.Services;
using Microsoft.EntityFrameworkCore;

namespace DroneLogger.Api.Endpoints;

public static class TuneEndpoints
{
    private const int MaxRawChars = 1_000_000;
    private const int MaxBulkItems = 500;

    public static void MapTunes(this IEndpointRouteBuilder app)
    {
        var g = app.MapGroup("/api/aircraft/{aircraftId:int}/tunes");
        g.MapGet("/", List);
        g.MapPost("/", Import);
        g.MapPost("/bulk", BulkImport);

        // Not nested under an aircraft: any two snapshots can be compared, including across drones.
        app.MapGet("/api/tunes/compare", Compare);
        app.MapGet("/api/tunes/{id:int}/raw", Raw);
    }

    /// <summary>The stored diff all text, already stripped of craft/pilot names and device IDs at import.</summary>
    private static async Task<IResult> Raw(int id, AppDbContext db, CancellationToken ct)
    {
        var raw = await db.TuneSnapshots.AsNoTracking().Where(t => t.Id == id).Select(t => t.RawText).FirstOrDefaultAsync(ct);
        return raw is null ? Results.NotFound() : Results.Ok(new TuneRawDto(id, raw));
    }

    private static async Task<IResult> Compare(int? from, int? to, AppDbContext db, CancellationToken ct)
    {
        if (from is null || to is null)
            return Results.ValidationProblem(new Dictionary<string, string[]> { ["from"] = ["Pass both from and to snapshot ids."] });

        var snapshots = await db.TuneSnapshots.AsNoTracking()
            .Where(t => t.Id == from || t.Id == to)
            .Include(t => t.Settings)
            .ToListAsync(ct);
        var a = snapshots.FirstOrDefault(t => t.Id == from);
        var b = snapshots.FirstOrDefault(t => t.Id == to);
        if (a is null || b is null) return Results.NotFound();

        var groups = TuneDiff.Compare(a.Settings, b.Settings, out var unchanged);
        var entries = groups.SelectMany(g => g.Changes).ToList();
        return Results.Ok(new TuneCompareResult(
            ToDto(a), ToDto(b),
            entries.Count(e => e.Kind == "changed"), entries.Count(e => e.Kind == "added"), entries.Count(e => e.Kind == "removed"),
            unchanged, groups));
    }

    private static TuneSnapshotDto ToDto(TuneSnapshot t) =>
        new(t.Id, t.AircraftId, t.Label, t.Notes, t.FirmwareVersion, t.Target, t.CreatedAt, t.Settings.Count, 0);

    private static async Task<IResult> List(int aircraftId, AppDbContext db, CancellationToken ct)
    {
        if (!await db.Fleet.AnyAsync(a => a.Id == aircraftId, ct)) return Results.NotFound();

        var tunes = await db.TuneSnapshots.AsNoTracking()
            .Where(t => t.AircraftId == aircraftId)
            .OrderByDescending(t => t.CreatedAt)
            .Select(t => new TuneSnapshotDto(t.Id, t.AircraftId, t.Label, t.Notes, t.FirmwareVersion, t.Target,
                t.CreatedAt, t.Settings.Count, db.Flights.Count(f => f.TuneSnapshotId == t.Id)))
            .ToListAsync(ct);
        return Results.Ok(tunes);
    }

    /// <summary>
    /// Imports many backups at once, oldest first, placing each at its own date in the history.
    /// A backup identical to the snapshot right before it in time is skipped, like a single import.
    /// </summary>
    private static async Task<IResult> BulkImport(int aircraftId, TuneBulkRequest body, AppDbContext db, CancellationToken ct)
    {
        if (!await db.Fleet.AnyAsync(a => a.Id == aircraftId, ct)) return Results.NotFound();
        var items = body.Items ?? [];
        if (items.Count == 0 || items.Count > MaxBulkItems)
            return Results.ValidationProblem(new Dictionary<string, string[]> { ["items"] = [$"Send between 1 and {MaxBulkItems} tunes."] });

        var now = DateTime.UtcNow;
        var results = new TuneBulkItemResult?[items.Count];
        var parsed = new List<(int Index, string Label, string? Notes, DateTime CreatedAt, ParsedTune Tune)>();

        for (var i = 0; i < items.Count; i++)
        {
            var item = items[i];
            var label = item.Label?.Trim() ?? "";
            var notes = item.Notes?.Trim();
            var raw = item.RawText ?? "";
            string? error = null;
            if (label.Length is 0 or > 80) error = "Labels must be 1 to 80 characters.";
            else if (notes is { Length: > 1000 }) error = "Keep notes under 1000 characters.";
            else if (raw.Length > MaxRawChars) error = "That text is too large to be a diff all dump.";

            ParsedTune? tune = null;
            if (error is null)
            {
                var result = TuneParser.Parse(raw);
                error = result.Error;
                tune = result.Tune;
            }
            if (error is not null || tune is null)
            {
                results[i] = new(i, "error", null, null, error);
                continue;
            }

            var created = item.CreatedAt is { } c ? DateTime.SpecifyKind(c.ToUniversalTime(), DateTimeKind.Utc) : now;
            if (created > now) created = now;
            parsed.Add((i, label, string.IsNullOrWhiteSpace(notes) ? null : notes, created, tune));
        }

        // Everything already in this aircraft's history, kept sorted by time as new snapshots are added.
        var history = (await db.TuneSnapshots.AsNoTracking()
                .Where(t => t.AircraftId == aircraftId)
                .Select(t => new { t.Id, t.CreatedAt, t.ContentHash })
                .ToListAsync(ct))
            .Select(t => (Id: (int?)t.Id, t.CreatedAt, Hash: t.ContentHash, Entity: (TuneSnapshot?)null))
            .OrderBy(t => t.CreatedAt).ToList();

        var pending = new List<(int Index, TuneSnapshot Snapshot)>();
        var duplicateOfNew = new Dictionary<int, TuneSnapshot>(); // request index -> snapshot added in this batch

        foreach (var p in parsed.OrderBy(p => p.CreatedAt).ThenBy(p => p.Index))
        {
            var before = history.LastOrDefault(h => h.CreatedAt <= p.CreatedAt);
            if (before.Hash == p.Tune.ContentHash)
            {
                results[p.Index] = new(p.Index, "duplicate", null, before.Id, null);
                if (before.Entity is not null) duplicateOfNew[p.Index] = before.Entity; // id known after saving
                continue;
            }

            var snapshot = new TuneSnapshot
            {
                AircraftId = aircraftId,
                Label = p.Label,
                Notes = p.Notes,
                FirmwareVersion = p.Tune.FirmwareVersion,
                Target = p.Tune.Target,
                CreatedAt = p.CreatedAt,
                RawText = p.Tune.SanitizedText,
                ContentHash = p.Tune.ContentHash,
                Settings = p.Tune.Settings.Select(s => new TuneSetting { Scope = s.Scope, Key = s.Key, Value = s.Value }).ToList(),
            };
            db.TuneSnapshots.Add(snapshot);
            var at = history.FindLastIndex(h => h.CreatedAt <= p.CreatedAt) + 1;
            history.Insert(at, (null, p.CreatedAt, p.Tune.ContentHash, snapshot));
            pending.Add((p.Index, snapshot));
        }

        await db.SaveChangesAsync(ct);

        foreach (var (index, snapshot) in pending)
            results[index] = new(index, "created", ToDto(snapshot), null, null);

        foreach (var (index, snapshot) in duplicateOfNew)
            results[index] = results[index]! with { DuplicateOf = snapshot.Id };

        return Results.Ok(results);
    }

    private static async Task<IResult> Import(int aircraftId, TuneImportRequest body, AppDbContext db, CancellationToken ct)
    {
        var errors = new Dictionary<string, string[]>();

        var label = body.Label?.Trim() ?? "";
        if (label.Length == 0) errors["label"] = ["Give this tune a label."];
        else if (label.Length > 80) errors["label"] = ["Keep the label under 80 characters."];

        var notes = body.Notes?.Trim();
        if (notes is { Length: > 1000 }) errors["notes"] = ["Keep notes under 1000 characters."];

        ParsedTune? parsed = null;
        var raw = body.RawText ?? "";
        if (raw.Length > MaxRawChars) errors["rawText"] = ["That text is too large to be a diff all dump."];
        else
        {
            var result = TuneParser.Parse(raw);
            if (result.Error is not null) errors["rawText"] = [result.Error];
            else parsed = result.Tune;
        }
        if (parsed is null || errors.Count > 0) return Results.ValidationProblem(errors);

        if (!await db.Fleet.AnyAsync(a => a.Id == aircraftId, ct)) return Results.NotFound();

        // Only the newest snapshot counts as a duplicate, so going back to an older tune still records an entry.
        var latest = await db.TuneSnapshots.AsNoTracking()
            .Where(t => t.AircraftId == aircraftId)
            .OrderByDescending(t => t.CreatedAt)
            .Select(t => new { t.Id, t.ContentHash })
            .FirstOrDefaultAsync(ct);

        if (latest is not null && latest.ContentHash == parsed.ContentHash)
        {
            var existing = await db.TuneSnapshots.AsNoTracking()
                .Where(t => t.Id == latest.Id)
                .Select(t => new TuneSnapshotDto(t.Id, t.AircraftId, t.Label, t.Notes, t.FirmwareVersion, t.Target,
                    t.CreatedAt, t.Settings.Count, 0))
                .FirstAsync(ct);
            return Results.Ok(new TuneImportResult(existing, latest.Id));
        }

        var snapshot = new TuneSnapshot
        {
            AircraftId = aircraftId,
            Label = label,
            Notes = string.IsNullOrWhiteSpace(notes) ? null : notes,
            FirmwareVersion = parsed.FirmwareVersion,
            Target = parsed.Target,
            CreatedAt = DateTime.UtcNow,
            RawText = parsed.SanitizedText,
            ContentHash = parsed.ContentHash,
            Settings = parsed.Settings.Select(s => new TuneSetting { Scope = s.Scope, Key = s.Key, Value = s.Value }).ToList(),
        };
        db.TuneSnapshots.Add(snapshot);
        await db.SaveChangesAsync(ct);

        var dto = new TuneSnapshotDto(snapshot.Id, aircraftId, snapshot.Label, snapshot.Notes, snapshot.FirmwareVersion,
            snapshot.Target, snapshot.CreatedAt, snapshot.Settings.Count, 0);
        return Results.Created($"/api/aircraft/{aircraftId}/tunes/{snapshot.Id}", new TuneImportResult(dto, null));
    }
}
