using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using DroneLogger.Api.Data;
using DroneLogger.Api.Domain;
using DroneLogger.Api.Services;
using Microsoft.EntityFrameworkCore;

namespace DroneLogger.Api.Endpoints;

/// <summary>Referrer is the site the visitor arrived from (hostname only), sent with the first page of a visit.</summary>
public record VisitRequest(string? Path, string? Referrer);
public record DayVisitorsDto(DateOnly Day, int Visitors);
public record PageVisitorsDto(string Path, int Visitors);
/// <summary>Source is a site name ("LinkedIn", "github.com") or "Direct" for typed addresses, bookmarks and apps that send none.</summary>
public record ReferrerVisitorsDto(string Source, int Visitors);
/// <summary>Daily unique visitors over the period, and per page how many visitor-days opened it.</summary>
public record VisitStatsDto(int Days, int Today, int Total, IReadOnlyList<DayVisitorsDto> Daily, IReadOnlyList<PageVisitorsDto> Pages,
    IReadOnlyList<ReferrerVisitorsDto> Referrers);

/// <summary>
/// Privacy-friendly visit counting: no cookies, no IP addresses stored. Each visitor is a hash of IP and browser with a
/// secret that changes every day and is thrown away afterwards, so a hash means nothing once its day is over.
/// </summary>
public static partial class VisitEndpoints
{
    public static void MapVisits(this IEndpointRouteBuilder app)
    {
        app.MapPost("/api/visit", Record);
        app.MapGet("/api/stats/visits", Stats);
    }

