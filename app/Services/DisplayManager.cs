using System.Drawing;
using System.Runtime.InteropServices;

namespace XenonEdgeHost;

public static class DisplayManager
{
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
