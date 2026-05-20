using Microsoft.Win32;
using System.Collections.Concurrent;
using System.Diagnostics;
using System.Management;
using System.Runtime.InteropServices;
using System.Security.Cryptography;

namespace XenonEdgeHost;

public sealed class SystemActionsService
{
    private const string PersonalizeRegistryPath = @"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize";
    private const string NotificationsRegistryPath = @"SOFTWARE\Microsoft\Windows\CurrentVersion\Notifications\Settings";
    private static readonly TimeSpan ConfirmationTokenTtl = TimeSpan.FromSeconds(45);
    private static readonly HashSet<string> DangerousActionIds = new(StringComparer.OrdinalIgnoreCase)
    {
        "empty-recycle-bin",
        "sleep",
        "restart",
        "shutdown"
    };

    private readonly HostLogger _logger;
    private readonly ConcurrentDictionary<string, PendingActionConfirmation> _pendingConfirmations = new(StringComparer.Ordinal);
    private bool _brightnessUnavailableLogged;

    public SystemActionsService(HostLogger logger)
    {
        _logger = logger;
    }

    public QuickActionsSnapshot GetQuickActionsSnapshot()
    {
        var darkModeEnabled = IsDarkModeEnabled();
        return new QuickActionsSnapshot
        {
            Supported = true,
            Configured = true,
            Status = "live",
            SampledAt = DateTimeOffset.UtcNow,
            Stale = false,
            Message = "Built-in Windows quick actions are ready.",
            Source = "native host",
            DarkModeEnabled = darkModeEnabled,
            Actions = new List<SystemActionItem>
            {
                new()
                {
                    Id = "dark-mode",
                    Label = "Dark Mode",
                    Detail = darkModeEnabled ? "Enabled" : "Disabled",
                    State = darkModeEnabled ? "On" : "Off",
                    Style = "toggle",
                    Enabled = true
                },
                new()
                {
                    Id = "night-light",
                    Label = "Night Light",
                    Detail = "Open Night Light settings",
                    State = "Settings",
                    Style = "launch",
                    Enabled = true
                },
                new()
                {
                    Id = "lock-workstation",
                    Label = "Lock",
                    Detail = "Lock this PC now",
                    State = "Ready",
                    Style = "command",
                    Enabled = true
                },
                new()
                {
                    Id = "open-task-manager",
                    Label = "Task Manager",
                    Detail = "Open Task Manager",
                    State = "Ready",
                    Style = "launch",
                    Enabled = true
                },
                new()
                {
                    Id = "open-settings",
                    Label = "Settings",
                    Detail = "Open Windows Settings",
                    State = "Ready",
                    Style = "launch",
                    Enabled = true
                },
                new()
                {
                    Id = "empty-recycle-bin",
                    Label = "Empty Bin",
                    Detail = "Clear the Recycle Bin",
                    State = "Ready",
                    Style = "danger",
                    Enabled = true
                }
            }
        };
    }

    public SystemShortcutsSnapshot GetShortcutsSnapshot()
    {
        var brightness = TryReadBrightnessSafely(out var brightnessSupported);
        var dndEnabled = !AreNotificationBannersEnabled();

        return new SystemShortcutsSnapshot
        {
            Supported = true,
            Configured = true,
            Status = "live",
            SampledAt = DateTimeOffset.UtcNow,
            Stale = false,
            Message = brightnessSupported
                ? "Power, brightness, and notification shortcuts are ready."
                : "Power shortcuts are ready. Brightness control is unavailable on this display.",
            Source = "native host",
            Brightness = brightness,
            BrightnessSupported = brightnessSupported,
            DndEnabled = dndEnabled,
            Toggles = new List<SystemActionItem>
            {
                new()
                {
                    Id = "toggle-dnd",
                    Label = "DND",
                    Detail = "Toggle notification banners",
                    State = dndEnabled ? "On" : "Off",
                    Style = "toggle",
                    Enabled = true
                }
            },
            PowerActions = new List<SystemActionItem>
            {
                new()
                {
                    Id = "sleep",
                    Label = "Sleep",
                    Detail = "Put the PC to sleep",
                    State = "Ready",
                    Style = "command",
                    Enabled = true
                },
                new()
                {
                    Id = "restart",
                    Label = "Restart",
                    Detail = "Restart Windows",
                    State = "Ready",
                    Style = "danger",
                    Enabled = true
                },
                new()
                {
                    Id = "shutdown",
                    Label = "Shut Down",
                    Detail = "Shut down Windows",
                    State = "Ready",
                    Style = "danger",
                    Enabled = true
                }
            }
        };
    }

