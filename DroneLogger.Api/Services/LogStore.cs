namespace DroneLogger.Api.Services;

/// <summary>Keeps uploaded blackbox files on disk so they can be re-parsed later (for example once GPS is shown).</summary>
public class LogStore
{
    public const long MaxBytes = 64 * 1024 * 1024;

    public string Root { get; }

    public LogStore(IConfiguration config, IWebHostEnvironment env)
    {
        Root = Path.GetFullPath(config["Storage:LogsPath"] ?? "App_Data/logs", env.ContentRootPath);
        Directory.CreateDirectory(Root);
    }

    public async Task<string> SaveAsync(byte[] bytes, CancellationToken ct)
    {
        var name = $"{Guid.NewGuid():N}.bbl";
        await File.WriteAllBytesAsync(Path.Combine(Root, name), bytes, ct);
        return name;
    }

    public void Delete(string? fileName)
    {
        if (string.IsNullOrEmpty(fileName)) return;
        var path = Path.Combine(Root, Path.GetFileName(fileName));
        if (File.Exists(path)) File.Delete(path);
    }
}
