namespace DroneLogger.Api.Services;

/// <summary>
/// Who counts as signed in. On Azure, App Service Authentication signs people in and passes who they are in
/// X-MS-CLIENT-PRINCIPAL-* headers (it strips any a client tries to send itself). Locally there is no sign-in, so
/// Development counts as signed in unless the caller asks otherwise.
/// </summary>
public static class SignIn
{
    public static bool IsSignedIn(HttpContext http, bool countDevelopment = true) =>
        (countDevelopment && http.RequestServices.GetRequiredService<IHostEnvironment>().IsDevelopment())
        || !string.IsNullOrEmpty(http.Request.Headers["X-MS-CLIENT-PRINCIPAL-ID"]);
}
