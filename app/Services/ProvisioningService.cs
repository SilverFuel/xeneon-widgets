using System.Reflection;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;

namespace XenonEdgeHost;

public sealed class ProvisioningService
{
    private const int ProvisioningVersion = 1;
    private const int MaxAutoLaunchers = 12;

    private static readonly string[] LauncherSkipWords =
    [
        "uninstall",
        "readme",
        "license",
        "documentation",
        "manual",
        "help",
        "setup",
        "install",
        "updater",
        "update",
        "repair",
        "crash",
        "safe mode"
    ];

    private static readonly string[] LauncherBoostWords =
    [
        "steam",
        "discord",
        "obs",
        "corsair",
        "icue",
        "spotify",
        "chrome",
        "firefox",
        "edge",
        "epic",
        "battle.net",
        "nvidia",
        "xbox",
        "gog",
        "ubisoft"
    ];

    private readonly ConfigStore _configStore;
    private readonly SteamService _steamService;
    private readonly HostLogger _logger;
    private readonly object _sync = new();
    private ProvisioningSnapshot _lastSnapshot = ProvisioningSnapshot.CreatePending();

    public ProvisioningService(ConfigStore configStore, SteamService steamService, HostLogger logger)
    {
        _configStore = configStore;
        _steamService = steamService;
        _logger = logger;
    }

    public ProvisioningSnapshot GetSnapshot()
    {
        lock (_sync)
        {
            return _lastSnapshot.Clone();
        }
    }

