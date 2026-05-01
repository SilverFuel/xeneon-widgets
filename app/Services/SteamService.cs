using System.Diagnostics;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;
using Microsoft.Win32;

namespace XenonEdgeHost;

public sealed class SteamService
{
    private static readonly TimeSpan CacheDuration = TimeSpan.FromSeconds(20);
    private readonly HostLogger _logger;
    private readonly object _sync = new();
    private SteamGamesSnapshot? _cachedSnapshot;
    private DateTimeOffset _cachedAt = DateTimeOffset.MinValue;

    public SteamService(HostLogger logger)
    {
        _logger = logger;
    }

    public SteamGamesSnapshot GetSnapshot(bool forceRefresh = false)
    {
        lock (_sync)
        {
            if (!forceRefresh
                && _cachedSnapshot is not null
                && DateTimeOffset.UtcNow - _cachedAt < CacheDuration)
            {
                return _cachedSnapshot;
            }

            _cachedSnapshot = BuildSnapshot();
            _cachedAt = DateTimeOffset.UtcNow;
            return _cachedSnapshot;
        }
    }

    public SteamLaunchResult Launch(string? appId)
    {
        var normalizedAppId = NormalizeAppId(appId);
        if (string.IsNullOrWhiteSpace(normalizedAppId))
        {
            throw new InvalidOperationException("Steam game id is missing.");
        }

        var snapshot = GetSnapshot();
        var game = snapshot.Games.FirstOrDefault(entry =>
            string.Equals(entry.AppId, normalizedAppId, StringComparison.OrdinalIgnoreCase));

        if (game is null)
        {
            throw new InvalidOperationException("Steam game was not found in the installed library scan.");
        }

        var launchUri = $"steam://rungameid/{game.AppId}";
        Process.Start(new ProcessStartInfo
        {
            FileName = launchUri,
            UseShellExecute = true
        });

        return new SteamLaunchResult
        {
            Ok = true,
            AppId = game.AppId,
            Name = game.Name,
            Message = $"Launching {game.Name}.",
            LaunchedAt = DateTimeOffset.UtcNow
        };
    }

    public bool TryGetArtwork(string? appId, out LauncherIconAsset asset)
    {
        asset = default;
        var normalizedAppId = NormalizeAppId(appId);
        if (string.IsNullOrWhiteSpace(normalizedAppId))
        {
            return false;
        }

        var game = GetSnapshot().Games.FirstOrDefault(entry =>
            string.Equals(entry.AppId, normalizedAppId, StringComparison.OrdinalIgnoreCase));

        if (game is null || string.IsNullOrWhiteSpace(game.ArtworkPath) || !File.Exists(game.ArtworkPath))
        {
            return false;
        }

        asset = new LauncherIconAsset(GetContentType(game.ArtworkPath), File.ReadAllBytes(game.ArtworkPath));
        return true;
    }

    private SteamGamesSnapshot BuildSnapshot()
    {
        try
        {
            var steamRoot = ResolveSteamRoot();
            if (string.IsNullOrWhiteSpace(steamRoot) || !Directory.Exists(steamRoot))
            {
                return new SteamGamesSnapshot
                {
                    Supported = false,
                    Configured = false,
                    Status = "setup",
                    Source = "Steam library manifests",
                    Message = "Steam was not found on this PC.",
                    SampledAt = DateTimeOffset.UtcNow
                };
            }

            var libraries = ResolveLibraryPaths(steamRoot);
            var games = libraries
                .SelectMany(library => ReadLibraryGames(steamRoot, library))
                .GroupBy(game => game.AppId, StringComparer.OrdinalIgnoreCase)
                .Select(group => group.First())
                .Where(game => IsLikelyGame(game))
                .OrderByDescending(game => game.LastPlayed ?? DateTimeOffset.MinValue)
                .ThenBy(game => game.Name, StringComparer.OrdinalIgnoreCase)
                .ToList();
            var activeGame = ResolveRunningGame(games);

            var sampledAt = DateTimeOffset.UtcNow;
            return new SteamGamesSnapshot
            {
                Supported = true,
                Configured = games.Count > 0,
                Status = games.Count > 0 ? "live" : "setup",
                SampledAt = sampledAt,
                Stale = false,
                Source = "Steam library manifests",
                Message = activeGame is not null
                    ? $"{activeGame.Name} is running."
                    : games.Count > 0
                    ? $"{games.Count} installed Steam game{(games.Count == 1 ? "" : "s")} found."
                    : "Steam is installed, but no installed games were found.",
                SteamDetected = true,
                LibraryCount = libraries.Count,
                ActiveGame = activeGame,
                Games = games
            };
        }
        catch (Exception error)
        {
            _logger.Warn($"Steam library scan failed: {error.Message}");
            return new SteamGamesSnapshot
            {
                Supported = false,
                Configured = false,
                Status = "error",
                SampledAt = DateTimeOffset.UtcNow,
                Source = "Steam library manifests",
                Message = "Steam library scan failed."
            };
        }
    }

