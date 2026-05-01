namespace XenonEdgeHost;

public sealed class AppConfig
{
    public int Port { get; set; } = 8976;

    public WeatherConfig Weather { get; set; } = new();

    public CalendarConfig Calendar { get; set; } = new();

    public HueConfig Hue { get; set; } = new();

    public DashboardConfig Dashboard { get; set; } = new();

    public List<LauncherEntryConfig> Launchers { get; set; } = [];
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
}

public sealed class DashboardConfig
{
    public bool OnboardingCompleted { get; set; }

    public string OnboardingCompletedAt { get; set; } = "";

    public int OnboardingVersion { get; set; } = 1;
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
}

public sealed class HueLinkRequest
{
    public string? BridgeIp { get; set; }
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

public sealed class BrightnessRequest
{
    public int Brightness { get; set; }
}

public sealed class ClipboardCopyRequest
{
    public string? Id { get; set; }
}
