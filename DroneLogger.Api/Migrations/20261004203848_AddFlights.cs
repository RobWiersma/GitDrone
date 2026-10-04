using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace DroneLogger.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddFlights : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "Flights",
                columns: table => new
                {
                    Id = table.Column<int>(type: "INTEGER", nullable: false)
                        .Annotation("Sqlite:Autoincrement", true),
                    AircraftId = table.Column<int>(type: "INTEGER", nullable: false),
                    TuneSnapshotId = table.Column<int>(type: "INTEGER", nullable: true),
                    Notes = table.Column<string>(type: "TEXT", maxLength: 1000, nullable: true),
                    OriginalFileName = table.Column<string>(type: "TEXT", maxLength: 120, nullable: false),
                    StoredFileName = table.Column<string>(type: "TEXT", maxLength: 100, nullable: false),
                    FileHash = table.Column<string>(type: "TEXT", maxLength: 64, nullable: false),
                    LogIndex = table.Column<int>(type: "INTEGER", nullable: false),
                    StartedAt = table.Column<DateTime>(type: "TEXT", nullable: true),
                    DurationMs = table.Column<long>(type: "INTEGER", nullable: false),
                    FirmwareRevision = table.Column<string>(type: "TEXT", maxLength: 80, nullable: false),
                    Board = table.Column<string>(type: "TEXT", maxLength: 80, nullable: false),
                    AvgThrottlePercent = table.Column<double>(type: "REAL", nullable: true),
                    MaxThrottlePercent = table.Column<double>(type: "REAL", nullable: true),
                    CorruptFrames = table.Column<int>(type: "INTEGER", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "TEXT", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Flights", x => x.Id);
                    table.ForeignKey(
                        name: "FK_Flights_Fleet_AircraftId",
                        column: x => x.AircraftId,
                        principalTable: "Fleet",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_Flights_TuneSnapshots_TuneSnapshotId",
                        column: x => x.TuneSnapshotId,
                        principalTable: "TuneSnapshots",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                });

            migrationBuilder.CreateIndex(
                name: "IX_Flights_AircraftId_FileHash",
                table: "Flights",
                columns: new[] { "AircraftId", "FileHash" });

            migrationBuilder.CreateIndex(
                name: "IX_Flights_AircraftId_StartedAt",
                table: "Flights",
                columns: new[] { "AircraftId", "StartedAt" });

            migrationBuilder.CreateIndex(
                name: "IX_Flights_TuneSnapshotId",
                table: "Flights",
                column: "TuneSnapshotId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "Flights");
        }
    }
}