    private static IEnumerable<SteamGamePayload> ReadLibraryGames(string steamRoot, string libraryPath)
    {
        var steamAppsPath = Path.Combine(libraryPath, "steamapps");
        if (!Directory.Exists(steamAppsPath))
        {
            yield break;
        }

        foreach (var manifestPath in EnumerateFilesSafe(steamAppsPath, "appmanifest_*.acf", SearchOption.TopDirectoryOnly))
        {
            var fields = ReadManifestFields(manifestPath);
            var appId = TextOr(GetField(fields, "appid"), Path.GetFileNameWithoutExtension(manifestPath).Replace("appmanifest_", "", StringComparison.OrdinalIgnoreCase));
            appId = NormalizeAppId(appId);
            var name = TextOr(GetField(fields, "name"), "Steam Game");
            var installDir = TextOr(GetField(fields, "installdir"), "");
            var installPath = string.IsNullOrWhiteSpace(installDir)
                ? ""
                : Path.Combine(steamAppsPath, "common", installDir);
            var artworkPath = ResolveArtworkPath(steamRoot, appId);
            var lastPlayed = ParseUnixTime(GetField(fields, "LastPlayed"));
            var sizeOnDisk = ParseLong(GetField(fields, "SizeOnDisk"));

            if (string.IsNullOrWhiteSpace(appId))
            {
                continue;
            }

            yield return new SteamGamePayload
            {
                AppId = appId,
                Name = name,
                Installed = true,
                LastPlayed = lastPlayed,
                SizeOnDisk = sizeOnDisk,
                ArtworkUrl = string.IsNullOrWhiteSpace(artworkPath)
                    ? ""
                    : "/api/steam/games/art?id=" + Uri.EscapeDataString(appId),
                TileLabel = ResolveTileLabel(name),
                LibraryPath = libraryPath,
                InstallPath = installPath,
                ArtworkPath = artworkPath
            };
        }
    }

    private static Dictionary<string, string> ReadManifestFields(string manifestPath)
    {
        var fields = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        try
        {
            foreach (var line in File.ReadLines(manifestPath))
            {
                var match = Regex.Match(line, "^\\s*\"(?<key>[^\"]+)\"\\s+\"(?<value>(?:\\\\.|[^\"])*)\"");
                if (!match.Success)
                {
                    continue;
                }

                fields[match.Groups["key"].Value] = DecodeVdfValue(match.Groups["value"].Value);
            }
        }
        catch
        {
        }

        return fields;
    }

