using DroneLogger.Api.Contracts;
using DroneLogger.Api.Data;
using DroneLogger.Api.Domain;
using DroneLogger.Api.Services;
using Microsoft.EntityFrameworkCore;

namespace DroneLogger.Api.Endpoints;

public static class AircraftEndpoints
{
    private static readonly string[] AllowedTypes = ["Freestyle", "Racing", "Cinewhoop", "Long range", "Tiny whoop", "Other"];

    private record Row(Aircraft A, int TuneCount, DateTime? LastTuneAt);
    private record Fields(string Name, string Type, string PropSize, string Frame, string FlightController, string Battery, int? WeightGrams, string Notes);

    public static void MapAircraft(this IEndpointRouteBuilder app)
    {
        var g = app.MapGroup("/api/aircraft");
        g.MapGet("/", List);
        g.MapGet("/{id:int}", Get);
        g.MapPost("/", Create);
        g.MapPut("/{id:int}", Update);
        g.MapDelete("/{id:int}", Delete);
    }

    private static async Task<IResult> List(AppDbContext db, CancellationToken ct)
    {
        var rows = await Project(db.Fleet.AsNoTracking().OrderBy(a => a.Name)).ToListAsync(ct);
        return Results.Ok(rows.Select(ToDto));
    }

    private static async Task<IResult> Get(int id, AppDbContext db, CancellationToken ct)
    {
        var row = await Project(db.Fleet.AsNoTracking().Where(a => a.Id == id)).FirstOrDefaultAsync(ct);
        return row is null ? Results.NotFound() : Results.Ok(ToDto(row));
    }

    private static async Task<IResult> Create(HttpRequest req, AppDbContext db, ImageStore images, CancellationToken ct)
    {
        if (!req.HasFormContentType) return Results.BadRequest(new { error = "Send multipart/form-data." });
        var form = await req.ReadFormAsync(ct);

        var (fields, errors) = Parse(form);
        if (fields is null) return Results.ValidationProblem(errors);

        var aircraft = new Aircraft { CreatedAt = DateTime.UtcNow };
        Apply(aircraft, fields);

        if (form.Files["image"] is { } upload)
        {
            var (fileName, error) = await images.SaveAsync(upload, ct);
            if (error is not null) return ImageProblem(error);
            aircraft.ImageFileName = fileName;
        }

        try
        {
            db.Fleet.Add(aircraft);
            await db.SaveChangesAsync(ct);
        }
        catch
        {
            images.Delete(aircraft.ImageFileName);
            throw;
        }

        var row = await Project(db.Fleet.AsNoTracking().Where(a => a.Id == aircraft.Id)).FirstAsync(ct);
        return Results.Created($"/api/aircraft/{aircraft.Id}", ToDto(row));
    }

    private static async Task<IResult> Update(int id, HttpRequest req, AppDbContext db, ImageStore images, CancellationToken ct)
    {
        var aircraft = await db.Fleet.FindAsync([id], ct);
        if (aircraft is null) return Results.NotFound();
        if (!req.HasFormContentType) return Results.BadRequest(new { error = "Send multipart/form-data." });
        var form = await req.ReadFormAsync(ct);

        var (fields, errors) = Parse(form);
        if (fields is null) return Results.ValidationProblem(errors);
        Apply(aircraft, fields);

        string? replaced = null;
        string? added = null;
        if (form.Files["image"] is { } upload)
        {
            var (fileName, error) = await images.SaveAsync(upload, ct);
            if (error is not null) return ImageProblem(error);
            replaced = aircraft.ImageFileName;
            added = fileName;
            aircraft.ImageFileName = fileName;
        }
        else if (form["removeImage"] == "true")
        {
            replaced = aircraft.ImageFileName;
            aircraft.ImageFileName = null;
        }

        try
        {
            await db.SaveChangesAsync(ct);
        }
        catch
        {
            images.Delete(added);
            throw;
        }
        images.Delete(replaced);

        var row = await Project(db.Fleet.AsNoTracking().Where(a => a.Id == id)).FirstAsync(ct);
        return Results.Ok(ToDto(row));
    }

    private static async Task<IResult> Delete(int id, AppDbContext db, ImageStore images, CancellationToken ct)
    {
        var aircraft = await db.Fleet.FindAsync([id], ct);
        if (aircraft is null) return Results.NotFound();

        db.Fleet.Remove(aircraft); // tune snapshots and settings cascade
        await db.SaveChangesAsync(ct);
        images.Delete(aircraft.ImageFileName);
        return Results.NoContent();
    }

    // ---- helpers ----

    private static IQueryable<Row> Project(IQueryable<Aircraft> q) =>
        q.Select(a => new Row(
            a,
            a.Tunes.Count,
            a.Tunes.OrderByDescending(t => t.CreatedAt).Select(t => (DateTime?)t.CreatedAt).FirstOrDefault()));

    // Relative: the Angular app is served from the same origin (proxied to the API by `ng serve` in dev).
    private static AircraftDto ToDto(Row r) => new(
        r.A.Id, r.A.Name, r.A.Type, r.A.PropSize, r.A.Frame, r.A.FlightController, r.A.Battery,
        r.A.WeightGrams, r.A.Notes,
        r.A.ImageFileName is null ? null : $"/uploads/{r.A.ImageFileName}",
        r.A.CreatedAt, r.TuneCount, r.LastTuneAt);

    private static IResult ImageProblem(string error) =>
        Results.ValidationProblem(new Dictionary<string, string[]> { ["image"] = [error] });

    private static void Apply(Aircraft a, Fields f)
    {
        a.Name = f.Name; a.Type = f.Type; a.PropSize = f.PropSize; a.Frame = f.Frame;
        a.FlightController = f.FlightController; a.Battery = f.Battery; a.WeightGrams = f.WeightGrams; a.Notes = f.Notes;
    }

    private static (Fields? Fields, Dictionary<string, string[]> Errors) Parse(IFormCollection f)
    {
        var errors = new Dictionary<string, string[]>();

        string Text(string key, int max)
        {
            var v = f[key].ToString().Trim();
            if (v.Length > max) errors[key] = [$"Keep this under {max} characters."];
            return v;
        }

        var name = Text("name", 60);
        if (name.Length == 0) errors["name"] = ["Give this aircraft a name."];

        var type = Text("type", 20);
        if (!AllowedTypes.Contains(type)) errors["type"] = ["Pick one of the listed aircraft types."];

        var propSize = Text("propSize", 20);
        var frame = Text("frame", 80);
        var fc = Text("flightController", 80);
        var battery = Text("battery", 40);
        var notes = Text("notes", 2000);

        int? weight = null;
        var w = f["weightGrams"].ToString().Trim();
        if (w.Length > 0)
        {
            if (int.TryParse(w, out var grams) && grams is >= 1 and <= 100000) weight = grams;
            else errors["weightGrams"] = ["Enter the weight in whole grams."];
        }

        return errors.Count == 0
            ? (new Fields(name, type, propSize, frame, fc, battery, weight, notes), errors)
            : (null, errors);
    }
}