    public ProvisioningSnapshot RunStartupProvisioning(bool forceLauncherScan = false)
    {
        var startedAt = DateTimeOffset.UtcNow;
        var actions = new List<ProvisioningActionPayload>();
        var initialConfig = _configStore.Snapshot();
        var detectedLaunchers = new List<DiscoveredLauncherEntry>();
        var steamSnapshot = new SteamGamesSnapshot();
        var suggestedLaunchers = new List<LauncherEntryConfig>();
        var shouldScanLaunchers = initialConfig.Dashboard.AutoProvisioningEnabled
            && (forceLauncherScan || initialConfig.Launchers.Count == 0);

        if (shouldScanLaunchers)
        {
            detectedLaunchers = DiscoverLauncherEntries();
            steamSnapshot = GetSteamSnapshot();
            suggestedLaunchers = BuildLauncherDefaults(detectedLaunchers, steamSnapshot);
        }

        AppConfig updatedConfig;
        if (!initialConfig.Dashboard.AutoProvisioningEnabled)
        {
            actions.Add(new ProvisioningActionPayload
            {
                Id = "auto-provisioning",
                Label = "Auto provisioning",
                State = "Disabled",
                Message = "Automatic setup is disabled in local config."
            });
            updatedConfig = initialConfig;
        }
        else
        {
            updatedConfig = _configStore.Update(current =>
            {
                if (!current.Dashboard.AutoProvisioningEnabled)
                {
                    actions.Add(new ProvisioningActionPayload
                    {
                        Id = "auto-provisioning",
                        Label = "Auto provisioning",
                        State = "Disabled",
                        Message = "Automatic setup is disabled in local config."
                    });
                    return current;
                }

                if (!current.Dashboard.OnboardingCompleted)
                {
                    actions.Add(new ProvisioningActionPayload
                    {
                        Id = "dashboard",
                        Label = "Dashboard onboarding",
                        State = "Ready",
                        Message = "Core dashboard setup was completed automatically."
                    });
                }

                current.Dashboard.OnboardingCompleted = true;
                current.Dashboard.OnboardingCompletedAt = string.IsNullOrWhiteSpace(current.Dashboard.OnboardingCompletedAt)
                    ? startedAt.ToString("O")
                    : current.Dashboard.OnboardingCompletedAt;
                current.Dashboard.OnboardingVersion = Math.Max(1, current.Dashboard.OnboardingVersion);
                current.Dashboard.AutoProvisionedAt = startedAt.ToString("O");
                current.Dashboard.AutoProvisioningVersion = ProvisioningVersion;

                if (current.Launchers.Count == 0
                    && suggestedLaunchers.Count > 0
                    && current.Dashboard.LauncherReviewRequired
                    && !current.Dashboard.AutoApplyLauncherSuggestions)
                {
                    actions.Add(new ProvisioningActionPayload
                    {
                        Id = "launchers",
                        Label = "App launcher",
                        State = "Review",
                        Message = $"Found {suggestedLaunchers.Count} launcher suggestion{(suggestedLaunchers.Count == 1 ? "" : "s")} for review."
                    });
                }
                else if (current.Launchers.Count == 0 && suggestedLaunchers.Count > 0)
                {
                    current.Launchers = suggestedLaunchers;
                    actions.Add(new ProvisioningActionPayload
                    {
                        Id = "launchers",
                        Label = "App launcher",
                        State = "Ready",
                        Message = $"Pinned {suggestedLaunchers.Count} detected app{(suggestedLaunchers.Count == 1 ? "" : "s")} automatically."
                    });
                }
                else if (forceLauncherScan && suggestedLaunchers.Count > 0)
                {
                    var before = current.Launchers.Count;
                    current.Launchers = MergeLaunchers(current.Launchers, suggestedLaunchers);
                    var added = current.Launchers.Count - before;
                    actions.Add(new ProvisioningActionPayload
                    {
                        Id = "launchers",
                        Label = "App launcher",
                        State = added > 0 ? "Ready" : "Current",
                        Message = added > 0
                            ? $"Added {added} newly detected app{(added == 1 ? "" : "s")}."
                            : "No new launcher apps were found."
                    });
                }
                else if (current.Launchers.Count > 0)
                {
                    actions.Add(new ProvisioningActionPayload
                    {
                        Id = "launchers",
                        Label = "App launcher",
                        State = "Ready",
                        Message = $"{current.Launchers.Count} launcher entr{(current.Launchers.Count == 1 ? "y is" : "ies are")} already configured."
                    });
                }
                else
                {
                    actions.Add(new ProvisioningActionPayload
                    {
                        Id = "launchers",
                        Label = "App launcher",
                        State = "Optional",
                        Message = shouldScanLaunchers
                            ? "No safe Start Menu shortcuts or Steam games were found. The dashboard still works without them."
                            : "Launcher scanning was skipped because no changes were needed."
                    });
                }

                return current;
            });
        }

        var snapshot = new ProvisioningSnapshot
        {
            Supported = true,
            Configured = updatedConfig.Dashboard.AutoProvisioningEnabled,
            Status = updatedConfig.Dashboard.AutoProvisioningEnabled ? "live" : "disabled",
            SampledAt = startedAt,
            Stale = false,
            Source = "native startup scan",
            Message = updatedConfig.Dashboard.AutoProvisioningEnabled
                ? shouldScanLaunchers
                    ? "Xenon scanned this PC and prepared the dashboard automatically."
                    : "Xenon confirmed the existing setup and skipped unnecessary launcher scanning."
                : "Automatic setup is disabled.",
            AutoCompleted = updatedConfig.Dashboard.OnboardingCompleted,
            LauncherCount = updatedConfig.Launchers.Count,
            DetectedLauncherCount = detectedLaunchers.Count,
            SteamGameCount = steamSnapshot.Games.Count,
            SuggestedLaunchers = suggestedLaunchers.Select(CreateSuggestionPayload).ToList(),
            Actions = actions,
            PermissionNeeded = BuildPermissionNeeded(updatedConfig)
        };

        lock (_sync)
        {
            _lastSnapshot = snapshot.Clone();
        }

        _logger.Info($"{snapshot.Message} Launchers={snapshot.LauncherCount}, SteamGames={snapshot.SteamGameCount}.");
        return snapshot;
    }