    public ActionConfirmationPayload IssueConfirmation(ActionConfirmationRequest request)
    {
        var actionId = NormalizeActionId(request.ActionId);
        if (!DangerousActionIds.Contains(actionId))
        {
            throw new InvalidOperationException("This action does not require a confirmation token.");
        }

        PruneExpiredConfirmations();
        var token = Convert.ToHexString(RandomNumberGenerator.GetBytes(16));
        var expiresAt = DateTimeOffset.UtcNow.Add(ConfirmationTokenTtl);
        _pendingConfirmations[token] = new PendingActionConfirmation(actionId, expiresAt);

        return new ActionConfirmationPayload
        {
            ActionId = actionId,
            Token = token,
            ExpiresAt = expiresAt,
            TtlSeconds = (int)ConfirmationTokenTtl.TotalSeconds,
            Message = "Confirm this action within 45 seconds."
        };
    }

    public QuickActionsSnapshot ExecuteQuickAction(string actionId, string? confirmationToken = null)
    {
        var normalizedActionId = NormalizeActionId(actionId);
        RequireConfirmation(normalizedActionId, confirmationToken);

        switch (normalizedActionId)
        {
            case "dark-mode":
                SetDarkMode(!IsDarkModeEnabled());
                break;
            case "night-light":
                LaunchShellTarget("ms-settings:nightlight");
                break;
            case "lock-workstation":
                if (!LockWorkStation())
                {
                    throw new InvalidOperationException("Unable to lock the workstation.");
                }
                break;
            case "open-task-manager":
                LaunchShellTarget("taskmgr.exe");
                break;
            case "open-settings":
                LaunchShellTarget("ms-settings:");
                break;
            case "empty-recycle-bin":
                EmptyRecycleBin();
                break;
            default:
                throw new InvalidOperationException("Unknown quick action.");
        }

        return GetQuickActionsSnapshot();
    }

    public SystemShortcutsSnapshot ExecuteShortcut(string actionId, string? confirmationToken = null)
    {
        var normalizedActionId = NormalizeActionId(actionId);
        RequireConfirmation(normalizedActionId, confirmationToken);

        switch (normalizedActionId)
        {
            case "toggle-dnd":
                SetNotificationBannersEnabled(!AreNotificationBannersEnabled());
                break;
            case "sleep":
                if (!SetSuspendState(false, false, false))
                {
                    throw new InvalidOperationException("Unable to put the PC to sleep.");
                }
                break;
            case "restart":
                LaunchShellTarget("shutdown.exe", "/r /t 0");
                break;
            case "shutdown":
                LaunchShellTarget("shutdown.exe", "/s /t 0");
                break;
            default:
                throw new InvalidOperationException("Unknown system shortcut.");
        }

        return GetShortcutsSnapshot();
    }

    private static string NormalizeActionId(string? actionId)
    {
        return (actionId ?? "").Trim().ToLowerInvariant();
    }

    private void RequireConfirmation(string actionId, string? token)
    {
        if (!DangerousActionIds.Contains(actionId))
        {
            return;
        }

        PruneExpiredConfirmations();
        if (string.IsNullOrWhiteSpace(token)
            || !_pendingConfirmations.TryRemove(token.Trim(), out var confirmation)
            || !string.Equals(confirmation.ActionId, actionId, StringComparison.OrdinalIgnoreCase)
            || confirmation.ExpiresAt <= DateTimeOffset.UtcNow)
        {
            _logger.Warn($"Rejected dangerous action {actionId} without a valid server confirmation token.");
            throw new InvalidOperationException("A fresh confirmation token is required for this action.");
        }
    }

    private void PruneExpiredConfirmations()
    {
        var now = DateTimeOffset.UtcNow;
        foreach (var entry in _pendingConfirmations)
        {
            if (entry.Value.ExpiresAt <= now)
            {
                _pendingConfirmations.TryRemove(entry.Key, out _);
            }
        }
    }

    public SystemShortcutsSnapshot SetBrightness(int brightness)
    {
        var clampedBrightness = Math.Clamp(brightness, 0, 100);
        var updated = false;

        try
        {
            using var searcher = new ManagementObjectSearcher(
                @"root\wmi",
                "SELECT * FROM WmiMonitorBrightnessMethods");

            foreach (ManagementObject method in searcher.Get())
            {
                method.InvokeMethod("WmiSetBrightness", new object[] { 0U, (byte)clampedBrightness });
                updated = true;
            }
        }
        catch (ManagementException error) when (IsBrightnessUnsupported(error))
        {
            LogBrightnessUnavailable(error);
            throw new InvalidOperationException("Brightness control is unavailable on this display.", error);
        }
        catch (COMException error)
        {
            LogBrightnessUnavailable(error);
            throw new InvalidOperationException("Brightness control is unavailable on this display.", error);
        }

        if (!updated)
        {
            throw new InvalidOperationException("Brightness control is unavailable on this display.");
        }

        return GetShortcutsSnapshot();
    }

