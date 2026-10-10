namespace DroneLogger.Api.Services;

/// <summary>
/// Who's signed in, and who owns GitDrone. On Azure, App Service Authentication signs people in and passes who they are
/// in X-MS-CLIENT-PRINCIPAL-* headers (it strips any a client tries to send itself). Signing in alone isn't enough to
/// change anything: only accounts listed in Auth:OwnerIds (app setting Auth__OwnerIds, comma-separated) are owners.
/// An empty list means no owners, so a missing setting can't open the site up. Locally there is no sign-in, so
/// Development counts as signed in and as the owner.
/// </summary>
public static class SignIn
{
    /// <summary>The signed-in account's id (the Microsoft Entra object id), or null.</summary>
    public static string? PrincipalId(HttpContext http)
    {
        var id = http.Request.Headers["X-MS-CLIENT-PRINCIPAL-ID"].ToString();
        return id.Length > 0 ? id : null;
    }

    private static bool IsDevelopment(HttpContext http) =>
        http.RequestServices.GetRequiredService<IHostEnvironment>().IsDevelopment();

    /// <summary>Signed in with any account. `countDevelopment: false` ignores the local stand-in sign-in.</summary>
    public static bool IsSignedIn(HttpContext http, bool countDevelopment = true) =>
        (countDevelopment && IsDevelopment(http)) || PrincipalId(http) is not null;

    /// <summary>Signed in with an account listed as an owner: the only ones who can make changes or see visitor stats.</summary>
    public static bool IsOwner(HttpContext http)
    {
        if (IsDevelopment(http)) return true;
        var id = PrincipalId(http);
        return id is not null && OwnerIds(http).Contains(id);
    }

    private static HashSet<string> OwnerIds(HttpContext http)
    {
        var config = http.RequestServices.GetRequiredService<IConfiguration>();
        // Either one comma-separated value (easy to set in Azure) or a JSON array in appsettings.
        var values = (config["Auth:OwnerIds"] ?? "").Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Concat(config.GetSection("Auth:OwnerIds").GetChildren().Select(c => c.Value ?? "").Where(v => v.Length > 0));
        return new HashSet<string>(values, StringComparer.OrdinalIgnoreCase);
    }
}