    private static string ResolveSteamRoot()
    {
        var candidates = new List<string>();
        AddRegistryValue(candidates, Registry.CurrentUser, @"Software\Valve\Steam", "SteamPath");
        AddRegistryValue(candidates, Registry.LocalMachine, @"SOFTWARE\WOW6432Node\Valve\Steam", "InstallPath");
        AddRegistryValue(candidates, Registry.LocalMachine, @"SOFTWARE\Valve\Steam", "InstallPath");

        candidates.Add(Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86),
            "Steam"));

        return candidates
            .Select(NormalizePath)
            .Where(path => !string.IsNullOrWhiteSpace(path) && Directory.Exists(path))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .FirstOrDefault() ?? "";
    }

    private static List<string> ResolveLibraryPaths(string steamRoot)
    {
        var libraries = new List<string> { steamRoot };
        var libraryFoldersPath = Path.Combine(steamRoot, "steamapps", "libraryfolders.vdf");
        if (!File.Exists(libraryFoldersPath))
        {
            return libraries;
        }

        foreach (var line in File.ReadLines(libraryFoldersPath))
        {
            var pathMatch = Regex.Match(line, "^\\s*\"path\"\\s+\"(?<path>(?:\\\\.|[^\"])*)\"");
            if (pathMatch.Success)
            {
                AddLibraryPath(libraries, DecodeVdfValue(pathMatch.Groups["path"].Value));
                continue;
            }

            var legacyMatch = Regex.Match(line, "^\\s*\"\\d+\"\\s+\"(?<path>(?:\\\\.|[^\"])*)\"");
            if (legacyMatch.Success)
            {
                AddLibraryPath(libraries, DecodeVdfValue(legacyMatch.Groups["path"].Value));
            }
        }

        return libraries
            .Select(NormalizePath)
            .Where(path => !string.IsNullOrWhiteSpace(path) && Directory.Exists(Path.Combine(path, "steamapps")))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();
    }

    private static string ResolveArtworkPath(string steamRoot, string appId)
    {
        var root = Path.Combine(steamRoot, "appcache", "librarycache", appId);
        if (!Directory.Exists(root))
        {
            return "";
        }

        var priority = new[]
        {
            "library_600x900.jpg",
            "library_capsule.jpg",
            "header.jpg",
            "library_header.jpg",
            "logo.png"
        };

        foreach (var fileName in priority)
        {
            var direct = Path.Combine(root, fileName);
            if (File.Exists(direct))
            {
                return direct;
            }

            var nested = EnumerateFilesSafe(root, fileName, SearchOption.AllDirectories).FirstOrDefault();
            if (!string.IsNullOrWhiteSpace(nested))
            {
                return nested;
            }
        }

        return EnumerateFilesSafe(root, "*.*", SearchOption.AllDirectories)
            .Where(path => IsSupportedImage(path))
            .OrderBy(path => Path.GetFileName(path).Contains("logo", StringComparison.OrdinalIgnoreCase) ? 1 : 0)
            .FirstOrDefault() ?? "";
    }

    private static IEnumerable<string> EnumerateFilesSafe(string root, string pattern, SearchOption searchOption)
    {
        try
        {
            return Directory.EnumerateFiles(root, pattern, searchOption).ToList();
        }
        catch
        {
            return Array.Empty<string>();
        }
    }

    private static bool IsLikelyGame(SteamGamePayload game)
    {
        if (string.Equals(game.AppId, "228980", StringComparison.OrdinalIgnoreCase))
        {
            return false;
        }

        var name = game.Name ?? "";
        return !name.Contains("redistributable", StringComparison.OrdinalIgnoreCase)
            && !name.Contains("steamworks common", StringComparison.OrdinalIgnoreCase)
            && !name.Contains("proton ", StringComparison.OrdinalIgnoreCase)
            && !name.Contains("runtime", StringComparison.OrdinalIgnoreCase);
    }

    private static SteamGamePayload? ResolveRunningGame(IReadOnlyList<SteamGamePayload> games)
    {
        var installedGames = games
            .Where(game => !string.IsNullOrWhiteSpace(game.InstallPath) && Directory.Exists(game.InstallPath))
            .ToList();

        if (installedGames.Count == 0)
        {
            return null;
        }

        foreach (var process in Process.GetProcesses())
        {
            try
            {
                var processPath = process.MainModule?.FileName;
                if (string.IsNullOrWhiteSpace(processPath))
                {
                    continue;
                }

                var normalizedProcessPath = NormalizePath(processPath);
                var game = installedGames.FirstOrDefault(entry => IsPathInside(normalizedProcessPath, entry.InstallPath));
                if (game is not null)
                {
                    return game;
                }
            }
            catch
            {
            }
            finally
            {
                process.Dispose();
            }
        }

        return null;
    }

    private static bool IsPathInside(string path, string directory)
    {
        if (string.IsNullOrWhiteSpace(path) || string.IsNullOrWhiteSpace(directory))
        {
            return false;
        }

        var normalizedDirectory = NormalizePath(directory).TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar)
                                  + Path.DirectorySeparatorChar;
        var normalizedPath = NormalizePath(path);
        return normalizedPath.StartsWith(normalizedDirectory, StringComparison.OrdinalIgnoreCase);
    }

    private static void AddRegistryValue(List<string> candidates, RegistryKey root, string subKey, string valueName)
    {
        try
        {
            using var key = root.OpenSubKey(subKey);
            if (key?.GetValue(valueName) is string value && !string.IsNullOrWhiteSpace(value))
            {
                candidates.Add(value);
            }
        }
        catch
        {
        }
    }

    private static void AddLibraryPath(List<string> libraries, string path)
    {
        if (!string.IsNullOrWhiteSpace(path))
        {
            libraries.Add(path);
        }
    }

    private static DateTimeOffset? ParseUnixTime(string value)
    {
        if (!long.TryParse(value, out var seconds) || seconds <= 0)
        {
            return null;
        }

        try
        {
            return DateTimeOffset.FromUnixTimeSeconds(seconds);
        }
        catch
        {
            return null;
        }
    }

    private static long? ParseLong(string value)
    {
        return long.TryParse(value, out var parsed) && parsed > 0 ? parsed : null;
    }

    private static string NormalizePath(string path)
    {
        try
        {
            return string.IsNullOrWhiteSpace(path) ? "" : Path.GetFullPath(path.Trim());
        }
        catch
        {
            return path.Trim();
        }
    }

    private static string NormalizeAppId(string? appId)
    {
        var value = (appId ?? "").Trim();
        return value.All(char.IsDigit) ? value : "";
    }

    private static string DecodeVdfValue(string value)
    {
        return value
            .Replace("\\\"", "\"", StringComparison.Ordinal)
            .Replace(@"\\", @"\", StringComparison.Ordinal)
            .Replace(@"\/", "/", StringComparison.Ordinal);
    }

    private static string GetField(IReadOnlyDictionary<string, string> fields, string key)
    {
        return fields.TryGetValue(key, out var value) ? value : "";
    }

    private static string TextOr(string? value, string fallback)
    {
        return string.IsNullOrWhiteSpace(value) ? fallback : value.Trim();
    }

    private static string ResolveTileLabel(string name)
    {
        var parts = Regex.Split(name.Trim(), "\\s+")
            .Where(part => !string.IsNullOrWhiteSpace(part))
            .Take(2)
            .Select(part => part[0].ToString().ToUpperInvariant());
        var label = string.Concat(parts);
        return string.IsNullOrWhiteSpace(label) ? "S" : label;
    }

    private static bool IsSupportedImage(string path)
    {
        return Path.GetExtension(path).ToLowerInvariant() is ".jpg" or ".jpeg" or ".png" or ".webp";
    }

    private static string GetContentType(string path)
    {
        return Path.GetExtension(path).ToLowerInvariant() switch
        {
            ".png" => "image/png",
            ".jpg" => "image/jpeg",
            ".jpeg" => "image/jpeg",
            ".webp" => "image/webp",
            _ => "application/octet-stream"
        };
    }
}

