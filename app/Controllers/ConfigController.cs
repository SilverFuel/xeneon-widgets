namespace XenonEdgeHost;

public sealed class ConfigController
{
    private readonly ConfigStore _configStore;
    private readonly ProvisioningService _provisioningService;
    private readonly LauncherService? _launcherService;

    public event Action? DisplayPreferenceChanged;

    public ConfigController(
        ConfigStore configStore,
        ProvisioningService provisioningService,
        LauncherService? launcherService = null)
    {
        _configStore = configStore;
        _provisioningService = provisioningService;
        _launcherService = launcherService;
    }

    public object GetSnapshot()
    {
        var config = _configStore.Snapshot();
        return new
        {
            port = config.Port,
            provisioning = _provisioningService.GetSnapshot(),
            display = GetDisplayDiagnostics(config),
            weather = new
            {
                configured = !string.IsNullOrWhiteSpace(config.Weather.ApiKey),
                city = config.Weather.City,
                units = config.Weather.Units,
                secureStorage = "Windows DPAPI"
            },
            calendar = new
            {
                configured = !string.IsNullOrWhiteSpace(config.Calendar.IcsUrl),
                icsUrlConfigured = !string.IsNullOrWhiteSpace(config.Calendar.IcsUrl),
                icsHost = GetDisplayHost(config.Calendar.IcsUrl)
            },
            network = new
            {
                healthTarget = config.Network.HealthTarget,
                healthTargetConfigured = !string.IsNullOrWhiteSpace(config.Network.HealthTarget)
            },
            launchers = new
            {
                configured = config.Launchers.Count > 0,
                count = config.Launchers.Count
            },
            gpuPower = new
            {
                configured = true,
                endpoint = "/api/gpu-power",
                localOnly = true,
                source = "Windows/LHM/OHM/HWiNFO CSV"
            },
            hue = new
            {
                bridgeIp = config.Hue.BridgeIp,
                configured = !string.IsNullOrWhiteSpace(config.Hue.BridgeIp),
                linked = !string.IsNullOrWhiteSpace(config.Hue.AppKey),
                certificateTrusted = !string.IsNullOrWhiteSpace(config.Hue.CertificateThumbprint),
                secureStorage = "Windows DPAPI"
            },
            unifi = new
            {
                configured = !string.IsNullOrWhiteSpace(config.UniFi.Host),
                linked = !string.IsNullOrWhiteSpace(config.UniFi.Host)
                    && !string.IsNullOrWhiteSpace(config.UniFi.Username)
                    && !string.IsNullOrWhiteSpace(config.UniFi.Password),
                host = config.UniFi.Host,
                usernameConfigured = !string.IsNullOrWhiteSpace(config.UniFi.Username),
                site = config.UniFi.Site,
                endpoint = "/api/unifi/network",
                linkEndpoint = "/api/unifi/network/link",
                disconnectEndpoint = "/api/unifi/network/disconnect",
                localOnly = true,
                secureStorage = "Windows DPAPI"
            },
            dashboard = new
            {
                autoProvisioningEnabled = config.Dashboard.AutoProvisioningEnabled,
                autoProvisionedAt = config.Dashboard.AutoProvisionedAt,
                autoProvisioningVersion = config.Dashboard.AutoProvisioningVersion,
                launcherReviewRequired = config.Dashboard.LauncherReviewRequired,
                autoApplyLauncherSuggestions = config.Dashboard.AutoApplyLauncherSuggestions,
                foregroundAppTrackingEnabled = config.Dashboard.ForegroundAppTrackingEnabled,
                onboardingCompleted = config.Dashboard.OnboardingCompleted,
                onboardingCompletedAt = config.Dashboard.OnboardingCompletedAt,
                onboardingVersion = config.Dashboard.OnboardingVersion,
                preferredDisplayId = config.Dashboard.PreferredDisplayId,
                preferredDisplayDeviceName = config.Dashboard.PreferredDisplayDeviceName,
                displaySelectedAt = config.Dashboard.DisplaySelectedAt,
                performanceBudget = config.Dashboard.PerformanceBudget,
                gameModeAutoTune = config.Dashboard.GameModeAutoTune,
                themeReadability = config.Dashboard.ThemeReadability,
                releaseChannel = config.Dashboard.ReleaseChannel,
                updateRollbackEnabled = config.Dashboard.UpdateRollbackEnabled,
                lastKnownGoodVersion = config.Dashboard.LastKnownGoodVersion,
                lastKnownGoodPath = string.IsNullOrWhiteSpace(config.Dashboard.LastKnownGoodPath) ? "" : "<local-app-path>",
                clipboardHidePreviews = config.Dashboard.ClipboardHidePreviews,
                clipboardWidgetPaused = config.Dashboard.ClipboardWidgetPaused,
                clipboardExcludeFromDiagnostics = config.Dashboard.ClipboardExcludeFromDiagnostics,
                gameTelemetryDiagnosticsRetention = config.Dashboard.GameTelemetryDiagnosticsRetention,
                mediaMetadataVisible = config.Dashboard.MediaMetadataVisible,
                audioSessionLabelsVisible = config.Dashboard.AudioSessionLabelsVisible
            },
            scenes = new
            {
                activeSceneId = config.Scenes.ActiveSceneId,
                defaultSceneId = config.Scenes.DefaultSceneId,
                automationEnabled = config.Scenes.AutomationEnabled,
                manualOverrideUntil = config.Scenes.ManualOverrideUntil,
                lastActivationReason = config.Scenes.LastActivationReason,
                profiles = config.Scenes.Profiles
            }
        };
    }

