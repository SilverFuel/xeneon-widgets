using Microsoft.Win32;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace XenonEdgeHost;

public sealed class LauncherService : IDisposable
{
    private const int MaxRecentApps = 24;
    private const string FeatureUsageRoot = @"Software\Microsoft\Windows\CurrentVersion\Explorer\FeatureUsage";
    private const string ShellAppsFolderPrefix = @"shell:AppsFolder\";
    private static readonly TimeSpan ForegroundPollInterval = TimeSpan.FromSeconds(3);
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        WriteIndented = true
    };

    private static readonly HashSet<string> ForegroundProcessSkipList = new(StringComparer.OrdinalIgnoreCase)
    {
        "ApplicationFrameHost",
        "ShellExperienceHost",
        "StartMenuExperienceHost",
        "SearchHost",
        "TextInputHost",
        "XenonEdgeHost",
        "explorer"
    };

    private readonly HostLogger _logger;
    private readonly ConfigStore _configStore;
    private readonly object _recentLock = new();
    private readonly string _recentStatePath;
    private readonly Func<string?> _foregroundAppPathProvider;
    private readonly Timer _foregroundTimer;
    private List<RecentLauncherEntry> _recentEntries = [];
    private string _lastForegroundKey = "";
    private bool _foregroundWarningLogged;
    private bool _disposed;

    public LauncherService(HostLogger logger, ConfigStore configStore)
        : this(logger, configStore, null, null, startTimer: true)
    {
    }

    internal LauncherService(
        HostLogger logger,
        ConfigStore configStore,
        string? recentStatePathOverride,
        Func<string?>? foregroundAppPathProvider,
        bool startTimer)
    {
        _logger = logger;
        _configStore = configStore;
        _recentStatePath = string.IsNullOrWhiteSpace(recentStatePathOverride)
            ? Path.Combine(AppPaths.LocalDataDirectory, "recent-apps.json")
            : recentStatePathOverride;
        _foregroundAppPathProvider = foregroundAppPathProvider ?? GetForegroundProcessPathOrNull;

        if (IsForegroundTrackingEnabled())
        {
            LoadRecentState();
            SeedWindowsFeatureUsage();
        }
        _foregroundTimer = new Timer(
            CaptureForegroundApp,
            null,
            startTimer ? TimeSpan.FromSeconds(1) : Timeout.InfiniteTimeSpan,
            startTimer ? ForegroundPollInterval : Timeout.InfiniteTimeSpan);
    }

    public LauncherSnapshot GetSnapshot(AppConfig config)
    {
        var foregroundTrackingEnabled = config.Dashboard.ForegroundAppTrackingEnabled;
        if (foregroundTrackingEnabled)
        {
            CaptureForegroundApp(null);
        }
        var entries = GetRecentEntries(config);
        var sampledAt = DateTimeOffset.UtcNow;

        return new LauncherSnapshot
        {
            Supported = true,
            Configured = entries.Count > 0,
            Status = entries.Count > 0 ? "live" : "setup",
            SampledAt = sampledAt,
            Stale = false,
            Message = foregroundTrackingEnabled
                ? entries.Count > 0
                    ? $"Showing {entries.Count} recent app{(entries.Count == 1 ? "" : "s")} from this PC."
                    : "Foreground-app tracking is on. Open apps to build the recent launcher."
                : "Foreground-app tracking is off. Only launchers you save or open from Auxora are shown.",
            Source = foregroundTrackingEnabled ? "Windows app activity" : "Auxora launchers",
            Entries = entries.Select(MapEntry).ToList()
        };
    }

    public int ClearRecentHistory()
    {
        int removed;
        lock (_recentLock)
        {
            removed = _recentEntries.Count;
            _recentEntries = [];
            _lastForegroundKey = "";
        }

        if (File.Exists(_recentStatePath))
        {
            File.Delete(_recentStatePath);
            removed = Math.Max(removed, 1);
        }

        if (File.Exists(_recentStatePath))
        {
            throw new IOException("Recent-app history could not be deleted.");
        }

        return removed;
    }

    internal void CaptureForegroundAppForTest() => CaptureForegroundApp(null);

    public List<LauncherEntryConfig> NormalizeEntries(IEnumerable<LauncherEntryRequest>? entries)
    {
        var normalized = new List<LauncherEntryConfig>();
        foreach (var entry in entries ?? [])
        {
            if (string.IsNullOrWhiteSpace(entry.ExecutablePath))
            {
                continue;
            }

            var target = LauncherTargetValidator.ValidateAndNormalizeTarget(entry.ExecutablePath, entry.Arguments);
            normalized.Add(new LauncherEntryConfig
            {
                Id = string.IsNullOrWhiteSpace(entry.Id) ? Guid.NewGuid().ToString("N") : entry.Id.Trim(),
                DisplayName = ResolveDisplayName(target.Target, entry.DisplayName),
                IconPath = entry.IconPath?.Trim() ?? "",
                ExecutablePath = target.Target,
                Arguments = target.Arguments
            });
        }

        return normalized;
    }

    public LauncherLaunchResult Launch(AppConfig config, string? id)
    {
        var entry = FindEntry(config, id);
        if (entry is null)
        {
            throw new InvalidOperationException("Launcher entry not found.");
        }

        StartLauncherEntry(entry);
        PromoteRecentEntry(ToRecentEntry(entry, "Launched from Auxora", DateTimeOffset.UtcNow), persist: true);
        return new LauncherLaunchResult
        {
            Ok = true,
            Id = entry.Id,
            Message = $"Launched {entry.DisplayName}.",
            LaunchedAt = DateTimeOffset.UtcNow
        };
    }

    public bool TryGetIcon(AppConfig config, string? id, out LauncherIconAsset asset)
    {
        asset = default;
        var entry = FindEntry(config, id);
        if (entry is null)
        {
            return false;
        }

        var iconPath = entry.IconPath?.Trim() ?? "";
        if (!string.IsNullOrWhiteSpace(iconPath) && File.Exists(iconPath))
        {
            var contentType = GetContentType(iconPath);
            asset = new LauncherIconAsset(contentType, File.ReadAllBytes(iconPath));
            return true;
        }

        var executablePath = entry.ExecutablePath?.Trim() ?? "";
        if (!IsShellAppsFolderTarget(executablePath) && File.Exists(executablePath) && TryExtractAssociatedIcon(executablePath, out var iconBytes))
        {
            asset = new LauncherIconAsset("image/png", iconBytes);
            return true;
        }

        return false;
    }

    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _foregroundTimer.Dispose();
    }

    private List<RecentLauncherEntry> GetRecentEntries(AppConfig config)
    {
        lock (_recentLock)
        {
            var entries = _recentEntries
                .Where(IsLaunchableRecentEntry)
                .ToList();

            if (entries.Count < MaxRecentApps)
            {
                var fallbackTime = DateTimeOffset.UtcNow.AddHours(-12);
                foreach (var launcher in config.Launchers ?? [])
                {
                    if (entries.Count >= MaxRecentApps)
                    {
                        break;
                    }

                    var fallback = ToRecentEntry(launcher, "Saved launcher fallback", fallbackTime);
                    if (!entries.Any(entry => SameLauncherTarget(entry, fallback)))
                    {
                        entries.Add(fallback);
                    }
                }
            }

            return entries
                .OrderByDescending(entry => entry.LastOpenedAt)
                .ThenBy(entry => entry.DisplayName, StringComparer.OrdinalIgnoreCase)
                .Take(MaxRecentApps)
                .ToList();
        }
    }

    private void SeedWindowsFeatureUsage()
    {
        var seededAt = DateTimeOffset.UtcNow.AddMinutes(-15);
        var candidates = ReadWindowsFeatureUsageCandidates(seededAt).Take(MaxRecentApps).ToList();
        if (candidates.Count == 0)
        {
            return;
        }

        var changed = false;
        lock (_recentLock)
        {
            foreach (var candidate in candidates)
            {
                if (_recentEntries.Any(entry => SameLauncherTarget(entry, candidate)))
                {
                    continue;
                }

                _recentEntries.Add(candidate);
                changed = true;
            }

            SortAndTrimRecentEntries();
        }

        if (changed)
        {
            PersistRecentState();
        }
    }

    private List<RecentLauncherEntry> ReadWindowsFeatureUsageCandidates(DateTimeOffset seedTime)
    {
        var candidates = new List<RecentLauncherEntry>();
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var rank = 0;

        foreach (var (keyName, source) in new[]
        {
            ("AppSwitched", "Windows app switch"),
            ("AppLaunch", "Windows app launch"),
            ("ShowJumpView", "Windows jump list")
        })
        {
            using var key = Registry.CurrentUser.OpenSubKey($@"{FeatureUsageRoot}\{keyName}", false);
            if (key is null)
            {
                continue;
            }

            foreach (var valueName in key.GetValueNames())
            {
                if (!TryBuildFeatureUsageEntry(valueName, source, seedTime.AddSeconds(-rank), out var entry))
                {
                    rank++;
                    continue;
                }

                if (seen.Add(BuildLauncherKey(entry.ExecutablePath, entry.Arguments)))
                {
                    candidates.Add(entry);
                }

                rank++;
            }
        }

        return candidates;
    }

    private bool TryBuildFeatureUsageEntry(
        string valueName,
        string source,
        DateTimeOffset lastOpenedAt,
        out RecentLauncherEntry entry)
    {
        entry = RecentLauncherEntry.Empty;
        var raw = (valueName ?? "").Trim();
        if (string.IsNullOrWhiteSpace(raw)
            || raw.StartsWith("*PID", StringComparison.OrdinalIgnoreCase)
            || raw.Contains(";PrivateBrowsingAUMID", StringComparison.OrdinalIgnoreCase))
        {
            return false;
        }

        var path = ResolveFeatureUsagePath(raw);
        if (!string.IsNullOrWhiteSpace(path) && IsUsefulLauncherFile(path))
        {
            entry = CreateRecentEntryFromTarget(path, "", "", source, lastOpenedAt);
            return true;
        }

        if (LooksLikeAumid(raw))
        {
            entry = CreateRecentEntryFromTarget(
                ShellAppsFolderPrefix + raw,
                "",
                "",
                source,
                lastOpenedAt,
                ResolveAumidDisplayName(raw));
            return true;
        }

        return false;
    }

    private static string ResolveFeatureUsagePath(string raw)
    {
        var expanded = Environment.ExpandEnvironmentVariables(raw);
        if (Path.IsPathFullyQualified(expanded))
        {
            return expanded;
        }

        if (!expanded.StartsWith("{", StringComparison.Ordinal))
        {
            return "";
        }

        var closeBrace = expanded.IndexOf('}');
        if (closeBrace < 0 || closeBrace + 2 >= expanded.Length || expanded[closeBrace + 1] != '\\')
        {
            return "";
        }

        var folderId = expanded[..(closeBrace + 1)];
        var relativePath = expanded[(closeBrace + 2)..];
        var root = ResolveKnownFolderId(folderId);
        return string.IsNullOrWhiteSpace(root) ? "" : Path.Combine(root, relativePath);
    }

    private static string ResolveKnownFolderId(string folderId)
    {
        return folderId.ToUpperInvariant() switch
        {
            "{6D809377-6AF0-444B-8957-A3773F02200E}" => Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles),
            "{7C5A40EF-A0FB-4BFC-874A-C0F2E0B9FA8E}" => Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86),
            "{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}" => Environment.GetFolderPath(Environment.SpecialFolder.System),
            "{F38BF404-1D43-42F2-9305-67DE0B28FC23}" => Environment.GetFolderPath(Environment.SpecialFolder.Windows),
            _ => ""
        };
    }

    private void CaptureForegroundApp(object? _)
    {
        if (_disposed || !IsForegroundTrackingEnabled())
        {
            return;
        }

        try
        {
            var path = _foregroundAppPathProvider()?.Trim() ?? "";
            if (!IsUsefulLauncherFile(path))
            {
                return;
            }

            var entry = CreateRecentEntryFromTarget(path, "", "", "Foreground app", DateTimeOffset.UtcNow);
            lock (_recentLock)
            {
                if (!IsForegroundTrackingEnabled())
                {
                    return;
                }

                var key = BuildLauncherKey(path, "");
                if (string.Equals(key, _lastForegroundKey, StringComparison.OrdinalIgnoreCase))
                {
                    return;
                }

                _lastForegroundKey = key;
                _recentEntries = _recentEntries
                    .Where(current => !SameLauncherTarget(current, entry))
                    .ToList();
                _recentEntries.Add(entry);
                SortAndTrimRecentEntries();
                PersistRecentState();
            }
        }
        catch (Exception error)
        {
            if (!_foregroundWarningLogged)
            {
                _foregroundWarningLogged = true;
                _logger.Warn($"Recent app tracking is unavailable: {error.Message}");
            }
        }
    }

    private bool IsForegroundTrackingEnabled()
    {
        return _configStore.Snapshot().Dashboard.ForegroundAppTrackingEnabled;
    }

    private static string? GetForegroundProcessPathOrNull()
    {
        var foregroundWindow = GetForegroundWindow();
        if (foregroundWindow == IntPtr.Zero)
        {
            return null;
        }

        GetWindowThreadProcessId(foregroundWindow, out var processId);
        if (processId == 0)
        {
            return null;
        }

        using var process = Process.GetProcessById((int)processId);
        if (ForegroundProcessSkipList.Contains(process.ProcessName))
        {
            return null;
        }

        string path;
        try
        {
            path = process.MainModule?.FileName?.Trim() ?? "";
        }
        catch
        {
            path = "";
        }

        return IsUsefulLauncherFile(path) ? path : null;
    }

    private void PromoteRecentEntry(RecentLauncherEntry entry, bool persist)
    {
        if (string.IsNullOrWhiteSpace(entry.ExecutablePath))
        {
            return;
        }

        lock (_recentLock)
        {
            _recentEntries = _recentEntries
                .Where(current => !SameLauncherTarget(current, entry))
                .ToList();
            _recentEntries.Add(entry);
            SortAndTrimRecentEntries();
        }

        if (persist)
        {
            PersistRecentState();
        }
    }

    private void SortAndTrimRecentEntries()
    {
        _recentEntries = _recentEntries
            .Select(NormalizeRecentEntry)
            .Where(IsLaunchableRecentEntry)
            .GroupBy(entry => BuildLauncherKey(entry.ExecutablePath, entry.Arguments), StringComparer.OrdinalIgnoreCase)
            .Select(group => group.OrderByDescending(entry => entry.LastOpenedAt).First())
            .OrderByDescending(entry => entry.LastOpenedAt)
            .Take(MaxRecentApps)
            .ToList();
    }

    private void LoadRecentState()
    {
        try
        {
            if (!File.Exists(_recentStatePath))
            {
                return;
            }

            var state = JsonSerializer.Deserialize<RecentLauncherState>(File.ReadAllText(_recentStatePath), JsonOptions);
            _recentEntries = (state?.Entries ?? [])
                .Select(NormalizeRecentEntry)
                .Where(IsLaunchableRecentEntry)
                .OrderByDescending(entry => entry.LastOpenedAt)
                .Take(MaxRecentApps)
                .ToList();
        }
        catch (Exception error)
        {
            _logger.Warn($"Unable to load recent app launcher state: {error.Message}");
            _recentEntries = [];
        }
    }

    private void PersistRecentState()
    {
        try
        {
            var directory = Path.GetDirectoryName(_recentStatePath);
            if (!string.IsNullOrWhiteSpace(directory))
            {
                Directory.CreateDirectory(directory);
            }

            List<RecentLauncherEntry> entries;
            lock (_recentLock)
            {
                entries = _recentEntries.ToList();
            }

            File.WriteAllText(_recentStatePath, JsonSerializer.Serialize(new RecentLauncherState
            {
                Entries = entries
            }, JsonOptions));
        }
        catch (Exception error)
        {
            _logger.Warn($"Unable to save recent app launcher state: {error.Message}");
        }
    }

    private static RecentLauncherEntry NormalizeRecentEntry(RecentLauncherEntry entry)
    {
        entry.Id = string.IsNullOrWhiteSpace(entry.Id)
            ? BuildStableId("recent", BuildLauncherKey(entry.ExecutablePath, entry.Arguments))
            : entry.Id.Trim();
        entry.ExecutablePath = entry.ExecutablePath?.Trim() ?? "";
        entry.Arguments = entry.Arguments?.Trim() ?? "";
        entry.IconPath = entry.IconPath?.Trim() ?? "";
        entry.Source = entry.Source?.Trim() ?? "Windows app activity";
        entry.DisplayName = IsShellAppsFolderTarget(entry.ExecutablePath)
            ? ResolveDisplayName(entry.ExecutablePath, "")
            : ResolveDisplayName(entry.ExecutablePath, entry.DisplayName);
        return entry;
    }

    private LauncherEntryConfig? FindEntry(AppConfig config, string? id)
    {
        if (string.IsNullOrWhiteSpace(id))
        {
            return null;
        }

        lock (_recentLock)
        {
            var recent = _recentEntries.FirstOrDefault(entry =>
                string.Equals(entry.Id, id, StringComparison.OrdinalIgnoreCase));
            if (recent is not null)
            {
                return ToConfigEntry(recent);
            }
        }

        return (config.Launchers ?? []).FirstOrDefault(entry =>
            string.Equals(entry.Id, id, StringComparison.OrdinalIgnoreCase));
    }

    private static void StartLauncherEntry(LauncherEntryConfig entry)
    {
        if (IsShellAppsFolderTarget(entry.ExecutablePath))
        {
            Process.Start(new ProcessStartInfo
            {
                FileName = "explorer.exe",
                Arguments = QuoteArgument(entry.ExecutablePath),
                UseShellExecute = true
            });
            return;
        }

        var target = LauncherTargetValidator.ValidateAndNormalizeTarget(entry.ExecutablePath, entry.Arguments);
        var startInfo = new ProcessStartInfo
        {
            FileName = target.Target,
            UseShellExecute = target.Kind == LauncherTargetKind.Uri
                || string.Equals(Path.GetExtension(target.Target), ".lnk", StringComparison.OrdinalIgnoreCase)
        };

        if (!string.IsNullOrWhiteSpace(target.Arguments))
        {
            startInfo.Arguments = target.Arguments;
        }

        if (!string.IsNullOrWhiteSpace(target.WorkingDirectory))
        {
            startInfo.WorkingDirectory = target.WorkingDirectory;
        }

        Process.Start(startInfo);
    }

    private static LauncherEntryPayload MapEntry(RecentLauncherEntry entry)
    {
        return new LauncherEntryPayload
        {
            Id = entry.Id,
            DisplayName = entry.DisplayName,
            IconPath = entry.IconPath,
            ExecutablePath = entry.ExecutablePath,
            Arguments = entry.Arguments,
            IconUrl = ResolveIconUrl(entry),
            TileLabel = ResolveTileLabel(entry.DisplayName),
            Source = entry.Source,
            LastOpenedAt = entry.LastOpenedAt,
            Recent = true
        };
    }

    private static RecentLauncherEntry ToRecentEntry(LauncherEntryConfig entry, string source, DateTimeOffset lastOpenedAt)
    {
        return new RecentLauncherEntry
        {
            Id = string.IsNullOrWhiteSpace(entry.Id)
                ? BuildStableId("recent", BuildLauncherKey(entry.ExecutablePath, entry.Arguments))
                : entry.Id,
            DisplayName = ResolveDisplayName(entry.ExecutablePath, entry.DisplayName),
            IconPath = entry.IconPath ?? "",
            ExecutablePath = entry.ExecutablePath ?? "",
            Arguments = entry.Arguments ?? "",
            Source = source,
            LastOpenedAt = lastOpenedAt
        };
    }

    private static LauncherEntryConfig ToConfigEntry(RecentLauncherEntry entry)
    {
        return new LauncherEntryConfig
        {
            Id = entry.Id,
            DisplayName = entry.DisplayName,
            IconPath = entry.IconPath,
            ExecutablePath = entry.ExecutablePath,
            Arguments = entry.Arguments
        };
    }

    private static RecentLauncherEntry CreateRecentEntryFromTarget(
        string target,
        string arguments,
        string iconPath,
        string source,
        DateTimeOffset lastOpenedAt,
        string? displayName = null)
    {
        var normalizedTarget = target.Trim();
        var normalizedArguments = arguments.Trim();
        return new RecentLauncherEntry
        {
            Id = BuildStableId("recent", BuildLauncherKey(normalizedTarget, normalizedArguments)),
            DisplayName = ResolveDisplayName(normalizedTarget, displayName),
            IconPath = iconPath.Trim(),
            ExecutablePath = normalizedTarget,
            Arguments = normalizedArguments,
            Source = source,
            LastOpenedAt = lastOpenedAt
        };
    }

    private static bool SameLauncherTarget(RecentLauncherEntry left, RecentLauncherEntry right)
    {
        return string.Equals(
                BuildLauncherKey(left.ExecutablePath, left.Arguments),
                BuildLauncherKey(right.ExecutablePath, right.Arguments),
                StringComparison.OrdinalIgnoreCase)
            || (!string.IsNullOrWhiteSpace(left.Id)
                && string.Equals(left.Id, right.Id, StringComparison.OrdinalIgnoreCase));
    }

    private static bool IsLaunchableRecentEntry(RecentLauncherEntry entry)
    {
        var target = entry.ExecutablePath?.Trim() ?? "";
        if (string.IsNullOrWhiteSpace(target))
        {
            return false;
        }

        if (IsShellAppsFolderTarget(target))
        {
            return true;
        }

        if (LauncherTargetValidator.TryValidateAndNormalizeTarget(target, entry.Arguments, out _))
        {
            return true;
        }

        return false;
    }

    private static bool IsUsefulLauncherFile(string path)
    {
        if (string.IsNullOrWhiteSpace(path) || !File.Exists(path))
        {
            return false;
        }

        var extension = Path.GetExtension(path);
        if (!string.Equals(extension, ".exe", StringComparison.OrdinalIgnoreCase)
            && !string.Equals(extension, ".lnk", StringComparison.OrdinalIgnoreCase))
        {
            return false;
        }

        var fileName = Path.GetFileNameWithoutExtension(path);
        if (string.IsNullOrWhiteSpace(fileName)
            || fileName.Contains("setup", StringComparison.OrdinalIgnoreCase)
            || fileName.Contains("unins", StringComparison.OrdinalIgnoreCase))
        {
            return false;
        }

        var windowsRoot = Environment.GetFolderPath(Environment.SpecialFolder.Windows);
        if (!string.IsNullOrWhiteSpace(windowsRoot)
            && path.StartsWith(windowsRoot, StringComparison.OrdinalIgnoreCase))
        {
            return false;
        }

        var tempRoot = Path.GetTempPath();
        if (!string.IsNullOrWhiteSpace(tempRoot)
            && path.StartsWith(tempRoot, StringComparison.OrdinalIgnoreCase))
        {
            return false;
        }

        return true;
    }

    private static bool LooksLikeAumid(string value)
    {
        return value.Contains('!')
            && !value.Contains('\\')
            && !value.Contains('/')
            && !value.StartsWith("http:", StringComparison.OrdinalIgnoreCase)
            && !value.StartsWith("https:", StringComparison.OrdinalIgnoreCase);
    }

    private static bool IsShellAppsFolderTarget(string value)
    {
        return (value ?? "").StartsWith(ShellAppsFolderPrefix, StringComparison.OrdinalIgnoreCase);
    }

    private static string ResolveDisplayName(string executablePath, string? displayName)
    {
        if (!string.IsNullOrWhiteSpace(displayName))
        {
            return CleanDisplayName(displayName);
        }

        if (IsShellAppsFolderTarget(executablePath))
        {
            return ResolveAumidDisplayName(executablePath[ShellAppsFolderPrefix.Length..]);
        }

        if (Uri.TryCreate(executablePath, UriKind.Absolute, out var uri) && !uri.IsFile)
        {
            return string.IsNullOrWhiteSpace(uri.Host) ? executablePath : uri.Host;
        }

        var description = TryGetFileDescription(executablePath);
        if (!string.IsNullOrWhiteSpace(description))
        {
            return CleanDisplayName(description);
        }

        var fileName = Path.GetFileNameWithoutExtension(executablePath);
        return string.IsNullOrWhiteSpace(fileName) ? executablePath : CleanDisplayName(fileName);
    }

    private static string ResolveAumidDisplayName(string aumid)
    {
        var appId = aumid.Split('!').LastOrDefault() ?? aumid;
        var packageName = aumid.Split('!').FirstOrDefault() ?? aumid;
        var knownName = ResolveKnownAumidDisplayName(packageName, appId);
        if (!string.IsNullOrWhiteSpace(knownName))
        {
            return knownName;
        }

        var packageFamilyName = packageName.Split('_').FirstOrDefault() ?? packageName;
        var label = string.Equals(appId, "App", StringComparison.OrdinalIgnoreCase)
            ? packageFamilyName.Split(['.'], StringSplitOptions.RemoveEmptyEntries).LastOrDefault() ?? packageFamilyName
            : appId;

        return CleanDisplayName(label
            .Replace("Microsoft.", "", StringComparison.OrdinalIgnoreCase)
            .Replace("Windows.", "", StringComparison.OrdinalIgnoreCase)
            .Replace("NVIDIACorp.", "", StringComparison.OrdinalIgnoreCase));
    }

    private static string ResolveKnownAumidDisplayName(string packageName, string appId)
    {
        var combined = $"{packageName}!{appId}";
        if (combined.StartsWith("Microsoft.WindowsTerminal_", StringComparison.OrdinalIgnoreCase))
        {
            return "Windows Terminal";
        }

        if (combined.StartsWith("Microsoft.ScreenSketch_", StringComparison.OrdinalIgnoreCase))
        {
            return "Snipping Tool";
        }

        if (combined.StartsWith("Microsoft.WindowsStore_", StringComparison.OrdinalIgnoreCase))
        {
            return "Microsoft Store";
        }

        if (combined.StartsWith("windows.immersivecontrolpanel_", StringComparison.OrdinalIgnoreCase))
        {
            return "Settings";
        }

        if (combined.StartsWith("NVIDIACorp.NVIDIAControlPanel_", StringComparison.OrdinalIgnoreCase))
        {
            return "NVIDIA Control Panel";
        }

        if (combined.StartsWith("OpenAI.ChatGPT-Desktop_", StringComparison.OrdinalIgnoreCase))
        {
            return "ChatGPT";
        }

        if (combined.StartsWith("OpenAI.Codex_", StringComparison.OrdinalIgnoreCase))
        {
            return "Codex";
        }

        if (combined.StartsWith("Microsoft.GamingApp_", StringComparison.OrdinalIgnoreCase))
        {
            return "Xbox";
        }

        if (combined.StartsWith("Microsoft.Copilot_", StringComparison.OrdinalIgnoreCase))
        {
            return "Copilot";
        }

        if (combined.StartsWith("AppleInc.AppleMusicWin_", StringComparison.OrdinalIgnoreCase))
        {
            return "Apple Music";
        }

        if (combined.StartsWith("Microsoft.OutlookforWindows_", StringComparison.OrdinalIgnoreCase))
        {
            return "Outlook";
        }

        return "";
    }

    private static string CleanDisplayName(string value)
    {
        var cleaned = (value ?? "")
            .Replace(".exe", "", StringComparison.OrdinalIgnoreCase)
            .Replace("_", " ")
            .Replace("-", " ")
            .Trim();

        if (string.IsNullOrWhiteSpace(cleaned))
        {
            return "App";
        }

        return SplitDisplayWords(cleaned)
            .Replace("i CUE", "iCUE", StringComparison.Ordinal)
            .Replace("Ge Force", "GeForce", StringComparison.Ordinal)
            .Replace("HW Monitor", "HWMonitor", StringComparison.Ordinal);
    }

    private static string SplitDisplayWords(string value)
    {
        var builder = new StringBuilder();
        for (var index = 0; index < value.Length; index++)
        {
            var current = value[index];
            var previous = index > 0 ? value[index - 1] : '\0';
            var next = index + 1 < value.Length ? value[index + 1] : '\0';
            if (index > 0
                && current != ' '
                && char.IsUpper(current)
                && (char.IsLower(previous) || (char.IsUpper(previous) && char.IsLower(next))))
            {
                builder.Append(' ');
            }

            builder.Append(current);
        }

        return builder.ToString();
    }

    private static string TryGetFileDescription(string path)
    {
        try
        {
            if (!File.Exists(path) || string.Equals(Path.GetExtension(path), ".lnk", StringComparison.OrdinalIgnoreCase))
            {
                return "";
            }

            var description = FileVersionInfo.GetVersionInfo(path).FileDescription?.Trim() ?? "";
            var fileName = Path.GetFileNameWithoutExtension(path);
            if (string.IsNullOrWhiteSpace(description)
                || description.Equals(fileName, StringComparison.OrdinalIgnoreCase)
                || description.Contains("setup", StringComparison.OrdinalIgnoreCase))
            {
                return "";
            }

            return description;
        }
        catch
        {
            return "";
        }
    }

    private static string ResolveIconUrl(RecentLauncherEntry entry)
    {
        var iconPath = entry.IconPath?.Trim() ?? "";
        if (iconPath.StartsWith("data:", StringComparison.OrdinalIgnoreCase)
            || iconPath.StartsWith("http://", StringComparison.OrdinalIgnoreCase)
            || iconPath.StartsWith("https://", StringComparison.OrdinalIgnoreCase))
        {
            return iconPath;
        }

        if (IsShellAppsFolderTarget(entry.ExecutablePath))
        {
            return "";
        }

        if ((!string.IsNullOrWhiteSpace(iconPath) && File.Exists(iconPath))
            || File.Exists(entry.ExecutablePath))
        {
            return "/api/launchers/icon?id=" + Uri.EscapeDataString(entry.Id);
        }

        return "";
    }

    private static string ResolveTileLabel(string displayName)
    {
        var normalized = (displayName ?? "").Trim();
        if (string.IsNullOrWhiteSpace(normalized))
        {
            return "?";
        }

        return normalized[..1].ToUpperInvariant();
    }

    private static string GetContentType(string path)
    {
        return Path.GetExtension(path).ToLowerInvariant() switch
        {
            ".png" => "image/png",
            ".jpg" => "image/jpeg",
            ".jpeg" => "image/jpeg",
            ".gif" => "image/gif",
            ".webp" => "image/webp",
            ".svg" => "image/svg+xml",
            ".ico" => "image/x-icon",
            _ => "application/octet-stream"
        };
    }

    private static bool TryExtractAssociatedIcon(string path, out byte[] iconBytes)
    {
        iconBytes = [];

        try
        {
            using var icon = Icon.ExtractAssociatedIcon(path);
            if (icon is null)
            {
                return false;
            }

            using var bitmap = icon.ToBitmap();
            using var stream = new MemoryStream();
            bitmap.Save(stream, ImageFormat.Png);
            iconBytes = stream.ToArray();
            return iconBytes.Length > 0;
        }
        catch
        {
            return false;
        }
    }

    private static string BuildStableId(string prefix, string value)
    {
        var hash = SHA256.HashData(Encoding.UTF8.GetBytes(value));
        return $"{prefix}-{Convert.ToHexString(hash)[..12].ToLowerInvariant()}";
    }

    private static string BuildLauncherKey(string executablePath, string arguments)
    {
        return $"{(executablePath ?? "").Trim()}|{(arguments ?? "").Trim()}";
    }

    private static string QuoteArgument(string value)
    {
        return "\"" + value.Replace("\"", "\\\"") + "\"";
    }

    [DllImport("user32.dll")]
    private static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);

    private sealed class RecentLauncherState
    {
        public List<RecentLauncherEntry> Entries { get; set; } = [];
    }

    private sealed class RecentLauncherEntry
    {
        public static RecentLauncherEntry Empty { get; } = new();

        public string Id { get; set; } = "";

        public string DisplayName { get; set; } = "";

        public string IconPath { get; set; } = "";

        public string ExecutablePath { get; set; } = "";

        public string Arguments { get; set; } = "";

        public string Source { get; set; } = "";

        public DateTimeOffset LastOpenedAt { get; set; }
    }
}

public sealed class LauncherSnapshot
{
    public bool Supported { get; set; } = true;

    public bool Configured { get; set; }

    public string Status { get; set; } = "setup";

    public DateTimeOffset? SampledAt { get; set; }

    public bool Stale { get; set; }

    public string Message { get; set; } = "";

    public string Source { get; set; } = "Windows app activity";

    public List<LauncherEntryPayload> Entries { get; set; } = [];
}

public sealed class LauncherEntryPayload
{
    public string Id { get; set; } = "";

    public string DisplayName { get; set; } = "";

    public string IconPath { get; set; } = "";

    public string ExecutablePath { get; set; } = "";

    public string Arguments { get; set; } = "";

    public string IconUrl { get; set; } = "";

    public string TileLabel { get; set; } = "?";

    public string Source { get; set; } = "";

    public DateTimeOffset? LastOpenedAt { get; set; }

    public bool Recent { get; set; }
}

public sealed class LauncherLaunchResult
{
    public bool Ok { get; set; }

    public string Id { get; set; } = "";

    public string Message { get; set; } = "";

    public DateTimeOffset LaunchedAt { get; set; }
}

public readonly record struct LauncherIconAsset(string ContentType, byte[] Content);
