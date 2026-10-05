using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace DroneLogger.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddFlightBattery : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<double>(
                name: "AvgCurrentA",
                table: "Flights",
                type: "REAL",
                nullable: true);

            migrationBuilder.AddColumn<double>(
                name: "AvgSpeedMs",
                table: "Flights",
                type: "REAL",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "BatteryJson",
                table: "Flights",
                type: "TEXT",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "CellCount",
                table: "Flights",
                type: "INTEGER",
                nullable: true);

            migrationBuilder.AddColumn<double>(
                name: "EndVoltage",
                table: "Flights",
                type: "REAL",
                nullable: true);

            migrationBuilder.AddColumn<double>(
                name: "MahUsed",
                table: "Flights",
                type: "REAL",
                nullable: true);

            migrationBuilder.AddColumn<double>(
                name: "MinVoltage",
                table: "Flights",
                type: "REAL",
                nullable: true);

            migrationBuilder.AddColumn<double>(
                name: "PeakCurrentA",
                table: "Flights",
                type: "REAL",
                nullable: true);

            migrationBuilder.AddColumn<double>(
                name: "PeakPowerW",
                table: "Flights",
                type: "REAL",
                nullable: true);

            migrationBuilder.AddColumn<double>(
                name: "StartVoltage",
                table: "Flights",
                type: "REAL",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "AvgCurrentA",
                table: "Flights");

            migrationBuilder.DropColumn(
                name: "AvgSpeedMs",
                table: "Flights");

            migrationBuilder.DropColumn(
                name: "BatteryJson",
                table: "Flights");

            migrationBuilder.DropColumn(
                name: "CellCount",
                table: "Flights");

            migrationBuilder.DropColumn(
                name: "EndVoltage",
                table: "Flights");

            migrationBuilder.DropColumn(
                name: "MahUsed",
                table: "Flights");

            migrationBuilder.DropColumn(
                name: "MinVoltage",
                table: "Flights");

            migrationBuilder.DropColumn(
                name: "PeakCurrentA",
                table: "Flights");

            migrationBuilder.DropColumn(
                name: "PeakPowerW",
                table: "Flights");

            migrationBuilder.DropColumn(
                name: "StartVoltage",
                table: "Flights");
        }
    }
}
