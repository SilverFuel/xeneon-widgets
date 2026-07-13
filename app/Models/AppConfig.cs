namespace XenonEdgeHost;

public sealed class AppConfig
{
    public int Port { get; set; } = 8976;

    public WeatherConfig Weather { get; set; } = new();

    public CalendarConfig Calendar { get; set; } = new();

    public HueConfig Hue { get; set; } = new();

    public UniFiConfig UniFi { get; set; } = new();

    public NetworkConfig Network { get; set; } = new();

    public DashboardConfig Dashboard { get; set; } = new();

    public SceneCollectionConfig Scenes { get; set; } = SceneDefaults.Create();

    public List<LauncherEntryConfig> Launchers { get; set; } = [];

    public List<LauncherEntryConfig> PinnedGames { get; set; } = [];
}

public sealed class WeatherConfig
{
    public string ApiKey { get; set; } = "";

    public string City { get; set; } = "";

    public string Units { get; set; } = "metric";
}

public sealed class CalendarConfig
{
    public string IcsUrl { get; set; } = "";
}

public sealed class HueConfig
{
    public string BridgeIp { get; set; } = "";

    public string AppKey { get; set; } = "";

    public string ClientKey { get; set; } = "";

    public string CertificateThumbprint { get; set; } = "";
}

public sealed class UniFiConfig
{
    public string Host { get; set; } = "";

    public string Username { get; set; } = "";

    public string Password { get; set; } = "";

    public string Site { get; set; } = "default";

    public string CertificateThumbprint { get; set; } = "";
}

public sealed class NetworkConfig
{
    public string HealthTarget { get; set; } = "";
}

public sealed class DashboardConfig
{
    public bool AutoProvisioningEnabled { get; set; } = true;

    public string AutoProvisionedAt { get; set; } = "";

    public int AutoProvisioningVersion { get; set; } = 1;

    public bool LauncherReviewRequired { get; set; } = true;

    public bool AutoApplyLauncherSuggestions { get; set; }

    public bool OnboardingCompleted { get; set; }

    public string OnboardingCompletedAt { get; set; } = "";

    public int OnboardingVersion { get; set; } = 1;

    public string PreferredDisplayId { get; set; } = "";

    public string PreferredDisplayDeviceName { get; set; } = "";

    public string DisplaySelectedAt { get; set; } = "";

    public string PerformanceBudget { get; set; } = "balanced";

    public bool GameModeAutoTune { get; set; } = true;

    public string ThemeReadability { get; set; } = "normal";

    public string ReleaseChannel { get; set; } = "stable";

    public bool UpdateRollbackEnabled { get; set; } = true;

    public string LastKnownGoodVersion { get; set; } = "";

    public string LastKnownGoodPath { get; set; } = "";

    public bool ClipboardHidePreviews { get; set; } = true;

    public bool ClipboardWidgetPaused { get; set; }

    public bool ClipboardExcludeFromDiagnostics { get; set; } = true;

    public bool GameTelemetryDiagnosticsRetention { get; set; }

    public bool MediaMetadataVisible { get; set; }

    public bool AudioSessionLabelsVisible { get; set; }
}

public sealed class SceneCollectionConfig
{
    public string ActiveSceneId { get; set; } = "scene-work";

    public string DefaultSceneId { get; set; } = "scene-work";

    public bool AutomationEnabled { get; set; } = true;

    public string ManualOverrideUntil { get; set; } = "";

    public string LastActivationReason { get; set; } = "Default scene";

    public List<SceneProfile> Profiles { get; set; } = [];

    public List<DisplaySceneAssignment> DisplayAssignments { get; set; } = [];
}

public sealed class DisplaySceneAssignment
{
    public string DisplayId { get; set; } = "";

    public string SceneId { get; set; } = "scene-work";
}

public sealed class SceneProfile
{
    public string Id { get; set; } = "";

    public string Name { get; set; } = "";

    public string Icon { get; set; } = "spark";

    public string ThemeId { get; set; } = "edge";

    public string AccentColor { get; set; } = "";

    public string Density { get; set; } = "comfortable";

    public int Brightness { get; set; } = 70;

    public int AnimationIntensity { get; set; } = 25;

    public string PerformanceBudget { get; set; } = "balanced";

    public bool IsBuiltIn { get; set; }

    public List<string> Widgets { get; set; } = [];

    public List<string> QuickActions { get; set; } = [];

    public DisplayLayoutProfile Layout { get; set; } = new();

    public List<SceneRule> Rules { get; set; } = [];
}

public sealed class DisplayLayoutProfile
{
    public string NavigationPlacement { get; set; } = "auto";

    public int MaxColumns { get; set; } = 4;

    public int MinimumCardWidth { get; set; } = 280;

    public string Orientation { get; set; } = "adaptive";
}

public sealed class SceneRule
{
    public string Id { get; set; } = "";

    public string Type { get; set; } = "application";

    public string Value { get; set; } = "";

    public string StartTime { get; set; } = "";

    public string EndTime { get; set; } = "";

    public int Priority { get; set; } = 50;

    public bool Enabled { get; set; } = true;
}

public sealed class LauncherEntryConfig
{
    public string Id { get; set; } = "";

    public string DisplayName { get; set; } = "";

    public string IconPath { get; set; } = "";

    public string ExecutablePath { get; set; } = "";

    public string Arguments { get; set; } = "";
}

