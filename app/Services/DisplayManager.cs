using System.Drawing;
using System.Runtime.InteropServices;

namespace XenonEdgeHost;

public static class DisplayManager
{
    private const int EnumCurrentSettings = -1;

    public static DisplayTarget FindBestDisplay(string? preferredDisplayId = null)
    {
        var displays = ListDisplays(preferredDisplayId);

        if (displays.Count == 0)
        {
            throw new InvalidOperationException(
                "No active companion display is available. Auxora will wait rather than open on the Windows primary display.");
        }

        return displays.First();
    }

    public static List<DisplayTarget> ListDisplays(string? preferredDisplayId = null)
    {
        return ListCompanionDisplays(EnumerateDisplays(), preferredDisplayId);
    }

    public static List<DisplayTarget> ListCompanionDisplays(
        IEnumerable<DisplayTarget> activeDisplays,
        string? preferredDisplayId = null)
    {
        ArgumentNullException.ThrowIfNull(activeDisplays);

        return activeDisplays
            .Where(display => !display.IsPrimary)
            .Select(display => display.WithPreference(preferredDisplayId))
            .OrderByDescending(display => display.Score)
            .ToList();
    }

    public static DisplayDiagnosticsSnapshot BuildDiagnostics(string? preferredDisplayId = null)
    {
        return BuildDiagnostics(EnumerateDisplays(), preferredDisplayId);
    }

    public static DisplayDiagnosticsSnapshot BuildDiagnostics(
        IEnumerable<DisplayTarget> activeDisplays,
        string? preferredDisplayId = null)
    {
        ArgumentNullException.ThrowIfNull(activeDisplays);

        var active = activeDisplays.ToList();
        var companions = ListCompanionDisplays(active, preferredDisplayId);
        var preferredAvailable = companions.Any(display => display.IsPreferred);
        var selected = preferredAvailable
            ? companions.First(display => display.IsPreferred)
            : companions.Count == 1
                ? companions[0]
                : null;
        var selectedModeMismatch = selected?.RequiresNativeModeCorrection == true;
        var status = companions.Count == 0
            ? "waiting-for-companion-display"
            : selectedModeMismatch
                ? "display-mode-mismatch"
            : selected is not null
                ? "ready"
                : "selection-required";

        return new DisplayDiagnosticsSnapshot
        {
            Supported = true,
            Status = status,
            SampledAt = DateTimeOffset.UtcNow,
            PreferredDisplayId = preferredDisplayId?.Trim() ?? "",
            SelectedDisplayId = selected?.StableId ?? "",
            SelectedDisplayName = selected?.Label ?? "",
            ActiveDisplayCount = active.Count,
            CompanionDisplayCount = companions.Count,
            EdgeCandidateCount = companions.Count,
            Message = companions.Count == 0
                ? active.Count == 0
                    ? "Windows did not expose any active displays. Auxora is waiting for a companion display."
                    : "Auxora is waiting for an active companion display and will not open on the Windows primary display."
                : selectedModeMismatch
                    ? $"The XENEON EDGE is using {selected!.ModeWidth}x{selected.ModeHeight}. Set it to 2560x720 at 60 Hz so Auxora can use the full companion surface."
                : preferredAvailable
                    ? "Auxora found your saved companion-display preference."
                    : companions.Count == 1
                        ? "One active companion display is available."
                        : "Choose which companion display should host Auxora.",
            RepairActions = BuildDisplayRepairActions(companions, preferredAvailable, selectedModeMismatch),
            Displays = companions.Select(DisplayDiagnosticsItem.FromTarget).ToList()
        };
    }

    public static DisplayTarget ResolveCompanionDisplay(string? displayId)
    {
        return ResolveCompanionDisplay(EnumerateDisplays(), displayId);
    }

    public static DisplayTarget ValidateActiveCompanionDisplay(DisplayTarget requestedDisplay)
    {
        return ValidateActiveCompanionDisplay(EnumerateDisplays(), requestedDisplay);
    }

    public static DisplayTarget ValidateActiveCompanionDisplay(
        IEnumerable<DisplayTarget> activeDisplays,
        DisplayTarget requestedDisplay)
    {
        ArgumentNullException.ThrowIfNull(activeDisplays);
        ArgumentNullException.ThrowIfNull(requestedDisplay);

        if (requestedDisplay.IsPrimary)
        {
            throw new InvalidOperationException(
                "The Windows primary display cannot host Auxora. Choose an active companion display.");
        }

        return ResolveCompanionDisplay(activeDisplays, requestedDisplay.StableId);
    }