    public ProvisioningSnapshot ApplyLauncherSuggestions(IReadOnlyCollection<string>? ids)
    {
        var selectedIds = new HashSet<string>(ids ?? [], StringComparer.OrdinalIgnoreCase);
        ProvisioningSnapshot snapshot;
        lock (_sync)
        {
            snapshot = _lastSnapshot.Clone();
        }

        var suggestions = snapshot.SuggestedLaunchers
            .Where(suggestion => selectedIds.Count == 0 || selectedIds.Contains(suggestion.Id))
            .Select(suggestion => new LauncherEntryConfig
            {
                Id = suggestion.Id,
                DisplayName = suggestion.DisplayName,
                IconPath = suggestion.IconPath,
                ExecutablePath = suggestion.ExecutablePath,
                Arguments = suggestion.Arguments
            })
            .ToList();

        var updatedConfig = _configStore.Update(current =>
        {
            current.Launchers = MergeLaunchers(current.Launchers, suggestions);
            current.Dashboard.LauncherReviewRequired = true;
            return current;
        });

        snapshot.LauncherCount = updatedConfig.Launchers.Count;
        snapshot.Status = "live";
        snapshot.Message = suggestions.Count > 0
            ? $"Pinned {suggestions.Count} reviewed launcher suggestion{(suggestions.Count == 1 ? "" : "s")}."
            : "No launcher suggestions were selected.";
        snapshot.SuggestedLaunchers = selectedIds.Count == 0
            ? []
            : snapshot.SuggestedLaunchers
                .Where(suggestion => !selectedIds.Contains(suggestion.Id))
                .ToList();
        snapshot.Actions.Add(new ProvisioningActionPayload
        {
            Id = "launchers-reviewed",
            Label = "Launcher review",
            State = suggestions.Count > 0 ? "Ready" : "Optional",
            Message = snapshot.Message
        });

        lock (_sync)
        {
            _lastSnapshot = snapshot.Clone();
        }

        return snapshot;
    }

    private SteamGamesSnapshot GetSteamSnapshot()
    {
        try
        {
            return _steamService.GetSnapshot();
        }
        catch (Exception error)
        {
            _logger.Warn($"Steam scan skipped during provisioning: {error.Message}");
            return new SteamGamesSnapshot
            {
                Supported = false,
                Configured = false,
                Status = "error",
                Source = "Steam library manifests",
                Message = "Steam scan failed during provisioning."
            };
        }
    }

    private static List<LauncherEntryConfig> BuildLauncherDefaults(
        IReadOnlyCollection<DiscoveredLauncherEntry> detectedLaunchers,
        SteamGamesSnapshot steamSnapshot)
    {
        var entries = new List<LauncherEntryConfig>();
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        foreach (var detected in detectedLaunchers
                     .OrderByDescending(entry => entry.Score)
                     .ThenBy(entry => entry.DisplayName, StringComparer.OrdinalIgnoreCase))
        {
            if (entries.Count >= MaxAutoLaunchers)
            {
                break;
            }

            var key = BuildLauncherKey(detected.ExecutablePath, detected.Arguments);
            if (!seen.Add(key))
            {
                continue;
            }

            entries.Add(new LauncherEntryConfig
            {
                Id = BuildStableId("auto", key),
                DisplayName = detected.DisplayName,
                IconPath = detected.IconPath,
                ExecutablePath = detected.ExecutablePath,
                Arguments = detected.Arguments
            });
        }

        foreach (var game in steamSnapshot.Games
                     .Where(game => !string.IsNullOrWhiteSpace(game.AppId))
                     .Take(6))
        {
            if (entries.Count >= MaxAutoLaunchers)
            {
                break;
            }

            var launchUri = $"steam://rungameid/{game.AppId}";
            var key = BuildLauncherKey(launchUri, "");
            if (!seen.Add(key))
            {
                continue;
            }

            entries.Add(new LauncherEntryConfig
            {
                Id = BuildStableId("steam", game.AppId),
                DisplayName = game.Name,
                IconPath = game.ArtworkPath,
                ExecutablePath = launchUri,
                Arguments = ""
            });
        }

        return entries;
    }