public sealed class SteamGamesSnapshot
{
    public bool Supported { get; set; } = true;

    public bool Configured { get; set; }

    public string Status { get; set; } = "setup";

    public DateTimeOffset? SampledAt { get; set; }

    public bool Stale { get; set; }

    public string Message { get; set; } = "";

    public string Source { get; set; } = "Steam library manifests";

    public bool SteamDetected { get; set; }

    public int LibraryCount { get; set; }

    public SteamGamePayload? ActiveGame { get; set; }

    public List<SteamGamePayload> Games { get; set; } = [];
}

public sealed class SteamGamePayload
{
    public string AppId { get; set; } = "";

    public string Name { get; set; } = "";

    public bool Installed { get; set; }

    public DateTimeOffset? LastPlayed { get; set; }

    public long? SizeOnDisk { get; set; }

    public string ArtworkUrl { get; set; } = "";

    public string TileLabel { get; set; } = "S";

    [JsonIgnore]
    public string LibraryPath { get; set; } = "";

    [JsonIgnore]
    public string InstallPath { get; set; } = "";

    [JsonIgnore]
    public string ArtworkPath { get; set; } = "";
}

public sealed class SteamGameLaunchRequest
{
    public string? AppId { get; set; }
}

public sealed class SteamLaunchResult
{
    public bool Ok { get; set; }

    public string AppId { get; set; } = "";

    public string Name { get; set; } = "";

    public string Message { get; set; } = "";

    public DateTimeOffset LaunchedAt { get; set; }
}
