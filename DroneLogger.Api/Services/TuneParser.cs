using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;

namespace DroneLogger.Api.Services;

public record ParsedSetting(string Scope, string Key, string Value);
public record ParsedTune(string FirmwareVersion, string Target, IReadOnlyList<ParsedSetting> Settings, string SanitizedText, string ContentHash);
public record ParseResult(ParsedTune? Tune, string? Error);

/// <summary>
/// Reads Betaflight "diff all" output. diff all only lists values that differ from defaults,
/// so a setting missing from a snapshot means "default", not "removed".
/// </summary>
public static class TuneParser
{
    private const RegexOptions Opts = RegexOptions.Compiled | RegexOptions.CultureInvariant;

    // "# Betaflight / STM32G47X (S7X2) 4.5.0 Jan  9 2024 / ..."
    private static readonly Regex Header = new(@"^#\s*Betaflight\s*/\s*(\S+)\s*\(([^)]+)\)\s*(\d+\.\d+\.\d+)", Opts | RegexOptions.Multiline);
    private static readonly Regex Board = new(@"^#?\s*board_name\s+(\S+)", Opts | RegexOptions.Multiline);

    // Lines removed before anything is stored: craft/pilot names and per-device IDs.
    private static readonly Regex Identifying = new(
        @"^(?:set\s+(?:name|craft_name|pilot_name)\s*=.*|name\s+\S.*|#\s*name\s*:.*|(?:#\s*)?(?:mcu_id|signature)\b.*)$",
        Opts | RegexOptions.IgnoreCase);

    private static readonly Regex SetLine = new(@"^set\s+(\S+)\s*=\s*(.*)$", Opts | RegexOptions.IgnoreCase);

    // Commands shaped like "<cmd> <index...> <values...>". Value is the number of tokens that form the key.
    private static readonly Dictionary<string, int> Indexed = new(StringComparer.OrdinalIgnoreCase)
    {
        ["aux"] = 2, ["serial"] = 2, ["adjrange"] = 2, ["rxrange"] = 2, ["servo"] = 2,
        ["led"] = 2, ["color"] = 2, ["vtxtable"] = 2, ["resource"] = 3, ["map"] = 1,
    };

    // "feature -NAME" turns a feature off, "feature NAME" turns it on. Same for beeper.
    private static readonly HashSet<string> Toggles = new(StringComparer.OrdinalIgnoreCase) { "feature", "beeper" };

    private static readonly HashSet<string> Ignored = new(StringComparer.OrdinalIgnoreCase)
        { "batch", "save", "defaults", "diff", "dump", "get", "exit", "status", "version", "name",
          "board_name", "manufacturer_id", "mcu_id", "signature" };

    public static ParseResult Parse(string raw)
    {
        var lines = raw.Replace("\r\n", "\n").Replace('\r', '\n')
            .Split('\n')
            .Select(l => l.Trim())
            .Where(l => !Identifying.IsMatch(l))
            .ToList();
        var text = string.Join('\n', lines).Trim();

        var header = Header.Match(text);
        if (!header.Success)
            return new(null, "This doesn't look like Betaflight diff all output. It should start with a \"# Betaflight /\" line.");

        var version = header.Groups[3].Value;
        var target = Clamp(Board.Match(text) is { Success: true } b ? b.Groups[1].Value : header.Groups[2].Value, 40);

        var scope = "master";
        var found = new Dictionary<(string Scope, string Key), string>(); // a repeated key keeps its last value

        foreach (var line in lines)
        {
            if (line.Length == 0 || line[0] == '#') continue;
            var tokens = line.Split(' ', StringSplitOptions.RemoveEmptyEntries);
            var cmd = tokens[0].ToLowerInvariant();

            if ((cmd is "profile" or "rateprofile") && tokens.Length == 2 && int.TryParse(tokens[1], out var n))
            {
                scope = $"{cmd}:{n}";
                continue;
            }

            if (cmd == "set")
            {
                var m = SetLine.Match(line);
                if (m.Success) Add(found, scope, m.Groups[1].Value.ToLowerInvariant(), m.Groups[2].Value.Trim());
            }
            else if (Toggles.Contains(cmd) && tokens.Length >= 2)
            {
                var off = tokens[1].StartsWith('-');
                Add(found, "master", $"{cmd}:{tokens[1].TrimStart('-', '+')}", off ? "off" : "on");
            }
            else if (Indexed.TryGetValue(cmd, out var keyLen))
            {
                if (tokens.Length < keyLen) continue;
                Add(found, "master", string.Join(' ', tokens.Take(keyLen)), string.Join(' ', tokens.Skip(keyLen)));
            }
            else if (!Ignored.Contains(cmd))
            {
                Add(found, "master", cmd, string.Join(' ', tokens.Skip(1)));
            }
        }

        if (found.Count == 0)
            return new(null, "No settings found. Run diff all in the Betaflight CLI and paste the whole output.");

        var settings = found
            .OrderBy(kv => kv.Key.Scope, StringComparer.Ordinal).ThenBy(kv => kv.Key.Key, StringComparer.Ordinal)
            .Select(kv => new ParsedSetting(kv.Key.Scope, kv.Key.Key, kv.Value))
            .ToList();

        // Firmware is part of the identity: the same settings after an upgrade is a new moment in the history.
        var canonical = $"{version}|{target}\n" + string.Join('\n', settings.Select(s => $"{s.Scope}|{s.Key}|{s.Value}"));
        var hash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(canonical))).ToLowerInvariant();

        return new(new ParsedTune(version, target, settings, text, hash), null);
    }

    private static void Add(Dictionary<(string, string), string> found, string scope, string key, string value)
    {
        if (key.Length is 0 or > 120) return;
        found[(scope, key)] = Clamp(value, 1000);
    }

    private static string Clamp(string s, int max) => s.Length <= max ? s : s[..max];
}
