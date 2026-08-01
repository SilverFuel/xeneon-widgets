using System.Management;
using System.Runtime.InteropServices;
using System.Threading;

namespace XenonEdgeHost;

public sealed class SystemMetricsService : IDisposable
{
    private readonly HostLogger _logger;
    private readonly HardwareTemperatureProvider _hardwareTemperatureProvider;
    private readonly object _sync = new();
    private System.Threading.Timer? _usageTimer;
    private System.Threading.Timer? _temperatureTimer;
    private SystemSnapshot _snapshot = new();
    private ulong _lastIdleTime;
    private ulong _lastKernelTime;
    private ulong _lastUserTime;
    private int _usageSampling;
    private int _temperatureSampling;
    private bool _started;

    public SystemMetricsService(HostLogger logger)
    {
        _logger = logger;
        _hardwareTemperatureProvider = new HardwareTemperatureProvider(logger);
    }

    public void Start()
    {
        if (_started)
        {
            return;
        }

        _started = true;
        // Hardware/WMI discovery can be slow on some PCs. Queue the first sample so
        // native HTTP startup and the companion-display UI never wait on telemetry.
        _usageTimer = new System.Threading.Timer(_ => SampleUsage(), null, TimeSpan.Zero, TimeSpan.FromSeconds(3));
        _temperatureTimer = new System.Threading.Timer(_ => SampleHardwareTemperatures(), null, TimeSpan.Zero, TimeSpan.FromSeconds(15));
        _logger.Info("Native system metrics service started.");
    }

    public SystemSnapshot GetSnapshot()
    {
        lock (_sync)
        {
            var snapshot = _snapshot.Clone();
            var sampledAt = snapshot.SampledAt;
            snapshot.Stale = !sampledAt.HasValue || DateTimeOffset.UtcNow - sampledAt.Value > TimeSpan.FromSeconds(10);
            if (!snapshot.Supported)
            {
                snapshot.Status = "unsupported";
            }
            else if (snapshot.Stale)
            {
                snapshot.Status = sampledAt.HasValue ? "stale" : "starting";
            }
            else if (string.IsNullOrWhiteSpace(snapshot.Status) || snapshot.Status == "starting")
            {
                snapshot.Status = "live";
            }
            return snapshot;
        }
    }

    public void Dispose()
    {
        _usageTimer?.Dispose();
        _temperatureTimer?.Dispose();
        _hardwareTemperatureProvider.Dispose();
    }

    private void SampleUsage()
    {
        if (Interlocked.Exchange(ref _usageSampling, 1) == 1)
        {
            return;
        }

        try
        {
            var cpu = ReadCpuUsage();
            var memory = ReadMemoryUsage();
            var gpu = TryReadGpuUsage();
            var primaryDisplay = DisplayManager.ReadPrimaryDisplaySnapshot();
            var sampledAt = DateTimeOffset.UtcNow;
            lock (_sync)
            {
                _snapshot.Cpu = Round(cpu);
                _snapshot.Ram = Round(memory);
                _snapshot.Gpu = gpu;
                _snapshot.PrimaryDisplay = primaryDisplay;
                _snapshot.Supported = true;
                _snapshot.Status = "live";
                _snapshot.SampledAt = sampledAt;
                _snapshot.Stale = false;
                _snapshot.Source = "native host";
                _snapshot.Message = BuildTelemetryMessage(_snapshot);
            }
        }
        catch (Exception error)
        {
            _logger.Error("Failed to sample native system usage.", error);
        }
        finally
        {
            Volatile.Write(ref _usageSampling, 0);
        }
    }

    private double ReadCpuUsage()
    {
        if (!GetSystemTimes(out var idleTime, out var kernelTime, out var userTime))
        {
            return 0;
        }

        var idle = idleTime.ToUInt64();
        var kernel = kernelTime.ToUInt64();
        var user = userTime.ToUInt64();

        if (_lastKernelTime == 0 && _lastUserTime == 0)
        {
            _lastIdleTime = idle;
            _lastKernelTime = kernel;
            _lastUserTime = user;
            return 0;
        }

        var idleDelta = idle - _lastIdleTime;
        var kernelDelta = kernel - _lastKernelTime;
        var userDelta = user - _lastUserTime;
        var total = kernelDelta + userDelta;

        _lastIdleTime = idle;
        _lastKernelTime = kernel;
        _lastUserTime = user;

        if (total == 0)
        {
            return _snapshot.Cpu ?? 0;
        }

        return ((total - idleDelta) * 100d) / total;
    }

