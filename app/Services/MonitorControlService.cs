using Microsoft.Win32.SafeHandles;
using System.Globalization;
using System.Text;
using Windows.Win32;
using Windows.Win32.Devices.Display;
using Windows.Win32.Foundation;
using Windows.Win32.Graphics.Gdi;

namespace XenonEdgeHost;

public sealed class MonitorControlService
{
    private const uint MaxPhysicalMonitorsPerLogicalDisplay = 16;
    private const uint MaxCapabilitiesLength = 64 * 1024;
    private readonly HostLogger _logger;

    public MonitorControlService(HostLogger logger)
    {
        _logger = logger;
    }

    public object GetSnapshot()
    {
        var monitors = WithPhysicalMonitors(ReadMonitor);
        var supported = monitors.Any(monitor => monitor.BrightnessSupported
            || monitor.ContrastSupported
            || monitor.InputSupported
            || monitor.PowerSupported);
        return new
        {
            supported,
            status = monitors.Count == 0 ? "unavailable" : supported ? "ready" : "unsupported",
            source = "Windows DDC/CI",
            displays = monitors,
            message = monitors.Count == 0
                ? "No DDC/CI monitor controls were exposed by Windows."
                : supported
                    ? "Supported monitor controls are ready."
                    : "Windows found the display, but it did not advertise supported DDC/CI controls."
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
            var code = control switch
            {
                "brightness" => (byte)0x10,
                "contrast" => (byte)0x12,
                "input" => (byte)0x60,
                "power" => (byte)0xD6,
                _ => throw new InvalidOperationException("Unknown monitor control.")
            };
            var capabilities = ReadCapabilities(target.Handle);
            var reading = ReadVcp(target.Handle, code, capabilities);
            if (!reading.Supported)
            {
                throw new InvalidOperationException($"This monitor does not expose the {control} control through DDC/CI.");
            }

            var value = control switch
            {
                "brightness" or "contrast" => ScalePercentage(request.Value, reading.Maximum),
                "input" => (uint)Math.Clamp(request.Value, 1, 31),
                "power" => request.Value == 0 ? 0x04u : 0x01u,
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
        var capabilities = ReadCapabilities(monitor.Handle);
        var brightness = ReadVcp(monitor.Handle, 0x10, capabilities);
        var contrast = ReadVcp(monitor.Handle, 0x12, capabilities);
        var input = ReadVcp(monitor.Handle, 0x60, capabilities);
        var power = ReadVcp(monitor.Handle, 0xD6, capabilities);
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
            PowerMode = power.Current,
            CapabilityDetection = capabilities is null ? "probed" : "advertised"
        };
    }

    private static VcpReading ReadVcp(SafePhysicalMonitorHandle handle, byte code, IReadOnlySet<byte>? capabilities)
    {
        if (capabilities is not null && !capabilities.Contains(code))
        {
            return new VcpReading(false, 0, 0, null);
        }

        return PInvoke.GetVCPFeatureAndVCPFeatureReply(handle, code, out _, out var current, out var maximum) != 0
            ? new VcpReading(true, current, maximum, maximum > 0 ? (int)Math.Round((double)current / maximum * 100) : (int)current)
            : new VcpReading(false, 0, 0, null);
    }

    internal static uint ScalePercentage(int percentage, uint maximum)
    {
        var normalized = Math.Clamp(percentage, 0, 100);
        return maximum == 0
            ? (uint)normalized
            : (uint)Math.Round(normalized / 100d * maximum, MidpointRounding.AwayFromZero);
    }

    private static unsafe HashSet<byte>? ReadCapabilities(SafePhysicalMonitorHandle handle)
    {
        if (PInvoke.GetCapabilitiesStringLength(handle, out var length) == 0
            || length < 2
            || length > MaxCapabilitiesLength)
        {
            return null;
        }

        var buffer = new byte[length];
        fixed (byte* pointer = buffer)
        {
            if (PInvoke.CapabilitiesRequestAndCapabilitiesReply(handle, pointer, length) == 0)
            {
                return null;
            }
        }

        var terminator = Array.IndexOf(buffer, (byte)0);
        var count = terminator >= 0 ? terminator : buffer.Length;
        return ParseVcpCapabilities(Encoding.ASCII.GetString(buffer, 0, count));
    }

    internal static HashSet<byte>? ParseVcpCapabilities(string capabilities)
    {
        var start = capabilities.IndexOf("vcp(", StringComparison.OrdinalIgnoreCase);
        if (start < 0)
        {
            return null;
        }

        var result = new HashSet<byte>();
        var token = new StringBuilder(2);
        var depth = 1;
        for (var index = start + 4; index < capabilities.Length; index++)
        {
            var character = capabilities[index];
            if (character == '(')
            {
                AddVcpToken(result, token);
                depth++;
                continue;
            }

            if (character == ')')
            {
                if (depth == 1)
                {
                    AddVcpToken(result, token);
                }

                depth--;
                if (depth == 0)
                {
                    return result;
                }

                continue;
            }

            if (depth == 1 && Uri.IsHexDigit(character))
            {
                token.Append(character);
            }
            else if (depth == 1)
            {
                AddVcpToken(result, token);
            }
        }

        return null;
    }

    private static void AddVcpToken(HashSet<byte> result, StringBuilder token)
    {
        if (token.Length == 2
            && byte.TryParse(token.ToString(), NumberStyles.HexNumber, CultureInfo.InvariantCulture, out var value))
        {
            result.Add(value);
        }

        token.Clear();
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

                if (count > MaxPhysicalMonitorsPerLogicalDisplay)
                {
                    _logger.Warn($"DDC/CI ignored an invalid physical monitor count of {count}.");
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
    public string CapabilityDetection { get; set; } = "probed";
}
