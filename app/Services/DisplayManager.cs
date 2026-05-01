using System.Drawing;
using System.Runtime.InteropServices;

namespace XenonEdgeHost;

public static class DisplayManager
{
    private const int EnumCurrentSettings = -1;

    public static DisplayTarget FindBestDisplay()
    {
        var displays = EnumerateDisplays()
            .OrderByDescending(display => display.Score)
            .ToList();

        if (displays.Count == 0)
        {
            throw new InvalidOperationException("No displays were detected.");
        }

        return displays[0];
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
        var friendlyName = GetFriendlyName(deviceName);
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
                ? "Primary display FPS is the current Windows refresh rate."
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
        var friendlyName = GetFriendlyName(deviceName);
        var containsXeneon = friendlyName.Contains("XENEON", StringComparison.OrdinalIgnoreCase)
            || friendlyName.Contains("EDGE", StringComparison.OrdinalIgnoreCase);
        var isWideEdgeResolution = bounds.Width == 2560 && bounds.Height == 720;
        var isPrimary = (monitorInfo.dwFlags & MonitorInfoPrimaryFlag) != 0;

        var score = 0;
        if (isWideEdgeResolution)
        {
            score += 10000;
        }

        if (containsXeneon)
        {
            score += 5000;
        }

        if (!isPrimary)
        {
            score += 50;
        }

        score += bounds.Width;

        displayTarget = new DisplayTarget(
            Bounds: bounds,
            DeviceName: deviceName,
            FriendlyName: friendlyName,
            IsPrimary: isPrimary,
            Score: score);
        return true;
    }

    private static string GetFriendlyName(string deviceName)
    {
        var monitorDevice = new DisplayDevice();
        monitorDevice.cb = Marshal.SizeOf<DisplayDevice>();

        if (EnumDisplayDevices(deviceName, 0, ref monitorDevice, 0) && !string.IsNullOrWhiteSpace(monitorDevice.DeviceString))
        {
            return monitorDevice.DeviceString.Trim();
        }

        return deviceName;
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
    string FriendlyName,
    bool IsPrimary,
    int Score)
{
    public string Label => string.IsNullOrWhiteSpace(FriendlyName)
        ? $"{DeviceName} ({Bounds.Width}x{Bounds.Height})"
        : $"{FriendlyName} ({Bounds.Width}x{Bounds.Height})";
}