    private static double ReadMemoryUsage()
    {
        var memoryStatus = new MemoryStatusEx();
        if (!GlobalMemoryStatusEx(ref memoryStatus) || memoryStatus.TotalPhys == 0)
        {
            return 0;
        }

        return ((memoryStatus.TotalPhys - memoryStatus.AvailPhys) * 100d) / memoryStatus.TotalPhys;
    }

    private void SampleHardwareTemperatures()
    {
        if (Interlocked.Exchange(ref _temperatureSampling, 1) == 1)
        {
            return;
        }

        try
        {
            var embedded = _hardwareTemperatureProvider.Read();
            var wmiCpu = embedded.Cpu.HasValue
                ? null
                : TryReadHardwareTemperature("CPU Package", "Core Average", "Tctl", "Tdie", "cpu");
            var wmiGpu = embedded.Gpu.HasValue
                ? null
                : TryReadHardwareTemperature("GPU Core", "GPU Temperature", "GPU Hot Spot", "gpu");
            var cpuTemp = embedded.Cpu ?? wmiCpu;
            var gpuTemp = embedded.Gpu ?? wmiGpu;
            var embeddedUsed = embedded.Cpu.HasValue || embedded.Gpu.HasValue;
            var wmiUsed = wmiCpu.HasValue || wmiGpu.HasValue;
            var source = embeddedUsed && wmiUsed
                ? $"{embedded.Source} + WMI fallback"
                : embeddedUsed
                    ? embedded.Source
                    : wmiUsed
                        ? "hardware monitor WMI"
                        : "unavailable";

            lock (_sync)
            {
                _snapshot.CpuTemp = cpuTemp;
                _snapshot.GpuTemp = gpuTemp;
                _snapshot.TemperatureSource = source;
                _snapshot.Message = BuildTelemetryMessage(_snapshot);
            }
        }
        catch (Exception error)
        {
            _logger.Warn($"Failed to sample hardware temperatures: {error.Message}");
        }
        finally
        {
            Volatile.Write(ref _temperatureSampling, 0);
        }
    }

    private static double? TryReadGpuUsage()
    {
        try
        {
            using var searcher = new ManagementObjectSearcher(
                @"root\cimv2",
                "SELECT Name, UtilizationPercentage FROM Win32_PerfFormattedData_GPUPerformanceCounters_GPUEngine");

            var graphicsMaximum = double.MinValue;
            var fallbackMaximum = double.MinValue;
            foreach (ManagementObject item in searcher.Get())
            {
                var name = Convert.ToString(item["Name"]) ?? "";
                var utilization = Convert.ToDouble(item["UtilizationPercentage"] ?? 0);
                if (name.Contains("engtype_3D", StringComparison.OrdinalIgnoreCase)
                    || name.Contains("engtype_Graphics", StringComparison.OrdinalIgnoreCase))
                {
                    graphicsMaximum = Math.Max(graphicsMaximum, utilization);
                    continue;
                }

                if (name.Contains("engtype_Compute", StringComparison.OrdinalIgnoreCase)
                    || name.Contains("engtype_Copy", StringComparison.OrdinalIgnoreCase))
                {
                    fallbackMaximum = Math.Max(fallbackMaximum, utilization);
                }
            }

            if (graphicsMaximum != double.MinValue)
            {
                return Round(graphicsMaximum);
            }

            return fallbackMaximum == double.MinValue ? null : Round(fallbackMaximum);
        }
        catch
        {
        }

        return null;
    }

    private static double? TryReadHardwareTemperature(params string[] patterns)
    {
        return TryReadHardwareTemperatureFromNamespace(@"root\LibreHardwareMonitor", patterns)
               ?? TryReadHardwareTemperatureFromNamespace(@"root\OpenHardwareMonitor", patterns);
    }

    private static double? TryReadHardwareTemperatureFromNamespace(string namespacePath, IReadOnlyList<string> patterns)
    {
        try
        {
            using var searcher = new ManagementObjectSearcher(
                namespacePath,
                "SELECT Name, Identifier, Parent, Value, SensorType FROM Sensor WHERE SensorType = 'Temperature'");

            double? bestValue = null;
            foreach (ManagementObject sensor in searcher.Get())
            {
                var combined = string.Join(" ",
                    Convert.ToString(sensor["Name"]) ?? "",
                    Convert.ToString(sensor["Identifier"]) ?? "",
                    Convert.ToString(sensor["Parent"]) ?? "");

                if (!patterns.Any(pattern => combined.Contains(pattern, StringComparison.OrdinalIgnoreCase)))
                {
                    continue;
                }

                if (sensor["Value"] is null)
                {
                    continue;
                }

                var value = Convert.ToDouble(sensor["Value"]);
                if (value <= 0 || value > 130)
                {
                    continue;
                }

                bestValue = bestValue.HasValue ? Math.Max(bestValue.Value, value) : value;
            }

            return bestValue.HasValue ? Round(bestValue.Value) : null;
        }
        catch
        {
            return null;
        }
    }

