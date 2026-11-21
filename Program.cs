var builder = WebApplication.CreateBuilder(args);
var app = builder.Build();
app.MapGet("/notes", () => Results.Json(Array.Empty<string>()));
app.MapPost("/notes", () => Results.StatusCode(501));
app.Run();
