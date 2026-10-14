namespace XenonEdgeHost;

public sealed class TelemetryController
{
    private readonly ConfigStore _configStore;
    private readonly ConfigController _configController;
    private readonly SystemMetricsService _systemMetrics;
    private readonly GpuPowerMonitorService _gpuPowerMonitor;
    private readonly NetworkMetricsService _networkMetrics;
    private readonly AudioService _audioService;
    private readonly EqualizerApoService _equalizerApoService;
    private readonly CalendarService _calendarService;
    private readonly HueService _hueService;
    private readonly UniFiService _uniFiService;
    private readonly FrigateService _frigateService;
    private readonly MediaService _mediaService;
    private readonly ClipboardHistoryService _clipboardHistoryService;
    private readonly ProvisioningService _provisioningService;
    private readonly LauncherService _launcherService;
    private readonly SystemActionsService _systemActionsService;
    private readonly string _dashboardAssetRevision;

    public TelemetryController(
        ConfigStore configStore,
        ConfigController configController,
        SystemMetricsService systemMetrics,
        GpuPowerMonitorService gpuPowerMonitor,
        NetworkMetricsService networkMetrics,
        AudioService audioService,
        EqualizerApoService equalizerApoService,
        CalendarService calendarService,
        HueService hueService,
        UniFiService uniFiService,
        FrigateService frigateService,
        MediaService mediaService,
        ClipboardHistoryService clipboardHistoryService,
        ProvisioningService provisioningService,
        LauncherService launcherService,
        SystemActionsService systemActionsService,
        string dashboardAssetRevision)
    {
        _configStore = configStore;
        _configController = configController;
        _systemMetrics = systemMetrics;
        _gpuPowerMonitor = gpuPowerMonitor;
        _networkMetrics = networkMetrics;
        _audioService = audioService;
        _equalizerApoService = equalizerApoService;
        _calendarService = calendarService;
        _hueService = hueService;
        _uniFiService = uniFiService;
        _frigateService = frigateService;
        _mediaService = mediaService;
        _clipboardHistoryService = clipboardHistoryService;
        _provisioningService = provisioningService;
        _launcherService = launcherService;
        _systemActionsService = systemActionsService;
        _dashboardAssetRevision = string.IsNullOrWhiteSpace(dashboardAssetRevision) ? "unknown" : dashboardAssetRevision;
    }

    public SystemSnapshot GetSystemSnapshot()
    {
        return _systemMetrics.GetSnapshot();
    }

    public GpuPowerSnapshot GetGpuPowerSnapshot()
    {
        return _gpuPowerMonitor.GetSnapshot();
    }

    public NetworkSnapshot GetNetworkSnapshot()
    {
        return _networkMetrics.GetSnapshot();
    }

    public Task<UniFiNetworkPayload> GetUniFiNetworkAsync(CancellationToken cancellationToken)
    {
        return _uniFiService.GetNetworkPayloadAsync(_networkMetrics.GetSnapshot(), cancellationToken);
    }

    public Task<UniFiNetworkPayload> LinkUniFiAsync(UniFiLinkRequest request, CancellationToken cancellationToken)
    {
        return _uniFiService.LinkAsync(request, _networkMetrics.GetSnapshot(), cancellationToken);
    }

    public UniFiNetworkPayload DisconnectUniFi()
    {
        return _uniFiService.Disconnect(_networkMetrics.GetSnapshot());
    }

    public Task<AudioSnapshotPayload> GetAudioAsync(CancellationToken cancellationToken)
    {
        return _audioService.GetSnapshotAsync(cancellationToken);
    }

    public Task<AudioSnapshotPayload> SetDefaultAudioDeviceAsync(AudioDeviceRequest request, CancellationToken cancellationToken)
    {
        return _audioService.SetDefaultDeviceAsync(request.DeviceId, cancellationToken);
    }

    public Task<AudioSnapshotPayload> SetAudioMasterVolumeAsync(AudioVolumeRequest request, CancellationToken cancellationToken)
    {
        return _audioService.SetMasterVolumeAsync(request.Volume, cancellationToken);
    }

    public Task<AudioSnapshotPayload> SetAudioMasterMuteAsync(AudioMuteRequest request, CancellationToken cancellationToken)
    {
        return _audioService.SetMasterMuteAsync(request.Muted, cancellationToken);
    }

    public Task<AudioSnapshotPayload> SetAudioInputVolumeAsync(AudioVolumeRequest request, CancellationToken cancellationToken)
    {
        return _audioService.SetInputVolumeAsync(request.Volume, cancellationToken);
    }

    public Task<AudioSnapshotPayload> SetAudioInputMuteAsync(AudioMuteRequest request, CancellationToken cancellationToken)
    {
        return _audioService.SetInputMuteAsync(request.Muted, cancellationToken);
    }

    public Task<AudioSnapshotPayload> SetAudioSessionVolumeAsync(AudioSessionVolumeRequest request, CancellationToken cancellationToken)
    {
        return _audioService.SetSessionVolumeAsync(request.SessionId, request.Volume, cancellationToken);
    }