    /// <summary>Called by the site on each page change. Always 204, so it never gets in the way of the page.</summary>
    private static async Task<IResult> Record(VisitRequest body, HttpContext http, AppDbContext db, CancellationToken ct)
    {
        var agent = http.Request.Headers.UserAgent.ToString();
        // The owner's own visits (signed in) and obvious robots aren't counted.
        if (SignIn.IsSignedIn(http, countDevelopment: false) || agent.Length == 0 || Bots().IsMatch(agent)) return Results.NoContent();

        var path = NormalizePath(body.Path);
        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        var salt = await SaltForAsync(today, db, ct);
        var ip = ClientIp(http);
        var hash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes($"{salt}|{ip}|{agent}")))[..16].ToLowerInvariant();

        var referrer = NormalizeReferrer(body.Referrer, http.Request.Host.Host);
        var existing = await db.Visits.FirstOrDefaultAsync(v => v.Day == today && v.VisitorHash == hash && v.Path == path, ct);
        if (existing is not null)
        {
            // A later landing on the same page from somewhere new still records where they came from.
            if (referrer is not null && existing.Referrer is null) { existing.Referrer = referrer; await db.SaveChangesAsync(ct); }
            return Results.NoContent();
        }
        db.Visits.Add(new Visit { Day = today, VisitorHash = hash, Path = path, Referrer = referrer });
        try { await db.SaveChangesAsync(ct); }
        catch (DbUpdateException) { /* the same visit arriving twice at once; the unique index keeps one */ }
        return Results.NoContent();
    }

    /// <summary>Signed-in only. days = 1..365 (default 30), ending today.</summary>
    private static async Task<IResult> Stats(int? days, HttpContext http, AppDbContext db, CancellationToken ct)
    {
        if (!SignIn.IsSignedIn(http)) return Results.Unauthorized();
        var n = Math.Clamp(days ?? 30, 1, 365);
        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        var from = today.AddDays(1 - n);
        var rows = await db.Visits.AsNoTracking().Where(v => v.Day >= from)
            .Select(v => new { v.Day, v.VisitorHash, v.Path, v.Referrer }).ToListAsync(ct);

        var perDay = rows.GroupBy(r => r.Day).ToDictionary(g => g.Key, g => g.Select(r => r.VisitorHash).Distinct().Count());
        var daily = Enumerable.Range(0, n).Select(i => from.AddDays(i))
            .Select(d => new DayVisitorsDto(d, perDay.GetValueOrDefault(d))).ToList();
        var pages = rows.GroupBy(r => r.Path)
            .Select(g => new PageVisitorsDto(g.Key, g.Select(r => (r.Day, r.VisitorHash)).Distinct().Count()))
            .OrderByDescending(p => p.Visitors).ThenBy(p => p.Path).ToList();
        // Each visitor-day counts once, under the first site they arrived from that day, or Direct.
        var referrers = rows.GroupBy(r => (r.Day, r.VisitorHash))
            .Select(g => g.Select(r => r.Referrer).FirstOrDefault(x => x is not null) ?? "Direct")
            .GroupBy(source => source).Select(g => new ReferrerVisitorsDto(g.Key, g.Count()))
            .OrderByDescending(r => r.Visitors).ThenBy(r => r.Source).ToList();
        return Results.Ok(new VisitStatsDto(n, perDay.GetValueOrDefault(today), daily.Sum(d => d.Visitors), daily, pages, referrers));
    }

    /// <summary>Today's secret, made on the first visit of the day. Older ones are deleted on the spot.</summary>
    private static async Task<string> SaltForAsync(DateOnly today, AppDbContext db, CancellationToken ct)
    {
        var salt = await db.VisitSalts.AsNoTracking().Where(s => s.Day == today).Select(s => s.Salt).FirstOrDefaultAsync(ct);
        if (salt is not null) return salt;

        await db.VisitSalts.Where(s => s.Day < today).ExecuteDeleteAsync(ct);
        db.VisitSalts.Add(new VisitSalt { Day = today, Salt = Convert.ToHexString(RandomNumberGenerator.GetBytes(32)) });
        try { await db.SaveChangesAsync(ct); }
        catch (DbUpdateException) { db.ChangeTracker.Clear(); } // another request made it first; use theirs
        return await db.VisitSalts.AsNoTracking().Where(s => s.Day == today).Select(s => s.Salt).FirstAsync(ct);
    }

    /// <summary>The visitor's address. App Service puts it first in X-Forwarded-For, sometimes with a port.</summary>
    private static string ClientIp(HttpContext http)
    {
        var forwarded = http.Request.Headers["X-Forwarded-For"].ToString().Split(',')[0].Trim();
        if (forwarded.Length > 0)
        {
            if (IPAddress.TryParse(forwarded, out var ip)) return ip.ToString();
            if (IPEndPoint.TryParse(forwarded, out var ep)) return ep.Address.ToString(); // "1.2.3.4:5678" or "[::1]:5678"
        }
        return http.Connection.RemoteIpAddress?.ToString() ?? "";
    }

    /// <summary>
    /// Folds the address onto the app's routes ("/flights/8" -> "/flights/:id"), and anything else onto "/other", so
    /// the table can only ever hold a handful of distinct paths.
    /// </summary>
    internal static string NormalizePath(string? raw)
    {
        var path = (raw ?? "/").Split('?', '#')[0].ToLowerInvariant().TrimEnd('/');
        path = Ids().Replace(path, "/:id");
        if (path.Length == 0) path = "/";
        return KnownRoutes().IsMatch(path) ? path : "/other";
    }

    /// <summary>
    /// The referring site's name only, never its full address (links can carry search terms or profile ids).
    /// Links from GitDrone itself don't count, and common short links are named after their site.
    /// </summary>
    internal static string? NormalizeReferrer(string? raw, string ownHost)
    {
        if (string.IsNullOrWhiteSpace(raw)) return null;
        var host = raw.Trim().ToLowerInvariant();
        // Accept a bare hostname or a full address, and keep just the hostname.
        if (Uri.TryCreate(host.Contains("://") ? host : "https://" + host, UriKind.Absolute, out var uri)) host = uri.Host;
        if (host.StartsWith("www.")) host = host[4..];
        if (host.Length == 0 || host == ownHost.ToLowerInvariant().Replace("www.", "") || !Hostname().IsMatch(host)) return null;
        foreach (var (pattern, name) in KnownSources)
            if (host == pattern || host.EndsWith("." + pattern)) return name;
        return host.Length <= 60 ? host : host[^60..];
    }

    private static readonly (string Host, string Name)[] KnownSources =
    [
        ("linkedin.com", "LinkedIn"), ("lnkd.in", "LinkedIn"), ("com.linkedin.android", "LinkedIn"),
        ("t.co", "X / Twitter"), ("x.com", "X / Twitter"), ("twitter.com", "X / Twitter"),
        ("facebook.com", "Facebook"), ("fb.me", "Facebook"), ("instagram.com", "Instagram"),
        ("reddit.com", "Reddit"), ("youtube.com", "YouTube"), ("youtu.be", "YouTube"),
        ("google.com", "Google"), ("bing.com", "Bing"), ("duckduckgo.com", "DuckDuckGo"),
        ("github.com", "GitHub"), ("discord.com", "Discord"), ("discordapp.com", "Discord"),
    ];

    [GeneratedRegex(@"^[a-z0-9-]+(\.[a-z0-9-]+)+$")]
    private static partial Regex Hostname();

    [GeneratedRegex(@"/\d+(?=/|$)")]
    private static partial Regex Ids();

    [GeneratedRegex(@"^/(flights(/:id(/overlay)?)?|hangar(/new|/:id(/edit|/tunes/import|/tunes/bulk|/flights/upload)?)?|osd|tunes/compare|stats)?$")]
    private static partial Regex KnownRoutes();

    [GeneratedRegex(@"bot|crawl|spider|slurp|preview|monitor|curl|wget|python|httpclient|headless", RegexOptions.IgnoreCase)]
    private static partial Regex Bots();
}