    public RestartAdminResult RestartHostAsAdministrator()
    {
        var executablePath = Environment.ProcessPath;
        if (string.IsNullOrWhiteSpace(executablePath) || !File.Exists(executablePath))
        {
            executablePath = Process.GetCurrentProcess().MainModule?.FileName ?? "";
        }

        if (string.IsNullOrWhiteSpace(executablePath) || !File.Exists(executablePath))
        {
            throw new InvalidOperationException("Unable to locate the Xenon host executable.");
        }

        var startInfo = new ProcessStartInfo
        {
            FileName = executablePath,
            UseShellExecute = true,
            Verb = "runas",
            WorkingDirectory = AppContext.BaseDirectory
        };
        if (Process.Start(startInfo) is null)
        {
            throw new InvalidOperationException("Elevated restart was not started.");
        }

        _logger.Info("Requested elevated restart for Game Mode FPS capture.");

        _ = Task.Run(async () =>
        {
            await Task.Delay(900);
            Environment.Exit(0);
        });

        return new RestartAdminResult
        {
            Ok = true,
            Message = "Restarting Xenon as administrator."
        };
    }

    private static bool IsDarkModeEnabled()
    {
        using var key = Registry.CurrentUser.OpenSubKey(PersonalizeRegistryPath, false);
        var appsUseLightTheme = ReadDword(key, "AppsUseLightTheme", 1);
        var systemUsesLightTheme = ReadDword(key, "SystemUsesLightTheme", 1);
        return appsUseLightTheme == 0 && systemUsesLightTheme == 0;
    }

    private void SetDarkMode(bool darkModeEnabled)
    {
        using var key = Registry.CurrentUser.CreateSubKey(PersonalizeRegistryPath, true)
            ?? throw new InvalidOperationException("Unable to open the Windows theme settings.");

        var lightThemeValue = darkModeEnabled ? 0 : 1;
        key.SetValue("AppsUseLightTheme", lightThemeValue, RegistryValueKind.DWord);
        key.SetValue("SystemUsesLightTheme", lightThemeValue, RegistryValueKind.DWord);
        BroadcastSettingChange("ImmersiveColorSet");
        BroadcastSettingChange("WindowsThemeElement");
        _logger.Info($"Dark mode {(darkModeEnabled ? "enabled" : "disabled")}.");
    }

    private static bool AreNotificationBannersEnabled()
    {
        using var key = Registry.CurrentUser.OpenSubKey(NotificationsRegistryPath, false);
        return ReadDword(key, "NOC_GLOBAL_SETTING_TOASTS_ENABLED", 1) != 0;
    }

    private void SetNotificationBannersEnabled(bool enabled)
    {
        using var key = Registry.CurrentUser.CreateSubKey(NotificationsRegistryPath, true)
            ?? throw new InvalidOperationException("Unable to open the Windows notification settings.");

        key.SetValue("NOC_GLOBAL_SETTING_TOASTS_ENABLED", enabled ? 1 : 0, RegistryValueKind.DWord);
        BroadcastSettingChange("WindowsNotifications");
        _logger.Info($"Notification banners {(enabled ? "enabled" : "disabled")}.");
    }

    private int? TryReadBrightnessSafely(out bool supported)
    {
        try
        {
            return TryReadBrightness(out supported);
        }
        catch (ManagementException error) when (IsBrightnessUnsupported(error))
        {
            supported = false;
            LogBrightnessUnavailable(error);
            return null;
        }
        catch (COMException error)
        {
            supported = false;
            LogBrightnessUnavailable(error);
            return null;
        }
    }

    private static int? TryReadBrightness(out bool supported)
    {
        supported = false;

        using var searcher = new ManagementObjectSearcher(
            @"root\wmi",
            "SELECT CurrentBrightness, Active FROM WmiMonitorBrightness");

        foreach (ManagementObject brightness in searcher.Get())
        {
            var isActive = brightness["Active"] is null || Convert.ToBoolean(brightness["Active"]);
            if (!isActive)
            {
                continue;
            }

            supported = true;
            return Convert.ToInt32(brightness["CurrentBrightness"]);
        }

        return null;
    }

    private void LogBrightnessUnavailable(Exception error)
    {
        if (_brightnessUnavailableLogged)
        {
            return;
        }

        _brightnessUnavailableLogged = true;
        _logger.Info($"Brightness control unavailable on this display: {error.Message}");
    }

