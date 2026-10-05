namespace DroneLogger.Api.Domain;

public class Aircraft
{
    public int Id { get; set; }
    public string Name { get; set; } = "";
    public string Type { get; set; } = "Other";
    public string PropSize { get; set; } = "";
    public string Frame { get; set; } = "";
    public string FlightController { get; set; } = "";
    public string Battery { get; set; } = "";
    public int? WeightGrams { get; set; }
    public string Notes { get; set; } = "";
    /// <summary>Generated file name inside the uploads folder. Never the client's file name.</summary>
    public string? ImageFileName { get; set; }
    public DateTime CreatedAt { get; set; }
    public List<TuneSnapshot> Tunes { get; set; } = [];
    public List<Flight> Flights { get; set; } = [];
}

public class TuneSnapshot
{
    public int Id { get; set; }
    public int AircraftId { get; set; }
    public Aircraft? Aircraft { get; set; }
    public string Label { get; set; } = "";
    public string? Notes { get; set; }
    public string FirmwareVersion { get; set; } = "";
    public string Target { get; set; } = "";
    public DateTime CreatedAt { get; set; }
    /// <summary>The sanitized diff all text, kept so the parser can be re-run later.</summary>
    public string RawText { get; set; } = "";
    public string ContentHash { get; set; } = "";
    public List<TuneSetting> Settings { get; set; } = [];
}

public class TuneSetting
{
    public int Id { get; set; }
    public int SnapshotId { get; set; }
    public TuneSnapshot? Snapshot { get; set; }
    /// <summary>"master", "profile:0", "rateprofile:1", ...</summary>
    public string Scope { get; set; } = "master";
    public string Key { get; set; } = "";
    public string Value { get; set; } = "";
}

/// <summary>One armed session from a blackbox log. A single uploaded file can produce several.</summary>
public class Flight
{
    public int Id { get; set; }
    public int AircraftId { get; set; }
    public Aircraft? Aircraft { get; set; }
    /// <summary>The tune this was flown on. Cleared if that snapshot is deleted.</summary>
    public int? TuneSnapshotId { get; set; }
    public TuneSnapshot? TuneSnapshot { get; set; }
    public string? Notes { get; set; }
    /// <summary>Client file name, shown in the UI only.</summary>
    public string OriginalFileName { get; set; } = "";
    /// <summary>Generated name in the logs folder, shared by all flights from the same upload.</summary>
    public string StoredFileName { get; set; } = "";
    public string FileHash { get; set; } = "";
    /// <summary>Position of this session inside the file (0-based).</summary>
    public int LogIndex { get; set; }
    /// <summary>From the log header. Null when the FC had no clock.</summary>
    public DateTime? StartedAt { get; set; }
    public long DurationMs { get; set; }
    public string FirmwareRevision { get; set; } = "";
    public string Board { get; set; } = "";
    public double? AvgThrottlePercent { get; set; }
    public double? MaxThrottlePercent { get; set; }
    public int CorruptFrames { get; set; }
    public DateTime CreatedAt { get; set; }

    // GPS, all null when the log had no GPS fix.
    public double? DistanceM { get; set; }
    public double? MaxSpeedMs { get; set; }
    /// <summary>Above this flight's takeoff altitude.</summary>
    public double? MaxHeightM { get; set; }
    public double? MaxDistanceM { get; set; }
    public double? HomeLat { get; set; }
    public double? HomeLon { get; set; }
    /// <summary>{"home":[lat,lon]|null,"points":[[t,lat,lon,heightAboveTakeoff,speed],...]}, see FlightTrack.</summary>
    public string? TrackJson { get; set; }
}