    public object GetSupportSnapshot(AppConfig config)
    {
        return new
        {
            port = config.Port,
            weather = new
            {
                configured = !string.IsNullOrWhiteSpace(config.Weather.ApiKey),
                cityConfigured = !string.IsNullOrWhiteSpace(config.Weather.City),
                units = config.Weather.Units,
                secureStorage = "Windows DPAPI"
            },
            calendar = new
            {
                configured = !string.IsNullOrWhiteSpace(config.Calendar.IcsUrl)
            },
            network = new
            {
                healthTargetConfigured = !string.IsNullOrWhiteSpace(config.Network.HealthTarget)
            },
            launchers = new
            {
                configured = config.Launchers.Count > 0,
                count = config.Launchers.Count
            },
            gpuPower = new
            {
                configured = true,
                endpoint = "/api/gpu-power",
                localOnly = true
            },
            hue = new
            {
                configured = !string.IsNullOrWhiteSpace(config.Hue.BridgeIp),
                linked = !string.IsNullOrWhiteSpace(config.Hue.AppKey),
                secureStorage = "Windows DPAPI"
            },
            unifi = new
            {
                configured = !string.IsNullOrWhiteSpace(config.UniFi.Host),
                linked = !string.IsNullOrWhiteSpace(config.UniFi.Host)
                    && !string.IsNullOrWhiteSpace(config.UniFi.Username)
                    && !string.IsNullOrWhiteSpace(config.UniFi.Password),
                hostConfigured = !string.IsNullOrWhiteSpace(config.UniFi.Host),
                usernameConfigured = !string.IsNullOrWhiteSpace(config.UniFi.Username),
                site = config.UniFi.Site,
                endpoint = "/api/unifi/network",
                localOnly = true,
                secureStorage = "Windows DPAPI"
            },
            dashboard = new
            {
                autoProvisioningEnabled = config.Dashboard.AutoProvisioningEnabled,
                autoProvisioned = !string.IsNullOrWhiteSpace(config.Dashboard.AutoProvisionedAt),
                autoProvisioningVersion = config.Dashboard.AutoProvisioningVersion,
                launcherReviewRequired = config.Dashboard.LauncherReviewRequired,
                autoApplyLauncherSuggestions = config.Dashboard.AutoApplyLauncherSuggestions,
                onboardingCompleted = config.Dashboard.OnboardingCompleted,
                onboardingCompletedAt = config.Dashboard.OnboardingCompletedAt,
                onboardingVersion = config.Dashboard.OnboardingVersion,
                preferredDisplayConfigured = !string.IsNullOrWhiteSpace(config.Dashboard.PreferredDisplayId),
                performanceBudget = config.Dashboard.PerformanceBudget,
                gameModeAutoTune = config.Dashboard.GameModeAutoTune,
                themeReadability = config.Dashboard.ThemeReadability,
                releaseChannel = config.Dashboard.ReleaseChannel,
                updateRollbackEnabled = config.Dashboard.UpdateRollbackEnabled,
                lastKnownGoodConfigured = !string.IsNullOrWhiteSpace(config.Dashboard.LastKnownGoodPath),
                clipboard = new
                {
                    previewsHidden = config.Dashboard.ClipboardHidePreviews,
                    paused = config.Dashboard.ClipboardWidgetPaused,
                    excludedFromDiagnostics = config.Dashboard.ClipboardExcludeFromDiagnostics
                },
                gameTelemetryDiagnosticsRetention = config.Dashboard.GameTelemetryDiagnosticsRetention,
                mediaMetadataVisible = config.Dashboard.MediaMetadataVisible,
                audioSessionLabelsVisible = config.Dashboard.AudioSessionLabelsVisible
            }
        };
    }

