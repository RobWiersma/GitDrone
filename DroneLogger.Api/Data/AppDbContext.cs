using DroneLogger.Api.Domain;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage.ValueConversion;

namespace DroneLogger.Api.Data;

public class AppDbContext(DbContextOptions<AppDbContext> options) : DbContext(options)
{
    // "Fleet" because the plural of aircraft is aircraft, which collides with the type name.
    public DbSet<Aircraft> Fleet => Set<Aircraft>();
    public DbSet<TuneSnapshot> TuneSnapshots => Set<TuneSnapshot>();
    public DbSet<TuneSetting> TuneSettings => Set<TuneSetting>();
    public DbSet<Flight> Flights => Set<Flight>();

    protected override void OnModelCreating(ModelBuilder b)
    {
        b.Entity<Aircraft>(e =>
        {
            e.Property(x => x.Name).HasMaxLength(60).IsRequired();
            e.Property(x => x.Type).HasMaxLength(20).IsRequired();
            e.Property(x => x.PropSize).HasMaxLength(20);
            e.Property(x => x.Frame).HasMaxLength(80);
            e.Property(x => x.FlightController).HasMaxLength(80);
            e.Property(x => x.Battery).HasMaxLength(40);
            e.Property(x => x.Notes).HasMaxLength(2000);
            e.Property(x => x.ImageFileName).HasMaxLength(100);
        });

        b.Entity<TuneSnapshot>(e =>
        {
            e.Property(x => x.Label).HasMaxLength(80).IsRequired();
            e.Property(x => x.Notes).HasMaxLength(1000);
            e.Property(x => x.FirmwareVersion).HasMaxLength(20);
            e.Property(x => x.Target).HasMaxLength(40);
            e.Property(x => x.ContentHash).HasMaxLength(64);
            e.HasOne(x => x.Aircraft).WithMany(a => a.Tunes).HasForeignKey(x => x.AircraftId).OnDelete(DeleteBehavior.Cascade);
            e.HasIndex(x => new { x.AircraftId, x.CreatedAt });
        });

        b.Entity<TuneSetting>(e =>
        {
            e.Property(x => x.Scope).HasMaxLength(40);
            e.Property(x => x.Key).HasMaxLength(120);
            e.Property(x => x.Value).HasMaxLength(1000);
            e.HasOne(x => x.Snapshot).WithMany(s => s.Settings).HasForeignKey(x => x.SnapshotId).OnDelete(DeleteBehavior.Cascade);
            e.HasIndex(x => x.SnapshotId);
        });

        b.Entity<Flight>(e =>
        {
            e.Property(x => x.Notes).HasMaxLength(1000);
            e.Property(x => x.OriginalFileName).HasMaxLength(120);
            e.Property(x => x.StoredFileName).HasMaxLength(100);
            e.Property(x => x.FileHash).HasMaxLength(64);
            e.Property(x => x.FirmwareRevision).HasMaxLength(80);
            e.Property(x => x.Board).HasMaxLength(80);
            e.HasOne(x => x.Aircraft).WithMany(a => a.Flights).HasForeignKey(x => x.AircraftId).OnDelete(DeleteBehavior.Cascade);
            // Deleting a tune keeps its flights, just unlinked.
            e.HasOne(x => x.TuneSnapshot).WithMany().HasForeignKey(x => x.TuneSnapshotId).OnDelete(DeleteBehavior.SetNull);
            e.HasIndex(x => new { x.AircraftId, x.StartedAt });
            e.HasIndex(x => new { x.AircraftId, x.FileHash });
        });

        // SQLite hands DateTime back as Kind=Unspecified, which serializes without a "Z" and
        // makes browsers read it as local time. Mark everything as UTC on the way out.
        var utc = new ValueConverter<DateTime, DateTime>(v => v, v => DateTime.SpecifyKind(v, DateTimeKind.Utc));
        var utcNullable = new ValueConverter<DateTime?, DateTime?>(v => v, v => v.HasValue ? DateTime.SpecifyKind(v.Value, DateTimeKind.Utc) : v);
        foreach (var property in b.Model.GetEntityTypes().SelectMany(t => t.GetProperties()))
        {
            if (property.ClrType == typeof(DateTime)) property.SetValueConverter(utc);
            else if (property.ClrType == typeof(DateTime?)) property.SetValueConverter(utcNullable);
        }
    }
}