    public static DisplayTarget ResolveCompanionDisplay(
        IEnumerable<DisplayTarget> activeDisplays,
        string? displayId)
    {
        ArgumentNullException.ThrowIfNull(activeDisplays);

        if (string.IsNullOrWhiteSpace(displayId))
        {
            throw new InvalidOperationException("A companion display selection is required.");
        }

        var requestedId = displayId.Trim();
        var selected = activeDisplays.FirstOrDefault(display => display.IsPreferredDisplay(requestedId));
        if (selected is null)
        {
            throw new InvalidOperationException(
                "The selected display is not active. Refresh the display list and choose an active companion display.");
        }

        if (selected.IsPrimary)
        {
            throw new InvalidOperationException(
                "The Windows primary display cannot host Auxora. Choose an active companion display.");
        }

        return selected.WithPreference(requestedId);
    }

    public static DisplaySnapshot ReadPrimaryDisplaySnapshot()
    {
        var displays = new List<DisplaySnapshot>();
        EnumDisplayMonitors(
            IntPtr.Zero,
            IntPtr.Zero,
            (monitorHandle, _, _, _) =>
            {
                if (TryCreateDisplaySnapshot(monitorHandle, out var display))
                {
                    displays.Add(display);
                }

                return true;
            },
            IntPtr.Zero);

        return displays.FirstOrDefault(display => display.Primary)
            ?? displays.FirstOrDefault()
            ?? new DisplaySnapshot
            {
                Supported = false,
                Status = "unavailable",
                Name = "Primary display",
                Source = "Windows display mode",
                Message = "Windows did not report a primary display."
            };
    }

    private static List<DisplayTarget> EnumerateDisplays()
    {
        var displays = new List<DisplayTarget>();
        EnumDisplayMonitors(
            IntPtr.Zero,
            IntPtr.Zero,
            (monitorHandle, _, _, _) =>
            {
                if (TryCreateDisplayTarget(monitorHandle, out var display))
                {
                    displays.Add(display);
                }

                return true;
            },
            IntPtr.Zero);

        return displays;
    }

    private static bool TryCreateDisplaySnapshot(IntPtr monitorHandle, out DisplaySnapshot snapshot)
    {
        var monitorInfo = new MonitorInfoEx();
        monitorInfo.cbSize = Marshal.SizeOf<MonitorInfoEx>();

        if (!GetMonitorInfo(monitorHandle, ref monitorInfo))
        {
            snapshot = default!;
            return false;
        }

        var bounds = Rectangle.FromLTRB(
            monitorInfo.rcMonitor.Left,
            monitorInfo.rcMonitor.Top,
            monitorInfo.rcMonitor.Right,
            monitorInfo.rcMonitor.Bottom);
        var deviceName = monitorInfo.szDevice?.TrimEnd('\0') ?? string.Empty;
        var monitorDevice = ReadMonitorDevice(deviceName);
        var friendlyName = monitorDevice.FriendlyName;
        var mode = ReadDisplayMode(deviceName);
        var width = mode.Width > 0 ? mode.Width : bounds.Width;
        var height = mode.Height > 0 ? mode.Height : bounds.Height;
        var refreshRate = mode.RefreshRate > 1 ? Math.Round((double)mode.RefreshRate, 1) : (double?)null;

        snapshot = new DisplaySnapshot
        {
            Supported = true,
            Status = refreshRate.HasValue ? "live" : "partial",
            Name = string.IsNullOrWhiteSpace(friendlyName) ? "Primary display" : friendlyName,
            DeviceName = deviceName,
            Primary = (monitorInfo.dwFlags & MonitorInfoPrimaryFlag) != 0,
            Width = width,
            Height = height,
            RefreshRate = refreshRate,
            Fps = refreshRate,
            BitsPerPixel = mode.BitsPerPixel > 0 ? mode.BitsPerPixel : null,
            Source = "Windows display mode",
            SampledAt = DateTimeOffset.UtcNow,
            Message = refreshRate.HasValue
                ? "Primary display refresh rate is live."
                : "Windows did not report a display refresh rate."
        };
        return true;
    }

