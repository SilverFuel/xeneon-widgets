using Microsoft.Win32.SafeHandles;
using Windows.Win32;
using Windows.Win32.Devices.Display;
using Windows.Win32.Foundation;
using Windows.Win32.Graphics.Gdi;

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

            if (PInvoke.SetVCPFeature(target.Handle, code, value) == 0)
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

    private static VcpReading ReadVcp(SafePhysicalMonitorHandle handle, byte code)
    {
        return PInvoke.GetVCPFeatureAndVCPFeatureReply(handle, code, out _, out var current, out var maximum) != 0
            ? new VcpReading(true, current, maximum, maximum > 0 ? (int)Math.Round((double)current / maximum * 100) : (int)current)
            : new VcpReading(false, 0, 0, null);
    }

    private List<T> WithPhysicalMonitors<T>(Func<PhysicalMonitorHandle, int, T> reader)
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

    private unsafe List<PhysicalMonitorHandle> EnumeratePhysicalMonitors()
    {
        var handles = new List<PhysicalMonitorHandle>();
        PInvoke.EnumDisplayMonitors(default, (RECT?)null, (monitor, _, _, _) =>
        {
            try
            {
                if (!PInvoke.GetNumberOfPhysicalMonitorsFromHMONITOR(monitor, out var count) || count == 0)
                {
                    return true;
                }

                var native = new PHYSICAL_MONITOR[count];
                if (PInvoke.GetPhysicalMonitorsFromHMONITOR(monitor, native))
                {
                    handles.AddRange(native.Select(item => new PhysicalMonitorHandle(
                        new SafePhysicalMonitorHandle((IntPtr)item.hPhysicalMonitor),
                        item.szPhysicalMonitorDescription.AsSpan().TrimEnd('\0').ToString())));
                }
            }
            catch (Exception error)
            {
                _logger.Warn($"DDC/CI monitor enumeration skipped a display: {error.Message}");
            }

            return true;
        }, default);
        return handles;
    }

    private static void Destroy(IReadOnlyCollection<PhysicalMonitorHandle> monitors)
    {
        foreach (var monitor in monitors)
        {
            monitor.Handle.Dispose();
        }
    }

    private sealed class SafePhysicalMonitorHandle : SafeHandleZeroOrMinusOneIsInvalid
    {
        public SafePhysicalMonitorHandle(IntPtr handle)
            : base(ownsHandle: true)
        {
            SetHandle(handle);
        }

        protected override bool ReleaseHandle()
        {
            return PInvoke.DestroyPhysicalMonitor((HANDLE)handle);
        }
    }

    private sealed record PhysicalMonitorHandle(SafePhysicalMonitorHandle Handle, string Description);

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
