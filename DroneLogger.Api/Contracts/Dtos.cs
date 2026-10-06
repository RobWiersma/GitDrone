namespace DroneLogger.Api.Contracts;

// Property names serialize as camelCase, matching the Angular models.

public record AircraftDto(
    int Id, string Name, string Type, string PropSize, string Frame, string FlightController,
    string Battery, int? WeightGrams, string Notes, string? ImageUrl,
    DateTime CreatedAt, int TuneCount, DateTime? LastTuneAt);

public record TuneSnapshotDto(
    int Id, int AircraftId, string Label, string? Notes, string FirmwareVersion, string Target,
    DateTime CreatedAt, int SettingCount, int FlightCount);

public record TuneImportRequest(string? Label, string? Notes, string? RawText);

public record TuneImportResult(TuneSnapshotDto Snapshot, int? DuplicateOf);

/// <summary>Kind is "changed", "added" (was default) or "removed" (back to default). From/To are null on the default side.</summary>
public record TuneDiffEntryDto(string Key, string? From, string? To, string Kind);

public record TuneDiffGroupDto(string Scope, string ScopeLabel, string Category, IReadOnlyList<TuneDiffEntryDto> Changes);

public record TuneCompareResult(
    TuneSnapshotDto From, TuneSnapshotDto To, int Changed, int Added, int Removed, int Unchanged,
    IReadOnlyList<TuneDiffGroupDto> Groups);

public record FlightDto(
    int Id, int AircraftId, string AircraftName, int? TuneSnapshotId, string? TuneLabel, string? Notes, string OriginalFileName, int LogIndex,
    DateTime? StartedAt, long DurationMs, string FirmwareRevision, string Board,
    double? AvgThrottlePercent, double? MaxThrottlePercent, int CorruptFrames, DateTime CreatedAt,
    bool HasGps, double? DistanceM, double? MaxSpeedMs, double? MaxHeightM, double? MaxDistanceM, bool HasSticks,
    double? AvgSpeedMs, FlightBatteryDto? Battery);

public record FlightBatteryDto(int Cells, double StartV, double EndV, double MinV, double? MahUsed, double? PeakCurrentA,
    double? AvgCurrentA, double? PeakPowerW);

/// <summary>Duplicate is true when this exact file was already uploaded for the aircraft; Flights are then the existing ones.</summary>
public record FlightUploadResult(IReadOnlyList<FlightDto> Flights, bool Duplicate);

public record FlightUpdateRequest(int? TuneSnapshotId, string? Notes);

public record TuneRawDto(int Id, string RawText);

/// <summary>CreatedAt is when the backup was taken (from its file name); null means now.</summary>
public record TuneBulkItem(string? Label, string? Notes, string? RawText, DateTime? CreatedAt);

public record TuneBulkRequest(IReadOnlyList<TuneBulkItem>? Items);

/// <summary>Status is "created", "duplicate" (same settings as the tune just before it) or "error". Index points into the request.</summary>
public record TuneBulkItemResult(int Index, string Status, TuneSnapshotDto? Snapshot, int? DuplicateOf, string? Error);

/// <summary>
/// One armed session from a log read by LovelyOSD, never stored. Flight has Id 0 and no aircraft; Track, Sticks and
/// Battery are the same JSON the /api/flights/{id}/track, /sticks and /battery endpoints return, or null when absent.
/// </summary>
public record OsdSessionDto(FlightDto Flight, System.Text.Json.JsonElement? Track, System.Text.Json.JsonElement? Sticks,
    System.Text.Json.JsonElement? Battery);

public record OsdAnalysisDto(string FileName, IReadOnlyList<OsdSessionDto> Sessions);

/// <summary>A page of the all-aircraft flight feed. HasMore says whether another page exists after this one.</summary>
public record FlightFeedPage(IReadOnlyList<FlightDto> Flights, bool HasMore);