    private static bool IsBrightnessUnsupported(ManagementException error)
    {
        return error.ErrorCode == ManagementStatus.NotSupported
            || error.Message.Contains("Not supported", StringComparison.OrdinalIgnoreCase);
    }

    private static int ReadDword(RegistryKey? key, string name, int fallback)
    {
        if (key?.GetValue(name) is int value)
        {
            return value;
        }

        return fallback;
    }

    private void EmptyRecycleBin()
    {
        var result = SHEmptyRecycleBin(
            IntPtr.Zero,
            null,
            RecycleBinFlags.NoConfirmation | RecycleBinFlags.NoProgressUi | RecycleBinFlags.NoSound);

        if (result != 0)
        {
            throw new InvalidOperationException($"Unable to empty the Recycle Bin (HRESULT 0x{result:X8}).");
        }

        _logger.Info("Recycle Bin emptied.");
    }

    private static void LaunchShellTarget(string fileName, string? arguments = null)
    {
        var startInfo = new ProcessStartInfo
        {
            FileName = fileName,
            UseShellExecute = true
        };

        if (!string.IsNullOrWhiteSpace(arguments))
        {
            startInfo.Arguments = arguments;
        }

        Process.Start(startInfo);
    }

    private static void BroadcastSettingChange(string area)
    {
        var areaPointer = Marshal.StringToHGlobalUni(area);
        try
        {
            SendMessageTimeout(
                new IntPtr(BroadcastHwnd),
                WmSettingChange,
                IntPtr.Zero,
                areaPointer,
                SendMessageTimeoutFlags.AbortIfHung,
                250,
                out _);
        }
        finally
        {
            Marshal.FreeHGlobal(areaPointer);
        }
    }

    private const int BroadcastHwnd = 0xffff;
    private const uint WmSettingChange = 0x001A;

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool LockWorkStation();

    [DllImport("powrprof.dll", SetLastError = true)]
    private static extern bool SetSuspendState(bool hibernate, bool forceCritical, bool disableWakeEvent);

    [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
    private static extern int SHEmptyRecycleBin(IntPtr hwnd, string? rootPath, RecycleBinFlags flags);

    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr SendMessageTimeout(
        IntPtr hWnd,
        uint message,
        IntPtr wParam,
        IntPtr lParam,
        SendMessageTimeoutFlags flags,
        uint timeout,
        out IntPtr result);
}

[Flags]
public enum RecycleBinFlags : uint
{
    NoConfirmation = 0x00000001,
    NoProgressUi = 0x00000002,
    NoSound = 0x00000004
}

[Flags]
public enum SendMessageTimeoutFlags : uint
{
    AbortIfHung = 0x0002
}

public sealed class SystemActionItem
{
    public string Id { get; set; } = "";

    public string Label { get; set; } = "";

    public string Detail { get; set; } = "";

    public string State { get; set; } = "";

    public string Style { get; set; } = "command";

    public bool Enabled { get; set; } = true;
}

public sealed class RestartAdminResult
{
    public bool Ok { get; set; }

    public string Message { get; set; } = "";
}

public sealed class ActionConfirmationPayload
{
    public string ActionId { get; set; } = "";

    public string Token { get; set; } = "";

    public DateTimeOffset ExpiresAt { get; set; }

    public int TtlSeconds { get; set; }

    public string Message { get; set; } = "";
}

public sealed record PendingActionConfirmation(string ActionId, DateTimeOffset ExpiresAt);

public sealed class QuickActionsSnapshot
{
    public bool Supported { get; set; } = true;

    public bool Configured { get; set; } = true;

    public string Status { get; set; } = "live";

    public DateTimeOffset? SampledAt { get; set; }

    public bool Stale { get; set; }

    public string Message { get; set; } = "";

    public string Source { get; set; } = "native host";

    public bool DarkModeEnabled { get; set; }

    public List<SystemActionItem> Actions { get; set; } = [];
}

public sealed class SystemShortcutsSnapshot
{
    public bool Supported { get; set; } = true;

    public bool Configured { get; set; } = true;

    public string Status { get; set; } = "live";

    public DateTimeOffset? SampledAt { get; set; }

    public bool Stale { get; set; }

    public string Message { get; set; } = "";

    public string Source { get; set; } = "native host";

    public int? Brightness { get; set; }

    public bool BrightnessSupported { get; set; }

    public bool DndEnabled { get; set; }

    public List<SystemActionItem> Toggles { get; set; } = [];

    public List<SystemActionItem> PowerActions { get; set; } = [];
}
