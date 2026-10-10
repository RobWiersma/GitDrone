using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace DroneLogger.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddVisits : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "Visits",
                columns: table => new
                {
                    Id = table.Column<int>(type: "INTEGER", nullable: false)
                        .Annotation("Sqlite:Autoincrement", true),
                    Day = table.Column<DateOnly>(type: "TEXT", nullable: false),
                    VisitorHash = table.Column<string>(type: "TEXT", maxLength: 16, nullable: false),
                    Path = table.Column<string>(type: "TEXT", maxLength: 80, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Visits", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "VisitSalts",
                columns: table => new
                {
                    Day = table.Column<DateOnly>(type: "TEXT", nullable: false),
                    Salt = table.Column<string>(type: "TEXT", maxLength: 64, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_VisitSalts", x => x.Day);
                });

            migrationBuilder.CreateIndex(
                name: "IX_Visits_Day_VisitorHash_Path",
                table: "Visits",
                columns: new[] { "Day", "VisitorHash", "Path" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "Visits");

            migrationBuilder.DropTable(
                name: "VisitSalts");
        }
    }
}
