using System.Text.Json;

namespace XenonEdgeHost;

// Persists the user's Game Mode blocklist next to config.json. A damaged file is never
// overwritten: the store reports "unavailable", applies no user entries, and rejects writes.
public sealed class GameBlocklistStore
{
    public const string FileName = "game-blocklist.json";
    private const int CurrentSchemaVersion = 1;
    private const int MaxDisplayNameLength = 120;

    private static readonly JsonSerializerOptions SerializerOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        WriteIndented = true
    };

    private readonly string _filePath;
    private readonly HostLogger _logger;
    private readonly object _sync = new();
    private List<BlockedItem> _entries = [];
    private HashSet<string> _blockedPaths = new(StringComparer.OrdinalIgnoreCase);
    private HashSet<string> _blockedLauncherIds = new(StringComparer.OrdinalIgnoreCase);
    private bool _available = true;

    public GameBlocklistStore(HostLogger logger)
        : this(logger, Path.Combine(AppPaths.RoamingDataDirectory, FileName))
    {
    }

    internal GameBlocklistStore(HostLogger logger, string filePath)
    {
        _logger = logger;
        _filePath = filePath;
        Load();
    }

    public bool IsAvailable
    {
        get
        {
            lock (_sync)
            {
                return _available;
            }
        }
    }

    public int Count
    {
        get
        {
            lock (_sync)
            {
                return _entries.Count;
            }
        }
    }

    public GameBlocklistSnapshot Snapshot()
    {
        lock (_sync)
        {
            return new GameBlocklistSnapshot
            {
                Status = _available ? "ready" : "unavailable",
                Message = _available ? "" : GameBlocklistUnavailableException.DefaultMessage,
                Entries = _entries.Select(Clone).ToList()
            };
        }
    }

    public (BlockedItem Entry, bool Added) Add(string? displayName, string? executablePath, string? launcherId, string? source)
    {
        var path = NormalizePath(executablePath);
        var launcher = launcherId?.Trim() ?? "";
        if (string.IsNullOrWhiteSpace(path) && string.IsNullOrWhiteSpace(launcher))
        {
            throw new ArgumentException("A blocked item needs an executable path or a launcher id.");
        }

        lock (_sync)
        {
            EnsureAvailable();
            var existing = _entries.FirstOrDefault(entry =>
                (!string.IsNullOrWhiteSpace(path) && string.Equals(entry.ExecutablePath, path, StringComparison.OrdinalIgnoreCase))
                || (!string.IsNullOrWhiteSpace(launcher) && string.Equals(entry.LauncherId, launcher, StringComparison.OrdinalIgnoreCase)));
            if (existing is not null)
            {
                return (Clone(existing), false);
            }

            var entry = new BlockedItem
            {
                Id = "block-" + Guid.NewGuid().ToString("N"),
                DisplayName = NormalizeDisplayName(displayName),
                ExecutablePath = path,
                LauncherId = launcher,
                Source = source?.Trim() ?? "",
                AddedAt = DateTimeOffset.UtcNow
            };
            var next = _entries.Concat([entry]).ToList();
            Save(next);
            Apply(next);
            return (Clone(entry), true);
        }
    }

    public bool Remove(string? id)
    {
        lock (_sync)
        {
            EnsureAvailable();
            var next = _entries
                .Where(entry => !string.Equals(entry.Id, id?.Trim(), StringComparison.Ordinal))
                .ToList();
            if (next.Count == _entries.Count)
            {
                return false;
            }

            Save(next);
            Apply(next);
            return true;
        }
    }

    public bool RemoveByExecutablePath(string? executablePath)
    {
        var path = NormalizePath(executablePath);
        if (string.IsNullOrWhiteSpace(path))
        {
            return false;
        }

        lock (_sync)
        {
            if (!_available)
            {
                return false;
            }

            var next = _entries
                .Where(entry => !string.Equals(entry.ExecutablePath, path, StringComparison.OrdinalIgnoreCase))
                .ToList();
            if (next.Count == _entries.Count)
            {
                return false;
            }

            Save(next);
            Apply(next);
            return true;
        }
    }

    public int Clear()
    {
        lock (_sync)
        {
            var removed = _entries.Count;
            if (File.Exists(_filePath))
            {
                File.Delete(_filePath);
                removed = Math.Max(removed, 1);
            }

            _available = true;
            Apply([]);
            return removed;
        }
    }

    public bool IsBlocked(string? executablePath, string? launcherId)
    {
        lock (_sync)
        {
            var path = NormalizePath(executablePath);
            var launcher = launcherId?.Trim() ?? "";
            return (!string.IsNullOrWhiteSpace(path) && _blockedPaths.Contains(path))
                || (!string.IsNullOrWhiteSpace(launcher) && _blockedLauncherIds.Contains(launcher));
        }
    }

    internal static string NormalizePath(string? path)
    {
        if (string.IsNullOrWhiteSpace(path))
        {
            return "";
        }

        try
        {
            return Path.GetFullPath(path.Trim());
        }
        catch
        {
            return path.Trim();
        }
    }

    private void Load()
    {
        try
        {
            if (!File.Exists(_filePath))
            {
                Apply([]);
                return;
            }

            var document = JsonSerializer.Deserialize<GameBlocklistDocument>(File.ReadAllText(_filePath), SerializerOptions)
                ?? throw new InvalidDataException("The blocklist file is empty.");
            if (document.SchemaVersion != CurrentSchemaVersion || document.Entries is null)
            {
                throw new InvalidDataException($"Unsupported blocklist schema version {document.SchemaVersion}.");
            }

            var entries = document.Entries
                .Where(entry => entry is not null
                    && (!string.IsNullOrWhiteSpace(entry.ExecutablePath) || !string.IsNullOrWhiteSpace(entry.LauncherId)))
                .Select(entry => new BlockedItem
                {
                    Id = string.IsNullOrWhiteSpace(entry.Id) ? "block-" + Guid.NewGuid().ToString("N") : entry.Id.Trim(),
                    DisplayName = NormalizeDisplayName(entry.DisplayName),
                    ExecutablePath = NormalizePath(entry.ExecutablePath),
                    LauncherId = entry.LauncherId?.Trim() ?? "",
                    Source = entry.Source?.Trim() ?? "",
                    AddedAt = entry.AddedAt
                })
                .ToList();
            _available = true;
            Apply(entries);
        }
        catch (Exception error)
        {
            // Keep the damaged file untouched so the user's data is never discarded silently.
            _available = false;
            Apply([]);
            _logger.Error("The Game Mode blocklist could not be read. Detection continues with the built-in rules.", error);
        }
    }

    private void Save(List<BlockedItem> entries)
    {
        var document = new GameBlocklistDocument
        {
            SchemaVersion = CurrentSchemaVersion,
            Entries = entries
        };
        AtomicFile.WriteAllText(_filePath, JsonSerializer.Serialize(document, SerializerOptions));
    }

    private void Apply(List<BlockedItem> entries)
    {
        _entries = entries;
        _blockedPaths = new HashSet<string>(
            entries.Where(entry => !string.IsNullOrWhiteSpace(entry.ExecutablePath)).Select(entry => entry.ExecutablePath),
            StringComparer.OrdinalIgnoreCase);
        _blockedLauncherIds = new HashSet<string>(
            entries.Where(entry => !string.IsNullOrWhiteSpace(entry.LauncherId)).Select(entry => entry.LauncherId),
            StringComparer.OrdinalIgnoreCase);
    }

    private void EnsureAvailable()
    {
        if (!_available)
        {
            throw new GameBlocklistUnavailableException();
        }
    }

    private static string NormalizeDisplayName(string? value)
    {
        var name = value?.Trim() ?? "";
        if (name.Length == 0)
        {
            return "App";
        }

        return name.Length > MaxDisplayNameLength ? name[..MaxDisplayNameLength] : name;
    }

    private static BlockedItem Clone(BlockedItem item)
    {
        return new BlockedItem
        {
            Id = item.Id,
            DisplayName = item.DisplayName,
            ExecutablePath = item.ExecutablePath,
            LauncherId = item.LauncherId,
            Source = item.Source,
            AddedAt = item.AddedAt
        };
    }
}
