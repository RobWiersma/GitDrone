using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace DroneLogger.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddFlightGps : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<double>(
                name: "DistanceM",
                table: "Flights",
                type: "REAL",
                nullable: true);

            migrationBuilder.AddColumn<double>(
                name: "HomeLat",
                table: "Flights",
                type: "REAL",
                nullable: true);

            migrationBuilder.AddColumn<double>(
                name: "HomeLon",
                table: "Flights",
                type: "REAL",
                nullable: true);

            migrationBuilder.AddColumn<double>(
                name: "MaxDistanceM",
                table: "Flights",
                type: "REAL",
                nullable: true);

            migrationBuilder.AddColumn<double>(
                name: "MaxHeightM",
                table: "Flights",
                type: "REAL",
                nullable: true);

            migrationBuilder.AddColumn<double>(
                name: "MaxSpeedMs",
                table: "Flights",
                type: "REAL",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "TrackJson",
                table: "Flights",
                type: "TEXT",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "DistanceM",
                table: "Flights");

            migrationBuilder.DropColumn(
                name: "HomeLat",
                table: "Flights");

            migrationBuilder.DropColumn(
                name: "HomeLon",
                table: "Flights");

            migrationBuilder.DropColumn(
                name: "MaxDistanceM",
                table: "Flights");

            migrationBuilder.DropColumn(
                name: "MaxHeightM",
                table: "Flights");

            migrationBuilder.DropColumn(
                name: "MaxSpeedMs",
                table: "Flights");

            migrationBuilder.DropColumn(
                name: "TrackJson",
                table: "Flights");
        }
    }
}
