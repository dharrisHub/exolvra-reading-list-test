using System.Text;
using System.Text.Json;

var builder = WebApplication.CreateBuilder(args);
var app = builder.Build();

var dataDirectory = Environment.GetEnvironmentVariable("NOTES_DATA_DIRECTORY");
if (string.IsNullOrWhiteSpace(dataDirectory))
{
    dataDirectory = Path.Combine(AppContext.BaseDirectory, "data");
}

var store = new NoteStore(dataDirectory);

app.MapGet("/notes", () => Results.Json(store.Snapshot()));

app.MapPost("/notes", async (HttpRequest request) =>
{
    string? text;
    try
    {
        using var document = await JsonDocument.ParseAsync(request.Body);
        if (document.RootElement.ValueKind != JsonValueKind.Object ||
            !document.RootElement.TryGetProperty("text", out var textElement) ||
            textElement.ValueKind != JsonValueKind.String)
        {
            return Results.Json(new { error = "Body must be a JSON object with a string \"text\" property." }, statusCode: 400);
        }
        text = textElement.GetString();
    }
    catch (JsonException)
    {
        return Results.Json(new { error = "Body must be valid JSON." }, statusCode: 400);
    }

    if (text is null)
    {
        return Results.Json(new { error = "\"text\" is required." }, statusCode: 400);
    }

    try
    {
        store.Add(text);
    }
    catch (NoteStoreFullException)
    {
        return Results.Json(new { error = "Note storage is full." }, statusCode: 507);
    }

    request.HttpContext.Response.Headers.Location = "/notes";
    return Results.Json(new SavedResponse(true), statusCode: 201);
});

app.Run();

internal sealed record SavedResponse(bool saved);

internal sealed class NoteStoreFullException : Exception
{
}

internal sealed class NoteStore
{
    private const long MaxFileBytes = 1_000_000;
    private static readonly UTF8Encoding Utf8NoBom = new(encoderShouldEmitUTF8Identifier: false);

    private readonly object _gate = new();
    private readonly List<string> _notes;
    private readonly string _directory;
    private readonly string _filePath;

    public NoteStore(string directory)
    {
        _directory = Path.GetFullPath(directory);
        Directory.CreateDirectory(_directory);
        _filePath = Path.Combine(_directory, "notes.json");
        _notes = Load(_filePath);
    }

    public string[] Snapshot()
    {
        lock (_gate)
        {
            return _notes.ToArray();
        }
    }

    public void Add(string text)
    {
        lock (_gate)
        {
            var candidate = new List<string>(_notes) { text };
            var bytes = JsonSerializer.SerializeToUtf8Bytes(candidate);
            if (bytes.LongLength > MaxFileBytes)
            {
                throw new NoteStoreFullException();
            }
            Persist(bytes);
            _notes.Add(text);
        }
    }

    private void Persist(byte[] bytes)
    {
        var tempPath = Path.Combine(_directory, $".notes.{Guid.NewGuid():N}.tmp");
        try
        {
            using (var stream = new FileStream(tempPath, FileMode.CreateNew, FileAccess.Write, FileShare.None))
            {
                stream.Write(bytes, 0, bytes.Length);
                stream.Flush(flushToDisk: true);
            }
            File.Move(tempPath, _filePath, overwrite: true);
        }
        finally
        {
            if (File.Exists(tempPath))
            {
                try { File.Delete(tempPath); } catch (IOException) { }
            }
        }
    }

    private static List<string> Load(string path)
    {
        if (!File.Exists(path))
        {
            return new List<string>();
        }
        var text = File.ReadAllText(path, Utf8NoBom);
        if (string.IsNullOrWhiteSpace(text))
        {
            return new List<string>();
        }
        var loaded = JsonSerializer.Deserialize<List<string?>>(text) ?? new List<string?>();
        return loaded.Where(n => n is not null).Select(n => n!).ToList();
    }
}
