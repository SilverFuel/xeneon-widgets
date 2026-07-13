using System.Runtime.InteropServices;

namespace XenonEdgeHost;

public sealed class MonitorControlService
{
    private readonly HostLogger _logger;

    public MonitorControlService(HostLogger logger)
    {
        _logger = logger;
    }

    public object GetSnapshot()
    {
        var monitors = WithPhysicalMonitors(ReadMonitor);
        return new
        {
            supported = monitors.Any(monitor => monitor.BrightnessSupported || monitor.ContrastSupported),
            status = monitors.Count == 0 ? "unavailable" : "ready",
            source = "Windows DDC/CI",
            displays = monitors,
            message = monitors.Count == 0
                ? "No DDC/CI monitor controls were exposed by Windows."
                : "Supported monitor controls are ready."
        };
    }

    public object Set(MonitorControlRequest request)
    {
        var control = request.Control?.Trim().ToLowerInvariant() ?? "";
        var physical = EnumeratePhysicalMonitors();
        try
        {
            if (request.DisplayIndex < 0 || request.DisplayIndex >= physical.Count)
            {
                throw new InvalidOperationException("Monitor control target was not found.");
            }

            var target = physical[request.DisplayIndex];
            var (code, value) = control switch
            {
                "brightness" => ((byte)0x10, (uint)Math.Clamp(request.Value, 0, 100)),
                "contrast" => ((byte)0x12, (uint)Math.Clamp(request.Value, 0, 100)),
                "input" => ((byte)0x60, (uint)Math.Clamp(request.Value, 1, 31)),
                "power" => ((byte)0xD6, request.Value == 0 ? 0x04u : 0x01u),
                _ => throw new InvalidOperationException("Unknown monitor control.")
            };

            if (!SetVCPFeature(target.Handle, code, value))
            {
                throw new InvalidOperationException($"This monitor did not accept the {control} command.");
            }
            _logger.Info($"DDC/CI {control} updated for monitor {request.DisplayIndex}.");
        }
        finally
        {
            Destroy(physical);
        }

        return GetSnapshot();
    }

    private static MonitorControlSnapshot ReadMonitor(PhysicalMonitorHandle monitor, int index)
    {
        var brightness = ReadVcp(monitor.Handle, 0x10);
        var contrast = ReadVcp(monitor.Handle, 0x12);
        var input = ReadVcp(monitor.Handle, 0x60);
        var power = ReadVcp(monitor.Handle, 0xD6);
        return new MonitorControlSnapshot
        {
            Index = index,
            Name = string.IsNullOrWhiteSpace(monitor.Description) ? $"Display {index + 1}" : monitor.Description,
            BrightnessSupported = brightness.Supported,
            Brightness = brightness.Percent,
            ContrastSupported = contrast.Supported,
            Contrast = contrast.Percent,
            InputSupported = input.Supported,
            InputSource = input.Current,
            PowerSupported = power.Supported,
            PowerMode = power.Current
        };
    }

    private static VcpReading ReadVcp(IntPtr handle, byte code)
    {
        return GetVCPFeatureAndVCPFeatureReply(handle, code, IntPtr.Zero, out var current, out var maximum)
            ? new VcpReading(true, current, maximum, maximum > 0 ? (int)Math.Round((double)current / maximum * 100) : (int)current)
            : new VcpReading(false, 0, 0, null);
    }

    private static List<T> WithPhysicalMonitors<T>(Func<PhysicalMonitorHandle, int, T> reader)
    {
        var handles = EnumeratePhysicalMonitors();
        try
        {
            return handles.Select(reader).ToList();
        }
        finally
        {
            Destroy(handles);
        }
    }

    private static List<PhysicalMonitorHandle> EnumeratePhysicalMonitors()
    {
        var handles = new List<PhysicalMonitorHandle>();
        EnumDisplayMonitors(IntPtr.Zero, IntPtr.Zero, (monitor, _, _, _) =>
        {
            if (!GetNumberOfPhysicalMonitorsFromHMONITOR(monitor, out var count) || count == 0)
            {
                return true;
            }
            var native = new PhysicalMonitor[count];
            if (GetPhysicalMonitorsFromHMONITOR(monitor, count, native))
            {
                handles.AddRange(native.Select(item => new PhysicalMonitorHandle(item.Handle, item.Description ?? "")));
            }
            return true;
        }, IntPtr.Zero);
        return handles;
    }

    private static void Destroy(IReadOnlyCollection<PhysicalMonitorHandle> monitors)
    {
        foreach (var monitor in monitors)
        {
            DestroyPhysicalMonitor(monitor.Handle);
        }
    }

    private delegate bool MonitorEnumProc(IntPtr monitor, IntPtr hdc, IntPtr rect, IntPtr data);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool EnumDisplayMonitors(IntPtr hdc, IntPtr clip, MonitorEnumProc callback, IntPtr data);

    [DllImport("dxva2.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetNumberOfPhysicalMonitorsFromHMONITOR(IntPtr monitor, out uint count);

    [DllImport("dxva2.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetPhysicalMonitorsFromHMONITOR(IntPtr monitor, uint count, [Out] PhysicalMonitor[] monitors);

    [DllImport("dxva2.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool DestroyPhysicalMonitor(IntPtr monitor);

    [DllImport("dxva2.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetVCPFeatureAndVCPFeatureReply(IntPtr monitor, byte code, IntPtr type, out uint current, out uint maximum);

    [DllImport("dxva2.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool SetVCPFeature(IntPtr monitor, byte code, uint value);

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct PhysicalMonitor
    {
        public IntPtr Handle;

        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)]
        public string? Description;
    }

    private sealed record PhysicalMonitorHandle(IntPtr Handle, string Description);

    private sealed record VcpReading(bool Supported, uint Current, uint Maximum, int? Percent);
}

public sealed class MonitorControlSnapshot
{
    public int Index { get; set; }
    public string Name { get; set; } = "";
    public bool BrightnessSupported { get; set; }
    public int? Brightness { get; set; }
    public bool ContrastSupported { get; set; }
    public int? Contrast { get; set; }
    public bool InputSupported { get; set; }
    public uint InputSource { get; set; }
    public bool PowerSupported { get; set; }
    public uint PowerMode { get; set; }
}