public sealed class WeatherConfigRequest
{
    public string? ApiKey { get; set; }

    public string? City { get; set; }

    public string? Units { get; set; }
}

public sealed class CalendarConfigRequest
{
    public string? IcsUrl { get; set; }
}

public sealed class DashboardConfigRequest
{
    public bool? OnboardingCompleted { get; set; }

    public int? OnboardingVersion { get; set; }

    public bool? LauncherReviewRequired { get; set; }

    public bool? AutoApplyLauncherSuggestions { get; set; }

    public string? PreferredDisplayId { get; set; }

    public string? PreferredDisplayDeviceName { get; set; }

    public string? PerformanceBudget { get; set; }

    public bool? GameModeAutoTune { get; set; }

    public string? ThemeReadability { get; set; }

    public string? ReleaseChannel { get; set; }

    public bool? UpdateRollbackEnabled { get; set; }

    public bool? ClipboardHidePreviews { get; set; }

    public bool? ClipboardWidgetPaused { get; set; }

    public bool? ClipboardExcludeFromDiagnostics { get; set; }

    public bool? GameTelemetryDiagnosticsRetention { get; set; }

    public bool? MediaMetadataVisible { get; set; }

    public bool? AudioSessionLabelsVisible { get; set; }
}

public sealed class NetworkConfigRequest
{
    public string? HealthTarget { get; set; }
}

public sealed class GameModeSessionRequest
{
    public bool Refresh { get; set; }

    public bool SteamRefresh { get; set; }

    public bool ActivityRefresh { get; set; }

    public bool PerformanceSession { get; set; }
}

public sealed class HueLinkRequest
{
    public string? BridgeIp { get; set; }

    public bool TrustCertificate { get; set; }

    public string? TrustedCertificateThumbprint { get; set; }
}

public sealed class UniFiLinkRequest
{
    public string? Host { get; set; }

    public string? Username { get; set; }

    public string? Password { get; set; }

    public string? Site { get; set; }

    public bool TrustCertificate { get; set; }

    public string? TrustedCertificateThumbprint { get; set; }
}

public sealed class AudioDeviceRequest
{
    public string? DeviceId { get; set; }
}

public sealed class AudioVolumeRequest
{
    public double Volume { get; set; }
}

public sealed class AudioMuteRequest
{
    public bool Muted { get; set; }
}

public sealed class AudioSessionVolumeRequest
{
    public string? SessionId { get; set; }

    public double Volume { get; set; }
}

public sealed class AudioSessionMuteRequest
{
    public string? SessionId { get; set; }

    public bool Muted { get; set; }
}

public sealed class HueToggleRequest
{
    public bool State { get; set; }
}

public sealed class HueBrightnessRequest
{
    public int Brightness { get; set; }
}

public sealed class LaunchersUpdateRequest
{
    public List<LauncherEntryRequest> Entries { get; set; } = [];
}

public sealed class LauncherEntryRequest
{
    public string? Id { get; set; }

    public string? DisplayName { get; set; }

    public string? IconPath { get; set; }

    public string? ExecutablePath { get; set; }

    public string? Arguments { get; set; }
}

public sealed class LauncherLaunchRequest
{
    public string? Id { get; set; }
}

public sealed class LauncherSuggestionApplyRequest
{
    public List<string> Ids { get; set; } = [];
}

public sealed class DisplayPreferenceRequest
{
    public string? DisplayId { get; set; }
}

public sealed class SceneActivationRequest
{
    public string? SceneId { get; set; }

    public int? ManualOverrideMinutes { get; set; }
}

public sealed class SceneSaveRequest
{
    public SceneProfile? Scene { get; set; }
}

public sealed class SceneDuplicateRequest
{
    public string? SceneId { get; set; }

    public string? Name { get; set; }
}

public sealed class SceneDeleteRequest
{
    public string? SceneId { get; set; }
}

public sealed class DisplaySceneAssignmentRequest
{
    public string? DisplayId { get; set; }

    public string? SceneId { get; set; }
}

public sealed class SceneEvaluationRequest
{
    public string? ForegroundProcess { get; set; }

    public string? ActiveGame { get; set; }

    public bool MediaPlaying { get; set; }

    public string? SampledAt { get; set; }
}

public sealed class PortableBackupRequest
{
    public int SchemaVersion { get; set; } = 1;

    public PortableDashboardConfig? Dashboard { get; set; }

    public SceneCollectionConfig? Scenes { get; set; }
}

public sealed class PortableDashboardConfig
{
    public string? PerformanceBudget { get; set; }

    public bool? GameModeAutoTune { get; set; }

    public string? ThemeReadability { get; set; }

    public string? ReleaseChannel { get; set; }

    public bool? MediaMetadataVisible { get; set; }

    public bool? AudioSessionLabelsVisible { get; set; }
}

public sealed class BrightnessRequest
{
    public int Brightness { get; set; }
}

public sealed class MonitorControlRequest
{
    public int DisplayIndex { get; set; }

    public string? Control { get; set; }

    public int Value { get; set; }
}

public sealed class ActionConfirmationRequest
{
    public string? ActionId { get; set; }

    public string? Token { get; set; }
}

public sealed class ActionChainExecuteRequest
{
    public string? ChainId { get; set; }
}

public sealed class ClipboardCopyRequest
{
    public string? Id { get; set; }
}