    public object UpdateDashboard(DashboardConfigRequest payload)
    {
        _configStore.Update(current =>
        {
            if (payload.OnboardingVersion is > 0)
            {
                current.Dashboard.OnboardingVersion = payload.OnboardingVersion.Value;
            }

            if (payload.OnboardingCompleted == true)
            {
                current.Dashboard.OnboardingCompleted = true;
                current.Dashboard.OnboardingCompletedAt = DateTime.UtcNow.ToString("O");
            }
            else if (payload.OnboardingCompleted == false)
            {
                current.Dashboard.OnboardingCompleted = false;
                current.Dashboard.OnboardingCompletedAt = "";
            }

            if (payload.LauncherReviewRequired.HasValue)
            {
                current.Dashboard.LauncherReviewRequired = payload.LauncherReviewRequired.Value;
            }

            if (payload.AutoApplyLauncherSuggestions.HasValue)
            {
                current.Dashboard.AutoApplyLauncherSuggestions = payload.AutoApplyLauncherSuggestions.Value;
            }

            if (payload.ForegroundAppTrackingEnabled.HasValue)
            {
                current.Dashboard.ForegroundAppTrackingEnabled = payload.ForegroundAppTrackingEnabled.Value;
            }

            if (payload.PreferredDisplayId is not null)
            {
                current.Dashboard.PreferredDisplayId = payload.PreferredDisplayId.Trim();
                current.Dashboard.DisplaySelectedAt = DateTime.UtcNow.ToString("O");
            }

            if (payload.PreferredDisplayDeviceName is not null)
            {
                current.Dashboard.PreferredDisplayDeviceName = payload.PreferredDisplayDeviceName.Trim();
            }

            if (payload.PerformanceBudget is not null)
            {
                current.Dashboard.PerformanceBudget = payload.PerformanceBudget.Trim();
            }

            if (payload.GameModeAutoTune.HasValue)
            {
                current.Dashboard.GameModeAutoTune = payload.GameModeAutoTune.Value;
            }

            if (payload.ThemeReadability is not null)
            {
                current.Dashboard.ThemeReadability = payload.ThemeReadability.Trim();
            }

            if (payload.ReleaseChannel is not null)
            {
                current.Dashboard.ReleaseChannel = payload.ReleaseChannel.Trim();
            }

            if (payload.UpdateRollbackEnabled.HasValue)
            {
                current.Dashboard.UpdateRollbackEnabled = payload.UpdateRollbackEnabled.Value;
            }

            if (payload.ClipboardHidePreviews.HasValue)
            {
                current.Dashboard.ClipboardHidePreviews = payload.ClipboardHidePreviews.Value;
            }

            if (payload.ClipboardWidgetPaused.HasValue)
            {
                current.Dashboard.ClipboardWidgetPaused = payload.ClipboardWidgetPaused.Value;
            }

            if (payload.ClipboardExcludeFromDiagnostics.HasValue)
            {
                current.Dashboard.ClipboardExcludeFromDiagnostics = payload.ClipboardExcludeFromDiagnostics.Value;
            }

            if (payload.GameTelemetryDiagnosticsRetention.HasValue)
            {
                current.Dashboard.GameTelemetryDiagnosticsRetention = payload.GameTelemetryDiagnosticsRetention.Value;
            }

            if (payload.MediaMetadataVisible.HasValue)
            {
                current.Dashboard.MediaMetadataVisible = payload.MediaMetadataVisible.Value;
            }

            if (payload.AudioSessionLabelsVisible.HasValue)
            {
                current.Dashboard.AudioSessionLabelsVisible = payload.AudioSessionLabelsVisible.Value;
            }

            return current;
        });

        if (payload.ForegroundAppTrackingEnabled == false)
        {
            _launcherService?.ClearRecentHistory();
        }

        return GetSnapshot();
    }

    public object UpdateWeather(WeatherConfigRequest payload)
    {
        _configStore.Update(current =>
        {
            if (!string.IsNullOrWhiteSpace(payload.ApiKey))
            {
                current.Weather.ApiKey = payload.ApiKey.Trim();
            }

            if (!string.IsNullOrWhiteSpace(payload.City))
            {
                current.Weather.City = payload.City.Trim();
            }

            current.Weather.Units = string.Equals(payload.Units, "imperial", StringComparison.OrdinalIgnoreCase)
                ? "imperial"
                : "metric";
            return current;
        });

        return GetSnapshot();
    }

