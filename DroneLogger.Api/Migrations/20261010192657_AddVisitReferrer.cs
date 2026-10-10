using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace DroneLogger.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddVisitReferrer : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "Referrer",
                table: "Visits",
                type: "TEXT",
                maxLength: 60,
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "Referrer",
                table: "Visits");
        }
    }
}