    public Task<AudioSnapshotPayload> SetAudioSessionMuteAsync(AudioSessionMuteRequest request, CancellationToken cancellationToken)
    {
        return _audioService.SetSessionMuteAsync(request.SessionId, request.Muted, cancellationToken);
    }

    public EqualizerApoSnapshot GetAudioEqualizer()
    {
        return _equalizerApoService.GetSnapshot();
    }

    public EqualizerApoSnapshot EnableAudioEqualizer()
    {
        return _equalizerApoService.EnableIntegration();
    }

    public EqualizerApoSnapshot UpdateAudioEqualizer(EqualizerApoUpdateRequest request)
    {
        return _equalizerApoService.Update(request);
    }

    public Task<object> BuildHealthPayloadAsync(CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        var config = _configStore.Snapshot();
        var launchers = _launcherService.GetSnapshot(config);
        var quickActions = _systemActionsService.GetQuickActionsSnapshot();
        var shortcuts = _systemActionsService.GetShortcutsSnapshot();
        var audio = _audioService.GetCachedSnapshot();
        var calendar = _calendarService.GetCachedSnapshot(config);
        var media = _mediaService.GetCachedSnapshot();
        var hue = _hueService.GetCachedSnapshot(config);
        var clipboard = _clipboardHistoryService.GetHealthStatus(
            ClipboardPrivacyOptions.FromDashboard(config.Dashboard));
        var gpuPower = _gpuPowerMonitor.GetSnapshot();
        var provisioning = ProvisioningSummaryPayload.FromSnapshot(_provisioningService.GetSnapshot());
        var displayDiagnostics = _configController.GetDisplayDiagnostics(config);
        var displayStatusReady = string.Equals(displayDiagnostics.Status, "ready", StringComparison.OrdinalIgnoreCase);
        var companionDisplayReady = displayStatusReady
            && ConfigController.IsCompanionDisplayReady(displayDiagnostics);
        var displayItem = CreateSetupItem(
            "display",
            "Auxora companion display",
            companionDisplayReady ? "Ready" : "Needs Setup",
            true,
            displayDiagnostics.Message);

        var bridge = CreateSetupItem("bridge", "Local app service", "Ready", true, $"Running at {BuildBaseUri(config.Port)}.");
        var system = CreateSetupItem("system", "System Monitor", "Ready", true, "Native system telemetry is live.");
        var provisioningItem = CreateSetupItem(
            "provisioning",
            "Auto provisioning",
            string.Equals(provisioning.Status, "live", StringComparison.OrdinalIgnoreCase) ? "Ready" : "Checking",
            true,
            TextOr(provisioning.Message, "Auxora scans this PC and prepares safe defaults automatically."));
        var gpuPowerItem = CreateSetupItem(
            "gpu-power",
            "GPU Power Monitor",
            gpuPower.Status == "error" ? "Optional" : "Ready",
            false,
            TextOr(gpuPower.Message, "GPU connector and rail telemetry is ready when exposed by local sensor tools."));
        var network = CreateSetupItem("network", "Network Monitor", "Ready", true, "Native network telemetry is live.");
        var launcherItem = CreateSetupItem(
            "launchers",
            "Recent apps",
            launchers.Configured ? "Ready" : "Optional",
            false,
            TextOr(launchers.Message, "Auxora scans Start Menu shortcuts and Steam games automatically."));
        var quickActionsItem = CreateSetupItem(
            "quick-actions",
            "Quick Actions",
            "Ready",
            false,
            TextOr(quickActions.Message, "Built-in Windows quick actions are ready."));
        var shortcutsItem = CreateSetupItem(
            "shortcuts",
            "System Shortcuts",
            "Ready",
            false,
            TextOr(shortcuts.Message, "Power, brightness, and notification shortcuts are ready."));
        var audioItem = CreateSetupItem(
            "audio",
            "Audio & Media",
            audio.Configured ? "Ready" : "Optional",
            false,
            audio.Configured
                ? $"Core Audio is live with {audio.Devices.Count} playback outputs. Media controls are {TextOr(media.Status, "ready")}."
                : TextOr(audio.Message, "No playback outputs were detected."));
        var weather = !string.IsNullOrWhiteSpace(config.Weather.ApiKey)
            ? CreateSetupItem("weather", "Weather", "Ready", false, $"Configured for {config.Weather.City} in {config.Weather.Units} units.")
            : CreateSetupItem("weather", "Weather", "Optional", false, "Add an OpenWeather key if you want the Weather widget.");
        var calendarItem = !string.IsNullOrWhiteSpace(config.Calendar.IcsUrl)
            ? CreateSetupItem(
                "calendar",
                "Calendar",
                calendar.Status == "error" ? "Needs Setup" : "Ready",
                false,
                TextOr(calendar.Message, "Upcoming ICS events are live."))
            : CreateSetupItem("calendar", "Calendar", "Optional", false, "Add an ICS feed URL if you want the Calendar widget.");
        var mediaItem = CreateSetupItem(
            "media",
            "Audio & Media",
            audio.Configured ? "Ready" : media.Status == "error" ? "Needs Setup" : "Ready",
            false,
            media.Status == "idle"
                ? "Windows media transport is ready inside Audio & Media."
                : TextOr(media.Message, "Windows media transport controls are live inside Audio & Media."));
        var clipboardItem = CreateSetupItem(
            "clipboard",
            "Clipboard History",
            clipboard.Status == "error" ? "Needs Setup" : clipboard.Status == "setup" ? "Optional" : "Ready",
            false,
            TextOr(clipboard.Message, "Clipboard history is live."));
        var hueItem = !string.IsNullOrWhiteSpace(config.Hue.BridgeIp)
            ? CreateSetupItem("hue", "Philips Hue", hue.Linked ? "Ready" : "Needs Setup", false, TextOr(hue.Message, hue.Linked ? "Linked to your Hue Bridge." : "Press the bridge button, then link it from Diagnostics."))
            : CreateSetupItem("hue", "Philips Hue", "Optional", false, "Add your Hue Bridge only if you want local light control.");
        var uniFi = _uniFiService.GetCachedNetworkPayload(_networkMetrics.GetSnapshot());
        var uniFiItem = uniFi.Linked
            ? CreateSetupItem("unifi", "UniFi Network", "Ready", false, $"Linked locally to {uniFi.Gateway}.")
            : uniFi.Configured && string.Equals(uniFi.Status, "error", StringComparison.OrdinalIgnoreCase)
                ? CreateSetupItem("unifi", "UniFi Network", "Needs Setup", false, TextOr(uniFi.Message, "Reconnect UniFi from the Network page."))
                : uniFi.Detected
                    ? CreateSetupItem("unifi", "UniFi Network", "Detected", false, $"Found UniFi locally at {uniFi.GatewayIp}. Connect from the Network page for clients and APs.")
                    : string.Equals(uniFi.Status, "checking", StringComparison.OrdinalIgnoreCase)
                        ? CreateSetupItem("unifi", "UniFi Network", "Checking", false, "Auxora is checking for a local UniFi console in the background.")
                        : CreateSetupItem("unifi", "UniFi Network", "Optional", false, "Network Monitor works now. Link UniFi locally when you want gateway detail.");
        var frigateConnection = _frigateService.GetConnectionStatus(config);
        var frigateItem = new
        {
            id = "frigate",
            label = "Camera Detection",
            state = frigateConnection.State,
            required = false,
            nextStep = frigateConnection.Message,
            configured = frigateConnection.Configured,
            connected = frigateConnection.Connected,
            authenticated = frigateConnection.Authenticated,
            sampledAt = frigateConnection.SampledAt
        };

        return Task.FromResult<object>(new
        {
            ok = true,
            app = new
            {
                name = "Auxora",
                version = AppBuildIdentity.Version,
                dashboardAssetRevision = _dashboardAssetRevision
            },
            capabilities = new
            {
                system = true,
                display = true,
                gpuPower = true,
                network = true,
                launchers = true,
                quickActions = true,
                shortcuts = true,
                audio = true,
                weather = true,
                calendar = true,
                media = true,
                clipboard = true,
                hue = true,
                unifi = true,
                frigate = true,
                gameActivity = true
            },
            setup = new
            {
                essentialsReady = string.Equals(displayDiagnostics.Status, "ready", StringComparison.OrdinalIgnoreCase)
                    && companionDisplayReady,
                onboardingCompleted = config.Dashboard.OnboardingCompleted,
                onboardingCompletedAt = config.Dashboard.OnboardingCompletedAt,
                onboardingVersion = config.Dashboard.OnboardingVersion,
                needsAttention = (!string.IsNullOrWhiteSpace(config.Calendar.IcsUrl) && calendar.Status == "error")
                    || (!string.IsNullOrWhiteSpace(config.Hue.BridgeIp) && !hue.Linked)
                    || !(string.Equals(displayDiagnostics.Status, "ready", StringComparison.OrdinalIgnoreCase)
                        && companionDisplayReady),
                provisioning,
                display = displayDiagnostics,
                items = new Dictionary<string, object>
                {
                    ["bridge"] = bridge,
                    ["provisioning"] = provisioningItem,
                    ["display"] = displayItem,
                    ["system"] = system,
                    ["gpu-power"] = gpuPowerItem,
                    ["network"] = network,
                    ["launchers"] = launcherItem,
                    ["quick-actions"] = quickActionsItem,
                    ["shortcuts"] = shortcutsItem,
                    ["audio"] = audioItem,
                    ["weather"] = weather,
                    ["calendar"] = calendarItem,
                    ["media"] = mediaItem,
                    ["clipboard"] = clipboardItem,
                    ["hue"] = hueItem,
                    ["unifi"] = uniFiItem,
                    ["frigate"] = frigateItem
                }
            }
        });
    }

    private static object CreateSetupItem(string id, string label, string state, bool required, string nextStep)
    {
        return new
        {
            id,
            label,
            state,
            required,
            nextStep
        };
    }

    private static string TextOr(string? value, string fallback)
    {
        return string.IsNullOrWhiteSpace(value) ? fallback : value;
    }

    private static Uri BuildBaseUri(int port)
    {
        return new Uri($"http://127.0.0.1:{port}/");
    }
}
