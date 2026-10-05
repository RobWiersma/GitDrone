using System.Globalization;
using System.Text;

namespace DroneLogger.Api.Services;

public record GpsSummary(double DistanceM, double MaxSpeedMs, double MaxHeightM, double MaxDistanceM, double? HomeLat, double? HomeLon);

/// <summary>Turns a decoded log's GPS samples into flight stats and a compact track for the map.</summary>
public static class FlightTrack
{
    /// <summary>Enough for a smooth line on a map; a 7 minute flight at 10 Hz is ~4,300 samples.</summary>
    private const int MaxPoints = 3000;

    /// <summary>Null when the log has no usable GPS fix.</summary>
    public static (GpsSummary Summary, string Json)? Build(BlackboxLog log)
    {
        var gps = log.Gps;
        if (gps.Count < 2) return null;

        // Height is relative to this flight's takeoff, not the home point: Betaflight can keep home from an
        // earlier flight (gps_set_home_point_once), and GPS altitude drifts metres between flights.
        var baseAlt = gps.Take(10).Average(p => p.AltitudeM);
        (double Lat, double Lon) origin = log.Home ?? (gps[0].Lat, gps[0].Lon);

        double distance = 0, maxSpeed = 0, maxHeight = 0, maxFromHome = 0;
        for (var i = 0; i < gps.Count; i++)
        {
            var p = gps[i];
            if (i > 0) distance += Haversine(gps[i - 1].Lat, gps[i - 1].Lon, p.Lat, p.Lon);
            maxSpeed = Math.Max(maxSpeed, p.SpeedMs);
            maxHeight = Math.Max(maxHeight, p.AltitudeM - baseAlt);
            maxFromHome = Math.Max(maxFromHome, Haversine(origin.Lat, origin.Lon, p.Lat, p.Lon));
        }

        var stride = (int)Math.Ceiling(gps.Count / (double)MaxPoints);
        var t0 = gps[0].TimeUs;
        var sb = new StringBuilder();
        sb.Append("{\"home\":");
        sb.Append(log.Home is { } h ? $"[{F(h.Lat, 7)},{F(h.Lon, 7)}]" : "null");
        sb.Append(",\"points\":[");
        for (var i = 0; i < gps.Count; i += stride)
        {
            var p = gps[i];
            if (i > 0) sb.Append(',');
            // [seconds since first fix, lat, lon, height above takeoff (m), ground speed (m/s)]
            sb.Append('[').Append(F((p.TimeUs - t0) / 1e6, 1)).Append(',').Append(F(p.Lat, 7)).Append(',').Append(F(p.Lon, 7))
              .Append(',').Append(F(p.AltitudeM - baseAlt, 1)).Append(',').Append(F(p.SpeedMs, 1)).Append(']');
        }
        sb.Append("]}");

        var summary = new GpsSummary(Math.Round(distance), Math.Round(maxSpeed, 1), Math.Round(maxHeight, 1), Math.Round(maxFromHome),
            log.Home?.Lat, log.Home?.Lon);
        return (summary, sb.ToString());
    }

    private static string F(double v, int decimals) => Math.Round(v, decimals).ToString(CultureInfo.InvariantCulture);

    private static double Haversine(double lat1, double lon1, double lat2, double lon2)
    {
        const double R = 6_371_000;
        var dLat = (lat2 - lat1) * Math.PI / 180;
        var dLon = (lon2 - lon1) * Math.PI / 180;
        var a = Math.Sin(dLat / 2) * Math.Sin(dLat / 2) +
                Math.Cos(lat1 * Math.PI / 180) * Math.Cos(lat2 * Math.PI / 180) * Math.Sin(dLon / 2) * Math.Sin(dLon / 2);
        return 2 * R * Math.Asin(Math.Sqrt(a));
    }
}