    private static List<LauncherEntryConfig> MergeLaunchers(
        IReadOnlyCollection<LauncherEntryConfig> existing,
        IReadOnlyCollection<LauncherEntryConfig> suggested)
    {
        var merged = existing.ToList();
        var seen = new HashSet<string>(
            merged.Select(entry => BuildLauncherKey(entry.ExecutablePath, entry.Arguments)),
            StringComparer.OrdinalIgnoreCase);

        foreach (var entry in suggested)
        {
            if (merged.Count >= MaxAutoLaunchers)
            {
                break;
            }

            if (seen.Add(BuildLauncherKey(entry.ExecutablePath, entry.Arguments)))
            {
                merged.Add(entry);
            }
        }

        return merged;
    }

    private static List<ProvisioningPermissionPayload> BuildPermissionNeeded(AppConfig config)
    {
        var permissions = new List<ProvisioningPermissionPayload>();

        if (string.IsNullOrWhiteSpace(config.Weather.ApiKey))
        {
            permissions.Add(new ProvisioningPermissionPayload
            {
                Id = "weather",
                Label = "Weather",
                Message = "Needs an OpenWeather API key before local weather can be enabled."
            });
        }

        if (string.IsNullOrWhiteSpace(config.Calendar.IcsUrl))
        {
            permissions.Add(new ProvisioningPermissionPayload
            {
                Id = "calendar",
                Label = "Calendar",
                Message = "Needs an ICS feed URL or future account permission."
            });
        }

        if (string.IsNullOrWhiteSpace(config.Hue.AppKey))
        {
            permissions.Add(new ProvisioningPermissionPayload
            {
                Id = "hue",
                Label = "Philips Hue",
                Message = string.IsNullOrWhiteSpace(config.Hue.BridgeIp)
                    ? "Needs a Hue bridge IP and physical link approval before local lighting can be enabled."
                    : "Needs the Hue bridge link button before Xenon can store local Hue credentials."
            });
        }

        return permissions;
    }

    private List<DiscoveredLauncherEntry> DiscoverLauncherEntries()
    {
        var entries = new List<DiscoveredLauncherEntry>();
        foreach (var root in GetShortcutRoots())
        {
            foreach (var shortcutPath in EnumerateFilesSafe(root, "*.lnk"))
            {
                var shortcut = TryReadShortcut(shortcutPath);
                if (shortcut is null || !IsUsefulLauncher(shortcut))
                {
                    continue;
                }

                entries.Add(shortcut with
                {
                    Score = ScoreLauncher(shortcut)
                });
            }
        }

        return entries
            .GroupBy(entry => BuildLauncherKey(entry.ExecutablePath, entry.Arguments), StringComparer.OrdinalIgnoreCase)
            .Select(group => group.OrderByDescending(entry => entry.Score).First())
            .ToList();
    }

    private static IEnumerable<string> GetShortcutRoots()
    {
        var paths = new[]
        {
            Environment.GetFolderPath(Environment.SpecialFolder.StartMenu),
            Environment.GetFolderPath(Environment.SpecialFolder.CommonStartMenu)
        };

        return paths
            .Where(path => !string.IsNullOrWhiteSpace(path) && Directory.Exists(path))
            .Distinct(StringComparer.OrdinalIgnoreCase);
    }

    private static IEnumerable<string> EnumerateFilesSafe(string root, string pattern)
    {
        try
        {
            return Directory.EnumerateFiles(root, pattern, SearchOption.AllDirectories).ToList();
        }
        catch
        {
            return [];
        }
    }

    private DiscoveredLauncherEntry? TryReadShortcut(string shortcutPath)
    {
        object? shell = null;
        object? shortcut = null;

        try
        {
            var shellType = Type.GetTypeFromProgID("WScript.Shell");
            if (shellType is null)
            {
                return null;
            }

            shell = Activator.CreateInstance(shellType);
            if (shell is null)
            {
                return null;
            }

            shortcut = shellType.InvokeMember(
                "CreateShortcut",
                BindingFlags.InvokeMethod,
                binder: null,
                target: shell,
                args: [shortcutPath]);

            if (shortcut is null)
            {
                return null;
            }

            var shortcutType = shortcut.GetType();
            var executablePath = ReadComString(shortcutType, shortcut, "TargetPath");
            var arguments = ReadComString(shortcutType, shortcut, "Arguments");
            var iconPath = NormalizeIconLocation(ReadComString(shortcutType, shortcut, "IconLocation"));
            var displayName = Path.GetFileNameWithoutExtension(shortcutPath);

            return new DiscoveredLauncherEntry(
                displayName,
                executablePath,
                arguments,
                iconPath,
                0);
        }
        catch (Exception error)
        {
            _logger.Warn($"Unable to read shortcut '{shortcutPath}': {error.Message}");
            return null;
        }
        finally
        {
            ReleaseComObject(shortcut);
            ReleaseComObject(shell);
        }
    }

