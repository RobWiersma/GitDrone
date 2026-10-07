using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace DroneLogger.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddFlightTelemetry : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<double>(
                name: "MaxBaroHeightM",
                table: "Flights",
                type: "REAL",
                nullable: true);

            migrationBuilder.AddColumn<double>(
                name: "MinRssiPercent",
                table: "Flights",
                type: "REAL",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "TelemetryJson",
                table: "Flights",
                type: "TEXT",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "MaxBaroHeightM",
                table: "Flights");

            migrationBuilder.DropColumn(
                name: "MinRssiPercent",
                table: "Flights");

            migrationBuilder.DropColumn(
                name: "TelemetryJson",
                table: "Flights");
        }
    }
}