    public object UpdateCalendar(CalendarConfigRequest payload)
    {
        var normalizedIcsUrl = NetworkEndpointGuard.NormalizeRemoteHttpUrl(payload.IcsUrl, "Calendar ICS URL");
        _configStore.Update(current =>
        {
            current.Calendar.IcsUrl = normalizedIcsUrl;
            return current;
        });

        return GetSnapshot();
    }

    public object UpdateNetwork(NetworkConfigRequest payload)
    {
        _configStore.Update(current =>
        {
            current.Network.HealthTarget = payload.HealthTarget?.Trim() ?? "";
            return current;
        });

        return GetSnapshot();
    }

    public DisplayDiagnosticsSnapshot GetDisplayDiagnostics(AppConfig? config = null)
    {
        var snapshot = config ?? _configStore.Snapshot();
        return DisplayManager.BuildDiagnostics(snapshot.Dashboard.PreferredDisplayId);
    }

    public DisplayDiagnosticsSnapshot SetDisplayPreference(DisplayPreferenceRequest payload)
    {
        var displayId = payload.DisplayId?.Trim() ?? "";
        var diagnostics = GetDisplayDiagnostics();
        var selected = diagnostics.Displays.FirstOrDefault(display =>
            string.Equals(display.Id, displayId, StringComparison.OrdinalIgnoreCase)
            || string.Equals(display.DeviceName, displayId, StringComparison.OrdinalIgnoreCase)
            || string.Equals(display.DeviceId, displayId, StringComparison.OrdinalIgnoreCase));

        if (selected is null)
        {
            throw new InvalidOperationException("Display candidate not found.");
        }

        _configStore.Update(current =>
        {
            current.Dashboard.PreferredDisplayId = selected.Id;
            current.Dashboard.PreferredDisplayDeviceName = selected.DeviceName;
            current.Dashboard.DisplaySelectedAt = DateTime.UtcNow.ToString("O");
            return current;
        });

        DisplayPreferenceChanged?.Invoke();

        return GetDisplayDiagnostics();
    }

    public void ResetLocalData()
    {
        _configStore.ResetLocalData();
    }

    public object BuildPortableBackup()
    {
        var config = _configStore.Snapshot();
        return new
        {
            product = "Auxora",
            schemaVersion = 1,
            exportedAt = DateTimeOffset.UtcNow,
            dashboard = new PortableDashboardConfig
            {
                PerformanceBudget = config.Dashboard.PerformanceBudget,
                GameModeAutoTune = config.Dashboard.GameModeAutoTune,
                ThemeReadability = config.Dashboard.ThemeReadability,
                ReleaseChannel = config.Dashboard.ReleaseChannel,
                MediaMetadataVisible = config.Dashboard.MediaMetadataVisible,
                AudioSessionLabelsVisible = config.Dashboard.AudioSessionLabelsVisible
            },
            scenes = config.Scenes,
            excluded = new[] { "credentials", "integration endpoints", "launcher paths", "display identifiers", "logs" }
        };
    }

    public object RestorePortableBackup(PortableBackupRequest backup)
    {
        if (backup.SchemaVersion != 1 || backup.Scenes is null)
        {
            throw new InvalidOperationException("Unsupported or incomplete Auxora backup.");
        }

        _configStore.Update(config =>
        {
            config.Scenes = SceneDefaults.Normalize(backup.Scenes);
            if (backup.Dashboard is not null)
            {
                config.Dashboard.PerformanceBudget = backup.Dashboard.PerformanceBudget ?? config.Dashboard.PerformanceBudget;
                config.Dashboard.GameModeAutoTune = backup.Dashboard.GameModeAutoTune ?? config.Dashboard.GameModeAutoTune;
                config.Dashboard.ThemeReadability = backup.Dashboard.ThemeReadability ?? config.Dashboard.ThemeReadability;
                config.Dashboard.ReleaseChannel = backup.Dashboard.ReleaseChannel ?? config.Dashboard.ReleaseChannel;
                config.Dashboard.MediaMetadataVisible = backup.Dashboard.MediaMetadataVisible ?? config.Dashboard.MediaMetadataVisible;
                config.Dashboard.AudioSessionLabelsVisible = backup.Dashboard.AudioSessionLabelsVisible ?? config.Dashboard.AudioSessionLabelsVisible;
            }
            return config;
        });
        return BuildPortableBackup();
    }

    public string GetReleaseChannel(string? requested)
    {
        return string.IsNullOrWhiteSpace(requested)
            ? _configStore.Snapshot().Dashboard.ReleaseChannel
            : requested;
    }

    private static string GetDisplayHost(string? rawUrl)
    {
        return Uri.TryCreate(rawUrl, UriKind.Absolute, out var uri) ? uri.Host : "";
    }
}