    private static string ReadComString(Type type, object instance, string propertyName)
    {
        try
        {
            return Convert.ToString(type.InvokeMember(
                propertyName,
                BindingFlags.GetProperty,
                binder: null,
                target: instance,
                args: null))?.Trim() ?? "";
        }
        catch
        {
            return "";
        }
    }

    private static void ReleaseComObject(object? value)
    {
        try
        {
            if (value is not null && Marshal.IsComObject(value))
            {
                Marshal.FinalReleaseComObject(value);
            }
        }
        catch
        {
        }
    }

    private static string NormalizeIconLocation(string iconLocation)
    {
        if (string.IsNullOrWhiteSpace(iconLocation))
        {
            return "";
        }

        var commaIndex = iconLocation.LastIndexOf(',');
        var candidate = commaIndex > 0 ? iconLocation[..commaIndex] : iconLocation;
        candidate = candidate.Trim().Trim('"');
        return File.Exists(candidate) ? candidate : "";
    }

    private static bool IsUsefulLauncher(DiscoveredLauncherEntry entry)
    {
        if (string.IsNullOrWhiteSpace(entry.ExecutablePath)
            || !File.Exists(entry.ExecutablePath)
            || !string.Equals(Path.GetExtension(entry.ExecutablePath), ".exe", StringComparison.OrdinalIgnoreCase))
        {
            return false;
        }

        var label = entry.DisplayName.ToLowerInvariant();
        if (LauncherSkipWords.Any(word => label.Contains(word, StringComparison.OrdinalIgnoreCase)))
        {
            return false;
        }

        var path = entry.ExecutablePath;
        var windowsRoot = Environment.GetFolderPath(Environment.SpecialFolder.Windows);
        if (!string.IsNullOrWhiteSpace(windowsRoot)
            && path.StartsWith(windowsRoot, StringComparison.OrdinalIgnoreCase))
        {
            return false;
        }

        return true;
    }

    private static int ScoreLauncher(DiscoveredLauncherEntry entry)
    {
        var score = 10;
        var combined = $"{entry.DisplayName} {entry.ExecutablePath}".ToLowerInvariant();

        if (LauncherBoostWords.Any(word => combined.Contains(word, StringComparison.OrdinalIgnoreCase)))
        {
            score += 80;
        }

        var programFiles = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles);
        var programFilesX86 = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86);
        if ((!string.IsNullOrWhiteSpace(programFiles) && entry.ExecutablePath.StartsWith(programFiles, StringComparison.OrdinalIgnoreCase))
            || (!string.IsNullOrWhiteSpace(programFilesX86) && entry.ExecutablePath.StartsWith(programFilesX86, StringComparison.OrdinalIgnoreCase)))
        {
            score += 30;
        }

        if (!string.IsNullOrWhiteSpace(entry.IconPath))
        {
            score += 5;
        }

        score -= Math.Min(20, entry.DisplayName.Length / 4);
        return score;
    }

    private static string BuildLauncherKey(string executablePath, string arguments)
    {
        return $"{(executablePath ?? "").Trim()}|{(arguments ?? "").Trim()}";
    }

    private static string BuildStableId(string prefix, string value)
    {
        var hash = SHA256.HashData(Encoding.UTF8.GetBytes(value));
        return $"{prefix}-{Convert.ToHexString(hash)[..12].ToLowerInvariant()}";
    }

    private static ProvisioningLauncherSuggestionPayload CreateSuggestionPayload(LauncherEntryConfig entry)
    {
        return new ProvisioningLauncherSuggestionPayload
        {
            Id = entry.Id,
            DisplayName = entry.DisplayName,
            IconPath = entry.IconPath,
            ExecutablePath = entry.ExecutablePath,
            Arguments = entry.Arguments,
            Source = entry.ExecutablePath.StartsWith("steam://", StringComparison.OrdinalIgnoreCase) ? "Steam" : "Start Menu",
            Reason = entry.ExecutablePath.StartsWith("steam://", StringComparison.OrdinalIgnoreCase)
                ? "Installed Steam game"
                : "Trusted Start Menu shortcut",
            Selected = true
        };
    }

    private sealed record DiscoveredLauncherEntry(
        string DisplayName,
        string ExecutablePath,
        string Arguments,
        string IconPath,
        int Score);
}

