using DroneLogger.Api.Data;
using DroneLogger.Api.Endpoints;
using DroneLogger.Api.Services;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.FileProviders;

var builder = WebApplication.CreateBuilder(args);
var config = builder.Configuration;

// Database:Provider is "Sqlite" (default) or "SqlServer" (Azure SQL). Same code either way.
var useSqlServer = string.Equals(config["Database:Provider"], "SqlServer", StringComparison.OrdinalIgnoreCase);
var connection = config.GetConnectionString("Default")
    ?? throw new InvalidOperationException("Missing ConnectionStrings:Default.");

if (!useSqlServer)
{
    // Resolve the file path against the project folder and make sure the folder exists.
    var sqlite = new SqliteConnectionStringBuilder(connection);
    sqlite.DataSource = Path.GetFullPath(sqlite.DataSource, builder.Environment.ContentRootPath);
    Directory.CreateDirectory(Path.GetDirectoryName(sqlite.DataSource)!);
    connection = sqlite.ToString();
}

builder.Services.AddDbContext<AppDbContext>(options =>
{
    if (useSqlServer) options.UseSqlServer(connection, sql => sql.EnableRetryOnFailure()); // helps when serverless Azure SQL wakes up
    else options.UseSqlite(connection);
});
builder.Services.AddSingleton<ImageStore>();
builder.Services.AddSingleton<LogStore>();
builder.Services.AddCors(o => o.AddPolicy("frontend", p => p
    .WithOrigins(config.GetSection("Cors:Origins").Get<string[]>() ?? [])
    .AllowAnyHeader()
    .AllowAnyMethod()));

// LovelyOSD is open to visitors, and decoding a big log takes real CPU and memory. Decode at most two at once, with
// two more waiting, so a burst can't take the small App Service plan down; the rest get 503 and can try again.
builder.Services.AddRateLimiter(o =>
{
    o.RejectionStatusCode = StatusCodes.Status503ServiceUnavailable;
    o.AddConcurrencyLimiter("osd", l => { l.PermitLimit = 2; l.QueueLimit = 2; });
});

var app = builder.Build();

using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
    if (!db.Database.GetMigrations().Any())
        throw new InvalidOperationException("No EF Core migrations found. Run: dotnet ef migrations add Initial");
    db.Database.Migrate();
}

var images = app.Services.GetRequiredService<ImageStore>();
app.UseStaticFiles(new StaticFileOptions
{
    FileProvider = new PhysicalFileProvider(images.Root),
    RequestPath = "/uploads",
    OnPrepareResponse = ctx => ctx.Context.Response.Headers["X-Content-Type-Options"] = "nosniff",
});

app.UseCors("frontend");

// Anyone can look; only signed-in users can change anything. On Azure, App Service Authentication signs people in
// and passes who they are in X-MS-CLIENT-PRINCIPAL-* headers (it strips any a client tries to send itself).
// Locally there is no sign-in, so Development counts as signed in.
var devSignedIn = app.Environment.IsDevelopment();
static bool IsSignedIn(HttpContext http, bool dev) =>
    dev || !string.IsNullOrEmpty(http.Request.Headers["X-MS-CLIENT-PRINCIPAL-ID"]);

app.Use(async (http, next) =>
{
    var method = http.Request.Method;
    var readOnly = HttpMethods.IsGet(method) || HttpMethods.IsHead(method) || HttpMethods.IsOptions(method);
    // LovelyOSD reads a log and stores nothing, so visitors can use it too (it's rate limited instead).
    var openToAll = http.Request.Path.StartsWithSegments("/api/osd");
    if (!readOnly && !openToAll && http.Request.Path.StartsWithSegments("/api") && !IsSignedIn(http, devSignedIn))
    {
        http.Response.StatusCode = StatusCodes.Status401Unauthorized;
        await http.Response.WriteAsJsonAsync(new { error = "Sign in to make changes." });
        return;
    }
    await next();
});

app.UseRateLimiter();

app.MapGet("/api/me", (HttpContext http) => new
{
    signedIn = IsSignedIn(http, devSignedIn),
    name = devSignedIn ? "Local" : http.Request.Headers["X-MS-CLIENT-PRINCIPAL-NAME"].ToString(),
    // Sign-in and sign-out links only exist where App Service Authentication is running.
    canSignOut = !devSignedIn,
});

// The built Angular app is copied into wwwroot at deploy time, so the site and the API share one origin.
// index.html must be revalidated on every load, or browsers keep running the previous deploy's scripts.
// The scripts and styles it points at have content hashes in their names, so those can be cached for good.
var spaFiles = new StaticFileOptions
{
    OnPrepareResponse = ctx =>
    {
        var headers = ctx.Context.Response.Headers;
        if (ctx.File.Name.Equals("index.html", StringComparison.OrdinalIgnoreCase))
            headers.CacheControl = "no-cache";
        else if (System.Text.RegularExpressions.Regex.IsMatch(ctx.File.Name, @"-[A-Za-z0-9_]{8,}\.(js|css)$"))
            headers.CacheControl = "public, max-age=31536000, immutable";
    },
};
app.UseDefaultFiles();
app.UseStaticFiles(spaFiles);

app.MapAircraft();
app.MapTunes();
app.MapFlights();

// Client-side routes (/aircraft/3, /flights/7, ...) all load the Angular app. Unknown /api paths still 404.
app.MapFallback("/api/{**path}", () => Results.NotFound());
app.MapFallbackToFile("index.html", spaFiles);

app.Run();
