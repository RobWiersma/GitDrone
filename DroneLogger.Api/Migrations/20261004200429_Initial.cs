using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace DroneLogger.Api.Migrations
{
    /// <inheritdoc />
    public partial class Initial : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "Fleet",
                columns: table => new
                {
                    Id = table.Column<int>(type: "INTEGER", nullable: false)
                        .Annotation("Sqlite:Autoincrement", true),
                    Name = table.Column<string>(type: "TEXT", maxLength: 60, nullable: false),
                    Type = table.Column<string>(type: "TEXT", maxLength: 20, nullable: false),
                    PropSize = table.Column<string>(type: "TEXT", maxLength: 20, nullable: false),
                    Frame = table.Column<string>(type: "TEXT", maxLength: 80, nullable: false),
                    FlightController = table.Column<string>(type: "TEXT", maxLength: 80, nullable: false),
                    Battery = table.Column<string>(type: "TEXT", maxLength: 40, nullable: false),
                    WeightGrams = table.Column<int>(type: "INTEGER", nullable: true),
                    Notes = table.Column<string>(type: "TEXT", maxLength: 2000, nullable: false),
                    ImageFileName = table.Column<string>(type: "TEXT", maxLength: 100, nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "TEXT", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Fleet", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "TuneSnapshots",
                columns: table => new
                {
                    Id = table.Column<int>(type: "INTEGER", nullable: false)
                        .Annotation("Sqlite:Autoincrement", true),
                    AircraftId = table.Column<int>(type: "INTEGER", nullable: false),
                    Label = table.Column<string>(type: "TEXT", maxLength: 80, nullable: false),
                    Notes = table.Column<string>(type: "TEXT", maxLength: 1000, nullable: true),
                    FirmwareVersion = table.Column<string>(type: "TEXT", maxLength: 20, nullable: false),
                    Target = table.Column<string>(type: "TEXT", maxLength: 40, nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "TEXT", nullable: false),
                    RawText = table.Column<string>(type: "TEXT", nullable: false),
                    ContentHash = table.Column<string>(type: "TEXT", maxLength: 64, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_TuneSnapshots", x => x.Id);
                    table.ForeignKey(
                        name: "FK_TuneSnapshots_Fleet_AircraftId",
                        column: x => x.AircraftId,
                        principalTable: "Fleet",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "TuneSettings",
                columns: table => new
                {
                    Id = table.Column<int>(type: "INTEGER", nullable: false)
                        .Annotation("Sqlite:Autoincrement", true),
                    SnapshotId = table.Column<int>(type: "INTEGER", nullable: false),
                    Scope = table.Column<string>(type: "TEXT", maxLength: 40, nullable: false),
                    Key = table.Column<string>(type: "TEXT", maxLength: 120, nullable: false),
                    Value = table.Column<string>(type: "TEXT", maxLength: 1000, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_TuneSettings", x => x.Id);
                    table.ForeignKey(
                        name: "FK_TuneSettings_TuneSnapshots_SnapshotId",
                        column: x => x.SnapshotId,
                        principalTable: "TuneSnapshots",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_TuneSettings_SnapshotId",
                table: "TuneSettings",
                column: "SnapshotId");

            migrationBuilder.CreateIndex(
                name: "IX_TuneSnapshots_AircraftId_CreatedAt",
                table: "TuneSnapshots",
                columns: new[] { "AircraftId", "CreatedAt" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "TuneSettings");

            migrationBuilder.DropTable(
                name: "TuneSnapshots");

            migrationBuilder.DropTable(
                name: "Fleet");
        }
    }
}