    private static string BuildTelemetryMessage(SystemSnapshot snapshot)
    {
        var parts = new List<string>
        {
            "CPU and memory are native."
        };

        parts.Add(snapshot.Gpu.HasValue ? "GPU telemetry is live." : "GPU telemetry is unavailable on this PC.");
        parts.Add(snapshot.PrimaryDisplay?.RefreshRate is not null
            ? "Primary display refresh rate is live."
            : "Primary display refresh rate is unavailable on this PC.");

        if (snapshot.CpuTemp.HasValue || snapshot.GpuTemp.HasValue)
        {
            parts.Add("Hardware temperatures are live.");
        }
        else
        {
            parts.Add("Hardware temperatures are unavailable on this PC.");
        }

        return string.Join(" ", parts);
    }

    private static double Round(double value)
    {
        return Math.Round(Math.Clamp(value, 0, 100), 1);
    }

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool GetSystemTimes(out FileTime idleTime, out FileTime kernelTime, out FileTime userTime);

    [DllImport("kernel32.dll", CharSet = CharSet.Auto, SetLastError = true)]
    private static extern bool GlobalMemoryStatusEx(ref MemoryStatusEx buffer);

    [StructLayout(LayoutKind.Sequential)]
    private struct FileTime
    {
        public uint LowDateTime;
        public uint HighDateTime;

        public ulong ToUInt64()
        {
            return ((ulong)HighDateTime << 32) | LowDateTime;
        }
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Auto)]
    private struct MemoryStatusEx
    {
        public uint Length;
        public uint MemoryLoad;
        public ulong TotalPhys;
        public ulong AvailPhys;
        public ulong TotalPageFile;
        public ulong AvailPageFile;
        public ulong TotalVirtual;
        public ulong AvailVirtual;
        public ulong AvailExtendedVirtual;

        public MemoryStatusEx()
        {
            Length = (uint)Marshal.SizeOf<MemoryStatusEx>();
        }
    }
}

public sealed class SystemSnapshot
{
    public bool Supported { get; set; } = true;

    public string Status { get; set; } = "starting";

    public DateTimeOffset? SampledAt { get; set; }

    public bool Stale { get; set; }

    public string Message { get; set; } = "";

    public double? Cpu { get; set; }

    public double? Gpu { get; set; }

    public double? Ram { get; set; }

    public double? CpuTemp { get; set; }

    public double? GpuTemp { get; set; }

    public string TemperatureSource { get; set; } = "unavailable";

    public string Source { get; set; } = "native host";

    public DisplaySnapshot? PrimaryDisplay { get; set; }

    public SystemSnapshot Clone()
    {
        return new SystemSnapshot
        {
            Supported = Supported,
            Status = Status,
            SampledAt = SampledAt,
            Stale = Stale,
            Message = Message,
            Cpu = Cpu,
            Gpu = Gpu,
            Ram = Ram,
            CpuTemp = CpuTemp,
            GpuTemp = GpuTemp,
            TemperatureSource = TemperatureSource,
            Source = Source,
            PrimaryDisplay = PrimaryDisplay?.Clone()
        };
    }
}

public sealed class DisplaySnapshot
{
    public bool Supported { get; set; } = true;

    public string Status { get; set; } = "starting";

    public string Name { get; set; } = "Primary display";

    public string DeviceName { get; set; } = "";

    public bool Primary { get; set; } = true;

    public int? Width { get; set; }

    public int? Height { get; set; }

    public double? RefreshRate { get; set; }

    public double? Fps { get; set; }

    public int? BitsPerPixel { get; set; }

    public string Source { get; set; } = "Windows display mode";

    public DateTimeOffset? SampledAt { get; set; }

    public string Message { get; set; } = "";

    public DisplaySnapshot Clone()
    {
        return new DisplaySnapshot
        {
            Supported = Supported,
            Status = Status,
            Name = Name,
            DeviceName = DeviceName,
            Primary = Primary,
            Width = Width,
            Height = Height,
            RefreshRate = RefreshRate,
            Fps = Fps,
            BitsPerPixel = BitsPerPixel,
            Source = Source,
            SampledAt = SampledAt,
            Message = Message
        };
    }
}
