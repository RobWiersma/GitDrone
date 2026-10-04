using DroneLogger.Api.Data;
using DroneLogger.Api.Endpoints;
using DroneLogger.Api.Services;
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
app.MapAircraft();
app.MapTunes();
app.MapFlights();

app.Run();