public sealed class ProvisioningSnapshot
{
    public bool Supported { get; set; } = true;

    public bool Configured { get; set; }

    public string Status { get; set; } = "pending";

    public DateTimeOffset? SampledAt { get; set; }

    public bool Stale { get; set; }

    public string Source { get; set; } = "native startup scan";

    public string Message { get; set; } = "Xenon is preparing this PC automatically.";

    public bool AutoCompleted { get; set; }

    public int LauncherCount { get; set; }

    public int DetectedLauncherCount { get; set; }

    public int SteamGameCount { get; set; }

    public List<ProvisioningLauncherSuggestionPayload> SuggestedLaunchers { get; set; } = [];

    public List<ProvisioningActionPayload> Actions { get; set; } = [];

    public List<ProvisioningPermissionPayload> PermissionNeeded { get; set; } = [];

    public ProvisioningSnapshot Clone()
    {
        return new ProvisioningSnapshot
        {
            Supported = Supported,
            Configured = Configured,
            Status = Status,
            SampledAt = SampledAt,
            Stale = Stale,
            Source = Source,
            Message = Message,
            AutoCompleted = AutoCompleted,
            LauncherCount = LauncherCount,
            DetectedLauncherCount = DetectedLauncherCount,
            SteamGameCount = SteamGameCount,
            SuggestedLaunchers = SuggestedLaunchers.Select(suggestion => suggestion.Clone()).ToList(),
            Actions = Actions.Select(action => action.Clone()).ToList(),
            PermissionNeeded = PermissionNeeded.Select(permission => permission.Clone()).ToList()
        };
    }

    public static ProvisioningSnapshot CreatePending()
    {
        return new ProvisioningSnapshot
        {
            Supported = true,
            Configured = true,
            Status = "pending",
            Source = "native startup scan",
            Message = "Xenon is preparing this PC automatically."
        };
    }
}

public sealed class ProvisioningLauncherSuggestionPayload
{
    public string Id { get; set; } = "";

    public string DisplayName { get; set; } = "";

    public string IconPath { get; set; } = "";

    public string ExecutablePath { get; set; } = "";

    public string Arguments { get; set; } = "";

    public string Source { get; set; } = "";

    public string Reason { get; set; } = "";

    public bool Selected { get; set; }

    public ProvisioningLauncherSuggestionPayload Clone()
    {
        return new ProvisioningLauncherSuggestionPayload
        {
            Id = Id,
            DisplayName = DisplayName,
            IconPath = IconPath,
            ExecutablePath = ExecutablePath,
            Arguments = Arguments,
            Source = Source,
            Reason = Reason,
            Selected = Selected
        };
    }
}

public sealed class ProvisioningActionPayload
{
    public string Id { get; set; } = "";

    public string Label { get; set; } = "";

    public string State { get; set; } = "";

    public string Message { get; set; } = "";

    public ProvisioningActionPayload Clone()
    {
        return new ProvisioningActionPayload
        {
            Id = Id,
            Label = Label,
            State = State,
            Message = Message
        };
    }
}

public sealed class ProvisioningPermissionPayload
{
    public string Id { get; set; } = "";

    public string Label { get; set; } = "";

    public string Message { get; set; } = "";

    public ProvisioningPermissionPayload Clone()
    {
        return new ProvisioningPermissionPayload
        {
            Id = Id,
            Label = Label,
            Message = Message
        };
    }
}
