namespace XenonEdgeHost;

public sealed class LocalDataResetService
{
    private readonly ConfigStore _configStore;
    private readonly LauncherService _launcherService;
    private readonly GamePerformanceService _gamePerformanceService;
    private readonly HostLogger _logger;
    private readonly string _legacyRoamingRoot;
    private readonly string _legacyLocalRoot;
    private Func<CancellationToken, Task<ResetStepReceipt>>? _clearBrowserDataAsync;

    public LocalDataResetService(
        ConfigStore configStore,
        LauncherService launcherService,
        GamePerformanceService gamePerformanceService,
        HostLogger logger)
        : this(configStore, launcherService, gamePerformanceService, logger, null, null)
    {
    }

    internal LocalDataResetService(
        ConfigStore configStore,
        LauncherService launcherService,
        GamePerformanceService gamePerformanceService,
        HostLogger logger,
        string? legacyRoamingRoot,
        string? legacyLocalRoot)
    {
        _configStore = configStore;
        _launcherService = launcherService;
        _gamePerformanceService = gamePerformanceService;
        _logger = logger;
        _legacyRoamingRoot = legacyRoamingRoot ?? Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
            AppPaths.LegacyProductDirectoryName);
        _legacyLocalRoot = legacyLocalRoot ?? Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            AppPaths.LegacyProductDirectoryName);
    }

    public void SetBrowserDataClearer(Func<CancellationToken, Task<ResetStepReceipt>> clearBrowserDataAsync)
    {
        _clearBrowserDataAsync = clearBrowserDataAsync ?? throw new ArgumentNullException(nameof(clearBrowserDataAsync));
    }

    public async Task<LocalDataResetReceipt> ResetAllAsync(CancellationToken cancellationToken)
    {
        var steps = new List<ResetStepReceipt>();

        RunRequired(steps, "config-and-protected-secrets", "Settings and protected integration secrets", () =>
        {
            var reset = _configStore.ResetLocalData();
            if (HasProtectedValues(reset))
            {
                throw new IOException("Protected integration values remain after reset.");
            }
            return "Reset to beta defaults; the localhost port was retained.";
        });

        RunRequired(steps, "recent-app-history", "Recent-app history", () =>
        {
            var removed = _launcherService.ClearRecentHistory();
            return removed == 0 ? "No retained recent-app history was present." : $"Deleted {removed} retained recent-app record source(s).";
        });

        RunRequired(steps, "game-telemetry", "Retained game telemetry", () =>
        {
            var removed = _gamePerformanceService.ClearRetainedTelemetry();
            return removed == 0 ? "No retained PresentMon files were present." : $"Deleted {removed} retained PresentMon file(s).";
        });

        RunRequired(steps, "legacy-data", "Legacy Auxora/Xenon data", () =>
        {
            var removed = DeleteLegacyData();
            return removed == 0 ? "No known legacy data files were present." : $"Deleted {removed} known legacy data file(s).";
        });

        if (_clearBrowserDataAsync is null)
        {
            steps.Add(new ResetStepReceipt
            {
                Id = "webview-data",
                Label = "WebView browsing data",
                Required = false,
                Status = "unavailable",
                Message = "The WebView profile was not initialized, so no profile deletion was claimed."
            });
        }
        else
        {
            try
            {
                steps.Add(await _clearBrowserDataAsync(cancellationToken));
            }
            catch (Exception error)
            {
                steps.Add(new ResetStepReceipt
                {
                    Id = "webview-data",
                    Label = "WebView browsing data",
                    Required = false,
                    Status = "failed",
                    Message = $"WebView browsing data could not be cleared: {error.Message}"
                });
            }
        }

        RunRequired(steps, "logs", "Host logs", () =>
        {
            var removedLegacy = DeleteFileIfPresent(Path.Combine(_legacyLocalRoot, "logs", "host.log"));
            _logger.Clear();
            return removedLegacy ? "Deleted current and legacy host logs." : "Deleted the current host log; no legacy host log was present.";
        });

        var ok = steps.Where(step => step.Required).All(step => string.Equals(step.Status, "cleared", StringComparison.Ordinal));
        return new LocalDataResetReceipt
        {
            Ok = ok,
            Status = ok ? "cleared" : "failed",
            Message = ok
                ? "Required local app data was cleared. Review the receipt for the optional WebView profile result."
                : "One or more required local data deletions failed. Review the receipt and retry.",
            CompletedAt = DateTimeOffset.UtcNow,
            Steps = steps
        };
    }

    private static void RunRequired(
        ICollection<ResetStepReceipt> steps,
        string id,
        string label,
        Func<string> action)
    {
        try
        {
            steps.Add(new ResetStepReceipt
            {
                Id = id,
                Label = label,
                Required = true,
                Status = "cleared",
                Message = action()
            });
        }
        catch (Exception error)
        {
            steps.Add(new ResetStepReceipt
            {
                Id = id,
                Label = label,
                Required = true,
                Status = "failed",
                Message = error.Message
            });
        }
    }

    private int DeleteLegacyData()
    {
        var removed = 0;
        foreach (var path in new[]
                 {
                     Path.Combine(_legacyRoamingRoot, "config.json"),
                     Path.Combine(_legacyRoamingRoot, "protected-secrets.json"),
                     Path.Combine(_legacyLocalRoot, "recent-apps.json")
                 })
        {
            removed += DeleteFileIfPresent(path) ? 1 : 0;
        }

        var telemetryDirectory = Path.Combine(_legacyLocalRoot, "Telemetry");
        if (Directory.Exists(telemetryDirectory))
        {
            foreach (var path in Directory.EnumerateFiles(telemetryDirectory, "presentmon-*.csv", SearchOption.TopDirectoryOnly))
            {
                removed += DeleteFileIfPresent(path) ? 1 : 0;
            }
        }

        return removed;
    }

    private static bool DeleteFileIfPresent(string path)
    {
        if (!File.Exists(path))
        {
            return false;
        }

        File.Delete(path);
        if (File.Exists(path))
        {
            throw new IOException($"Could not delete {Path.GetFileName(path)}.");
        }
        return true;
    }

    private static bool HasProtectedValues(AppConfig config)
    {
        return !string.IsNullOrWhiteSpace(config.Weather.ApiKey)
            || !string.IsNullOrWhiteSpace(config.Calendar.IcsUrl)
            || !string.IsNullOrWhiteSpace(config.Hue.AppKey)
            || !string.IsNullOrWhiteSpace(config.Hue.ClientKey)
            || !string.IsNullOrWhiteSpace(config.UniFi.Password);
    }
}

public sealed class LocalDataResetReceipt
{
    public bool Ok { get; set; }

    public string Status { get; set; } = "failed";

    public string Message { get; set; } = "";

    public DateTimeOffset CompletedAt { get; set; }

    public List<ResetStepReceipt> Steps { get; set; } = [];
}

public sealed class ResetStepReceipt
{
    public string Id { get; set; } = "";

    public string Label { get; set; } = "";

    public bool Required { get; set; }

    public string Status { get; set; } = "unavailable";

    public string Message { get; set; } = "";
}