    private static bool TryCreateDisplayTarget(IntPtr monitorHandle, out DisplayTarget displayTarget)
    {
        var monitorInfo = new MonitorInfoEx();
        monitorInfo.cbSize = Marshal.SizeOf<MonitorInfoEx>();

        if (!GetMonitorInfo(monitorHandle, ref monitorInfo))
        {
            displayTarget = default!;
            return false;
        }

        var bounds = Rectangle.FromLTRB(
            monitorInfo.rcMonitor.Left,
            monitorInfo.rcMonitor.Top,
            monitorInfo.rcMonitor.Right,
            monitorInfo.rcMonitor.Bottom);

        var deviceName = monitorInfo.szDevice?.TrimEnd('\0') ?? string.Empty;
        var monitorDevice = ReadMonitorDevice(deviceName);
        var friendlyName = monitorDevice.FriendlyName;
        var containsXeneon = friendlyName.Contains("XENEON", StringComparison.OrdinalIgnoreCase)
            || friendlyName.Contains("EDGE", StringComparison.OrdinalIgnoreCase)
            || monitorDevice.DeviceId.Contains("CRXED00", StringComparison.OrdinalIgnoreCase);
        var mode = ReadDisplayMode(deviceName);
        var modeWidth = mode.Width > 0 ? mode.Width : bounds.Width;
        var modeHeight = mode.Height > 0 ? mode.Height : bounds.Height;
        var matchesEdgeResolution = IsEdgeResolution(bounds.Width, bounds.Height)
            || IsEdgeResolution(modeWidth, modeHeight);
        var matchesEdgeAspect = IsEdgeAspect(bounds.Width, bounds.Height)
            || IsEdgeAspect(modeWidth, modeHeight);
        var compactEdgePanel = matchesEdgeAspect
            && (Math.Min(bounds.Height, modeHeight) <= 900 || Math.Min(bounds.Width, modeWidth) <= 900);
        var isPrimary = (monitorInfo.dwFlags & MonitorInfoPrimaryFlag) != 0;

        var score = isPrimary ? 1000 : 2000;
        var reasons = new List<string>();
        if (containsXeneon)
        {
            reasons.Add("recognized display name");
        }

        if (matchesEdgeResolution)
        {
            reasons.Add("compact ultrawide resolution");
        }
        else if (compactEdgePanel)
        {
            reasons.Add("compact ultrawide shape");
        }
        else if (matchesEdgeAspect)
        {
            reasons.Add("ultrawide shape");
        }

        if (isPrimary)
        {
            reasons.Add("primary display");
        }
        else
        {
            reasons.Add("secondary display");
        }

        displayTarget = new DisplayTarget(
            Bounds: bounds,
            DeviceName: deviceName,
            DeviceId: monitorDevice.DeviceId,
            FriendlyName: friendlyName,
            ModeWidth: modeWidth,
            ModeHeight: modeHeight,
            RefreshRate: mode.RefreshRate > 1 ? mode.RefreshRate : null,
            IsPrimary: isPrimary,
            Score: score,
            BaseScore: score,
            ContainsXeneonName: containsXeneon,
            MatchesEdgeResolution: matchesEdgeResolution,
            MatchesEdgeAspect: matchesEdgeAspect,
            MatchReasons: reasons);
        return true;
    }

    private static bool IsEdgeResolution(int width, int height)
    {
        return Math.Abs(width - 2560) <= 80 && Math.Abs(height - 720) <= 80;
    }

    private static bool IsEdgeAspect(int width, int height)
    {
        if (width <= 0 || height <= 0)
        {
            return false;
        }

        var aspect = (double)Math.Max(width, height) / Math.Min(width, height);
        return aspect >= 3.35 && aspect <= 3.8;
    }

    private static MonitorDeviceDetails ReadMonitorDevice(string deviceName)
    {
        var monitorDevice = new DisplayDevice();
        monitorDevice.cb = Marshal.SizeOf<DisplayDevice>();

        if (EnumDisplayDevices(deviceName, 0, ref monitorDevice, 0) && !string.IsNullOrWhiteSpace(monitorDevice.DeviceString))
        {
            return new MonitorDeviceDetails(
                monitorDevice.DeviceString.Trim(),
                monitorDevice.DeviceId?.Trim() ?? "",
                monitorDevice.StateFlags);
        }

        return new MonitorDeviceDetails(deviceName, "", 0);
    }

    private static List<string> BuildDisplayRepairActions(
        IReadOnlyCollection<DisplayTarget> displays,
        bool preferredAvailable,
        bool selectedModeMismatch)
    {
        if (displays.Count == 0)
        {
            return
            [
                "Confirm the touch display is powered on and connected.",
                "Open Windows Display settings and choose Extend these displays.",
                "Restart Auxora after Windows exposes the display."
            ];
        }

        if (!preferredAvailable && displays.Count > 1)
        {
            return
            [
                "Choose the touch display you want Auxora to use.",
                "Confirm its orientation and Windows scaling before pinning it.",
                "Use Diagnostics to change the preferred display later."
            ];
        }

        if (selectedModeMismatch)
        {
            return
            [
                "Open Windows Settings > System > Display and select the XENEON EDGE.",
                "Set Display resolution to 2560 x 720 and refresh rate to 60 Hz.",
                "Auxora will re-anchor automatically after Windows applies the native mode."
            ];
        }

        return
        [
            "Auxora will use the saved display preference.",
            "Use Diagnostics to change the preferred display if Windows reorders monitors."
        ];
    }

