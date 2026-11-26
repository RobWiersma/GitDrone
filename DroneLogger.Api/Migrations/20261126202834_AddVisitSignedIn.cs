using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace DroneLogger.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddVisitSignedIn : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<bool>(
                name: "SignedIn",
                table: "Visits",
                type: "INTEGER",
                nullable: false,
                defaultValue: false);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "SignedIn",
                table: "Visits");
        }
    }
}
