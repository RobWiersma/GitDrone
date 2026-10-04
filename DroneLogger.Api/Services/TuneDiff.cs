using DroneLogger.Api.Contracts;
using DroneLogger.Api.Domain;

namespace DroneLogger.Api.Services;

/// <summary>
/// Compares two snapshots setting by setting. Because diff all omits defaults, a key present on only
/// one side is reported against "default" rather than as truly added or removed.
/// </summary>
public static class TuneDiff
{
    // Order categories appear in within a scope.
    private static readonly string[] CategoryOrder =
        ["PIDs", "Filters", "Rates", "Motors & ESC", "Receiver & modes", "Features & beepers", "Ports & resources", "OSD & VTX", "Other"];

    public static List<TuneDiffGroupDto> Compare(IEnumerable<TuneSetting> from, IEnumerable<TuneSetting> to, out int unchanged)
    {
        var a = from.ToDictionary(s => (s.Scope, s.Key), s => s.Value);
        var b = to.ToDictionary(s => (s.Scope, s.Key), s => s.Value);

        var changes = new List<(string Scope, string Category, TuneDiffEntryDto Entry)>();
        unchanged = 0;

        foreach (var key in a.Keys.Union(b.Keys))
        {
            var hasA = a.TryGetValue(key, out var va);
            var hasB = b.TryGetValue(key, out var vb);

            string kind;
            if (hasA && hasB)
            {
                if (va == vb) { unchanged++; continue; }
                kind = "changed";
            }
            else kind = hasB ? "added" : "removed";

            changes.Add((key.Scope, Categorize(key.Scope, key.Key), new TuneDiffEntryDto(key.Key, hasA ? va : null, hasB ? vb : null, kind)));
        }

        return changes
            .GroupBy(c => (c.Scope, c.Category))
            .OrderBy(g => ScopeRank(g.Key.Scope)).ThenBy(g => g.Key.Scope, StringComparer.Ordinal)
            .ThenBy(g => Array.IndexOf(CategoryOrder, g.Key.Category))
            .Select(g => new TuneDiffGroupDto(
                g.Key.Scope, ScopeLabel(g.Key.Scope), g.Key.Category,
                g.Select(c => c.Entry).OrderBy(e => e.Key, StringComparer.Ordinal).ToList()))
            .ToList();
    }

    private static int ScopeRank(string scope) =>
        scope == "master" ? 0 : scope.StartsWith("profile:") ? 1 : 2;

    private static string ScopeLabel(string scope)
    {
        var parts = scope.Split(':');
        return parts[0] switch
        {
            "profile" => $"PID profile {parts[1]}",
            "rateprofile" => $"Rate profile {parts[1]}",
            _ => "General",
        };
    }

    private static readonly string[] PidPrefixes =
        ["p_", "i_", "d_", "f_", "d_min", "d_max", "simplified_", "feedforward", "iterm", "anti_gravity", "tpa_",
         "pidsum", "thrust_linear", "abs_control", "throttle_boost", "level_", "angle_", "horizon_", "vbat_sag", "pid_"];

    private static readonly string[] RatePrefixes =
        ["rates_type", "roll_", "pitch_", "yaw_", "thr_", "throttle_limit"];

    internal static string Categorize(string scope, string key)
    {
        var k = key.ToLowerInvariant();

        if (k.StartsWith("feature:") || k.StartsWith("beeper:")) return "Features & beepers";
        if (k.Contains("lpf") || k.Contains("lowpass") || k.Contains("notch") || k.Contains("filter") || k.StartsWith("rpm_")
            || k.StartsWith("gyro_") || k.StartsWith("dterm_")) return "Filters";
        if (scope.StartsWith("rateprofile:") || (RatePrefixes.Any(k.StartsWith) && (k.Contains("rate") || k.Contains("expo"))))
            return "Rates";
        if (PidPrefixes.Any(k.StartsWith)) return "PIDs";
        if (k.StartsWith("motor") || k.Contains("dshot") || k.StartsWith("dyn_idle") || k.StartsWith("digital_idle")
            || k.Contains("throttle") || k.StartsWith("esc_")) return "Motors & ESC";
        if (k.StartsWith("aux ") || k.StartsWith("adjrange") || k.StartsWith("rxrange") || k is "map"
            || k.StartsWith("rx_") || k.StartsWith("rc_") || k.StartsWith("serialrx") || k.StartsWith("rssi")) return "Receiver & modes";
        if (k.StartsWith("serial ") || k.StartsWith("resource") || k.StartsWith("timer") || k.StartsWith("dma")) return "Ports & resources";
        if (k.StartsWith("osd") || k.StartsWith("vtx")) return "OSD & VTX";
        return "Other";
    }
}