    private static DisplayMode ReadDisplayMode(string deviceName)
    {
        var mode = new DevMode();
        mode.dmSize = (short)Marshal.SizeOf<DevMode>();

        if (!EnumDisplaySettings(deviceName, EnumCurrentSettings, ref mode))
        {
            return new DisplayMode(0, 0, 0, 0);
        }

        return new DisplayMode(
            mode.dmPelsWidth,
            mode.dmPelsHeight,
            mode.dmBitsPerPel,
            mode.dmDisplayFrequency);
    }

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool EnumDisplaySettings(
        string lpszDeviceName,
        int iModeNum,
        ref DevMode lpDevMode);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool EnumDisplayDevices(
        string lpDevice,
        uint iDevNum,
        ref DisplayDevice lpDisplayDevice,
        uint dwFlags);

    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool EnumDisplayMonitors(
        IntPtr hdc,
        IntPtr lprcClip,
        MonitorEnumProc lpfnEnum,
        IntPtr dwData);

    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetMonitorInfo(
        IntPtr hMonitor,
        ref MonitorInfoEx lpmi);

    private delegate bool MonitorEnumProc(
        IntPtr hMonitor,
        IntPtr hdcMonitor,
        IntPtr lprcMonitor,
        IntPtr dwData);

    private const int MonitorInfoPrimaryFlag = 0x00000001;

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct DisplayDevice
    {
        public int cb;

        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)]
        public string DeviceName;

        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)]
        public string DeviceString;

        public int StateFlags;

        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)]
        public string DeviceId;

        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)]
        public string DeviceKey;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct DevMode
    {
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)]
        public string dmDeviceName;

        public short dmSpecVersion;
        public short dmDriverVersion;
        public short dmSize;
        public short dmDriverExtra;
        public int dmFields;
        public int dmPositionX;
        public int dmPositionY;
        public int dmDisplayOrientation;
        public int dmDisplayFixedOutput;
        public short dmColor;
        public short dmDuplex;
        public short dmYResolution;
        public short dmTTOption;
        public short dmCollate;

        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)]
        public string dmFormName;

        public short dmLogPixels;
        public int dmBitsPerPel;
        public int dmPelsWidth;
        public int dmPelsHeight;
        public int dmDisplayFlags;
        public int dmDisplayFrequency;
        public int dmICMMethod;
        public int dmICMIntent;
        public int dmMediaType;
        public int dmDitherType;
        public int dmReserved1;
        public int dmReserved2;
        public int dmPanningWidth;
        public int dmPanningHeight;
    }

    private sealed record DisplayMode(int Width, int Height, int BitsPerPixel, int RefreshRate);

    private sealed record MonitorDeviceDetails(string FriendlyName, string DeviceId, int StateFlags);

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct MonitorInfoEx
    {
        public int cbSize;
        public Rect rcMonitor;
        public Rect rcWork;
        public int dwFlags;

        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)]
        public string szDevice;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct Rect
    {
        public int Left;
        public int Top;
        public int Right;
        public int Bottom;
    }
}

