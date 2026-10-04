namespace DroneLogger.Api.Services;

/// <summary>Stores aircraft photos on disk under generated names. Swap for Blob Storage when hosting.</summary>
public class ImageStore
{
    public const long MaxBytes = 5 * 1024 * 1024;

    public string Root { get; }

    public ImageStore(IConfiguration config, IWebHostEnvironment env)
    {
        Root = Path.GetFullPath(config["Storage:UploadsPath"] ?? "App_Data/uploads", env.ContentRootPath);
        Directory.CreateDirectory(Root);
    }

    public async Task<(string? FileName, string? Error)> SaveAsync(IFormFile file, CancellationToken ct)
    {
        if (file.Length == 0) return (null, "The image is empty.");
        if (file.Length > MaxBytes) return (null, "The image is over 5 MB.");

        // Trust the bytes, not the client's content type or file name.
        var head = new byte[12];
        await using (var probe = file.OpenReadStream())
        {
            var read = await probe.ReadAtLeastAsync(head, head.Length, throwOnEndOfStream: false, ct);
            if (read < head.Length) return (null, "Use a JPG, PNG or WebP image.");
        }
        var ext = DetectExtension(head);
        if (ext is null) return (null, "Use a JPG, PNG or WebP image.");

        var name = $"{Guid.NewGuid():N}{ext}";
        await using var dest = File.Create(Path.Combine(Root, name));
        await using var src = file.OpenReadStream();
        await src.CopyToAsync(dest, ct);
        return (name, null);
    }

    public void Delete(string? fileName)
    {
        if (string.IsNullOrEmpty(fileName)) return;
        var path = Path.Combine(Root, Path.GetFileName(fileName));
        if (File.Exists(path)) File.Delete(path);
    }

    private static string? DetectExtension(byte[] h) =>
        h[0] == 0xFF && h[1] == 0xD8 && h[2] == 0xFF ? ".jpg" :
        h[0] == 0x89 && h[1] == 0x50 && h[2] == 0x4E && h[3] == 0x47 ? ".png" :
        h[0] == 0x52 && h[1] == 0x49 && h[2] == 0x46 && h[3] == 0x46 && h[8] == 0x57 && h[9] == 0x45 && h[10] == 0x42 && h[11] == 0x50 ? ".webp" :
        null;
}
