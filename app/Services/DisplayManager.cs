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
            throw new InvalidOperationException("No displays were detected.");
        }

        return displays[0];
    }

    public static List<DisplayTarget> ListDisplays(string? preferredDisplayId = null)
    {
        return EnumerateDisplays()
            .Select(display => display.WithPreference(preferredDisplayId))
            .OrderByDescending(display => display.Score)
            .ThenBy(display => display.IsPrimary)
            .ToList();
    }

    public static DisplayDiagnosticsSnapshot BuildDiagnostics(string? preferredDisplayId = null)
    {
        var displays = ListDisplays(preferredDisplayId);
        var selected = displays.FirstOrDefault();
        var edgeCandidates = displays.Count(display => display.MatchesEdgeResolution || display.MatchesEdgeAspect || display.ContainsXeneonName);

        return new DisplayDiagnosticsSnapshot
        {
            Supported = true,
            Status = displays.Count == 0 ? "missing" : edgeCandidates > 0 ? "ready" : "fallback",
            SampledAt = DateTimeOffset.UtcNow,
            PreferredDisplayId = preferredDisplayId?.Trim() ?? "",
            SelectedDisplayId = selected?.StableId ?? "",
            SelectedDisplayName = selected?.Label ?? "",
            EdgeCandidateCount = edgeCandidates,
            Message = displays.Count == 0
                ? "Windows did not expose any active displays."
                : edgeCandidates > 0
                    ? "Xenon found an EDGE-shaped display candidate and will prefer it."
                    : "Windows currently exposes only fallback display candidates. Check Windows display settings if the EDGE is powered on.",
            RepairActions = BuildDisplayRepairActions(displays, edgeCandidates),
            Displays = displays.Select(DisplayDiagnosticsItem.FromTarget).ToList()
        };
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
            || friendlyName.Contains("EDGE", StringComparison.OrdinalIgnoreCase);
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

        var score = 0;
        var reasons = new List<string>();
        if (containsXeneon)
        {
            score += 90000;
            reasons.Add("name contains XENEON/EDGE");
        }

        if (matchesEdgeResolution)
        {
            score += 80000;
            reasons.Add("matches 2560x720 EDGE resolution");
        }
        else if (compactEdgePanel)
        {
            score += 60000;
            reasons.Add("matches compact ultrawide panel shape");
        }
        else if (matchesEdgeAspect)
        {
            score += 15000;
            reasons.Add("matches EDGE aspect ratio");
        }

        score += Math.Max(0, 4000 - Math.Abs(modeWidth - 2560));
        score += Math.Max(0, 2000 - (Math.Abs(modeHeight - 720) * 2));
        score += Math.Max(0, 2000 - Math.Abs(bounds.Width - 2560));
        score += Math.Max(0, 1000 - (Math.Abs(bounds.Height - 720) * 2));

        if (isPrimary)
        {
            score -= 5000;
            reasons.Add("primary display penalty");
        }
        else
        {
            score += 5000;
            reasons.Add("non-primary display bonus");
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

    private static List<string> BuildDisplayRepairActions(IReadOnlyCollection<DisplayTarget> displays, int edgeCandidates)
    {
        if (displays.Count == 0)
        {
            return
            [
                "Confirm the XENEON EDGE is powered on and connected.",
                "Open Windows Display settings and choose Extend these displays.",
                "Restart XENEON Edge Host after Windows exposes the display."
            ];
        }

        if (edgeCandidates == 0)
        {
            return
            [
                "Windows is not exposing a 2560x720 or XENEON-named display right now.",
                "Open Windows Display settings and detect/extend the XENEON EDGE.",
                "Use Diagnostics to re-check displays after Windows sees it."
            ];
        }

        return
        [
            "Xenon will prefer the highest-scoring EDGE candidate automatically.",
            "Pin the current display from Diagnostics if Windows reorders monitors."
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
    public string Label => string.IsNullOrWhiteSpace(FriendlyName)
        ? $"{DeviceName} ({Bounds.Width}x{Bounds.Height})"
        : $"{FriendlyName} ({Bounds.Width}x{Bounds.Height})";

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

    public List<string> Reasons { get; set; } = [];

    public static DisplayDiagnosticsItem FromTarget(DisplayTarget target)
    {
        return new DisplayDiagnosticsItem
        {
            Id = target.StableId,
            DeviceName = target.DeviceName,
            DeviceId = target.DeviceId,
            FriendlyName = target.FriendlyName,
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
            Reasons = target.MatchReasons.ToList()
        };
    }
}