public sealed record DisplayTarget(
    Rectangle Bounds,
    string DeviceName,
    string DeviceId,
    string FriendlyName,
    int ModeWidth,
    int ModeHeight,
    double? RefreshRate,
    bool IsPrimary,
    int Score,
    int BaseScore,
    bool ContainsXeneonName,
    bool MatchesEdgeResolution,
    bool MatchesEdgeAspect,
    List<string> MatchReasons,
    bool IsPreferred = false)
{
    public bool RequiresNativeModeCorrection => ContainsXeneonName && !MatchesEdgeResolution;

    public string DisplayName => DeviceId.Contains("CRXED00", StringComparison.OrdinalIgnoreCase)
        && (string.IsNullOrWhiteSpace(FriendlyName)
            || FriendlyName.Contains("Generic PnP", StringComparison.OrdinalIgnoreCase))
            ? "XENEON EDGE"
            : FriendlyName;

    public string Label => string.IsNullOrWhiteSpace(DisplayName)
        ? $"{DeviceName} ({Bounds.Width}x{Bounds.Height})"
        : $"{DisplayName} ({Bounds.Width}x{Bounds.Height})";

    public string StableId => BuildStableDisplayId(DeviceName, DeviceId, FriendlyName, ModeWidth, ModeHeight);

    public DisplayTarget WithPreference(string? preferredDisplayId)
    {
        var preferred = IsPreferredDisplay(preferredDisplayId);
        return this with
        {
            IsPreferred = preferred,
            Score = preferred ? BaseScore + 120000 : BaseScore,
            MatchReasons = preferred
                ? MatchReasons.Concat(["saved display preference"]).Distinct(StringComparer.OrdinalIgnoreCase).ToList()
                : MatchReasons.ToList()
        };
    }

    public bool IsPreferredDisplay(string? preferredDisplayId)
    {
        if (string.IsNullOrWhiteSpace(preferredDisplayId))
        {
            return false;
        }

        var preferred = preferredDisplayId.Trim();
        return string.Equals(preferred, StableId, StringComparison.OrdinalIgnoreCase)
            || string.Equals(preferred, DeviceName, StringComparison.OrdinalIgnoreCase)
            || (!string.IsNullOrWhiteSpace(DeviceId) && string.Equals(preferred, DeviceId, StringComparison.OrdinalIgnoreCase));
    }

    private static string BuildStableDisplayId(string deviceName, string deviceId, string friendlyName, int width, int height)
    {
        var source = string.IsNullOrWhiteSpace(deviceId)
            ? $"{deviceName}|{friendlyName}|{width}x{height}"
            : deviceId;
        var normalized = source.Trim();
        return string.IsNullOrWhiteSpace(normalized)
            ? $"{width}x{height}"
            : normalized;
    }
}

public sealed class DisplayDiagnosticsSnapshot
{
    public bool Supported { get; set; }

    public string Status { get; set; } = "starting";

    public DateTimeOffset SampledAt { get; set; }

    public string PreferredDisplayId { get; set; } = "";

    public string SelectedDisplayId { get; set; } = "";

    public string SelectedDisplayName { get; set; } = "";

    public int ActiveDisplayCount { get; set; }

    public int CompanionDisplayCount { get; set; }

    public int EdgeCandidateCount { get; set; }

    public string Message { get; set; } = "";

    public List<string> RepairActions { get; set; } = [];

    public List<DisplayDiagnosticsItem> Displays { get; set; } = [];
}

public sealed class DisplayDiagnosticsItem
{
    public string Id { get; set; } = "";

    public string DeviceName { get; set; } = "";

    public string DeviceId { get; set; } = "";

    public string FriendlyName { get; set; } = "";

    public string Label { get; set; } = "";

    public bool Primary { get; set; }

    public bool Preferred { get; set; }

    public int Score { get; set; }

    public int BoundsX { get; set; }

    public int BoundsY { get; set; }

    public int BoundsWidth { get; set; }

    public int BoundsHeight { get; set; }

    public int ModeWidth { get; set; }

    public int ModeHeight { get; set; }

    public double? RefreshRate { get; set; }

    public bool ContainsXeneonName { get; set; }

    public bool MatchesEdgeResolution { get; set; }

    public bool MatchesEdgeAspect { get; set; }

    public bool RequiresNativeModeCorrection { get; set; }

    public List<string> Reasons { get; set; } = [];

    public static DisplayDiagnosticsItem FromTarget(DisplayTarget target)
    {
        return new DisplayDiagnosticsItem
        {
            Id = target.StableId,
            DeviceName = target.DeviceName,
            DeviceId = target.DeviceId,
            FriendlyName = target.DisplayName,
            Label = target.Label,
            Primary = target.IsPrimary,
            Preferred = target.IsPreferred,
            Score = target.Score,
            BoundsX = target.Bounds.X,
            BoundsY = target.Bounds.Y,
            BoundsWidth = target.Bounds.Width,
            BoundsHeight = target.Bounds.Height,
            ModeWidth = target.ModeWidth,
            ModeHeight = target.ModeHeight,
            RefreshRate = target.RefreshRate,
            ContainsXeneonName = target.ContainsXeneonName,
            MatchesEdgeResolution = target.MatchesEdgeResolution,
            MatchesEdgeAspect = target.MatchesEdgeAspect,
            RequiresNativeModeCorrection = target.RequiresNativeModeCorrection,
            Reasons = target.MatchReasons.ToList()
        };
    }
}
