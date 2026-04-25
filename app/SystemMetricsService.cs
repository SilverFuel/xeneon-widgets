using System.Diagnostics;
using System.Management;
using System.Runtime.InteropServices;

namespace XenonEdgeHost;

public sealed class SystemMetricsService : IDisposable
{
    private readonly HostLogger _logger;
    private readonly object _sync = new();
    private readonly Dictionary<int, ProcessSample> _processSamples = new();
    private readonly int _logicalCores = Math.Max(1, Environment.ProcessorCount);
    private System.Threading.Timer? _usageTimer;
    private System.Threading.Timer? _processTimer;
    private System.Threading.Timer? _temperatureTimer;
    private SystemSnapshot _snapshot = new();
    private ulong _lastIdleTime;
    private ulong _lastKernelTime;
    private ulong _lastUserTime;
    private DateTimeOffset _lastProcessSampleTime = DateTimeOffset.MinValue;
    private bool _started;

    public SystemMetricsService(HostLogger logger)
    {
        _logger = logger;
    }

    public void Start()
    {
        if (_started)
        {
            return;
        }

        _started = true;
        SampleUsage();
        SampleHardwareTemperatures();
        SampleProcesses();
        _usageTimer = new System.Threading.Timer(_ => SampleUsage(), null, TimeSpan.FromSeconds(2), TimeSpan.FromSeconds(2));
        _processTimer = new System.Threading.Timer(_ => SampleProcesses(), null, TimeSpan.FromSeconds(5), TimeSpan.FromSeconds(5));
        _temperatureTimer = new System.Threading.Timer(_ => SampleHardwareTemperatures(), null, TimeSpan.FromSeconds(15), TimeSpan.FromSeconds(15));
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
        _processTimer?.Dispose();
        _temperatureTimer?.Dispose();
    }

    private void SampleUsage()
    {
        try
        {
            var cpu = ReadCpuUsage();
            var memory = ReadMemoryUsage();
            var disk = TryReadDiskUsage();
            var gpu = TryReadGpuUsage();

            lock (_sync)
            {
                var sampledAt = DateTimeOffset.UtcNow;
                _snapshot.Cpu = Round(cpu);
                _snapshot.Ram = Round(memory);
                _snapshot.Disk = disk;
                _snapshot.Gpu = gpu;
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
    }

    private void SampleProcesses()
    {
        try
        {
            var now = DateTimeOffset.UtcNow;
            var elapsedMs = _lastProcessSampleTime == DateTimeOffset.MinValue
                ? 0
                : Math.Max(1, (now - _lastProcessSampleTime).TotalMilliseconds);

            var nextSamples = new Dictionary<int, ProcessSample>();
            var totalPhysicalMemory = GetTotalPhysicalMemory();
            var processes = Process.GetProcesses();
            var topProcesses = new List<ProcessEntry>();

            foreach (var process in processes)
            {
                try
                {
                    if (process.HasExited)
                    {
                        continue;
                    }

                    var totalProcessorTime = process.TotalProcessorTime;
                    var workingSet = process.WorkingSet64;
                    var previous = _processSamples.TryGetValue(process.Id, out var sample)
                        ? sample
                        : null;
                    var cpuDeltaMs = previous is null
                        ? 0
                        : Math.Max(0, (totalProcessorTime - previous.TotalProcessorTime).TotalMilliseconds);
                    var cpu = elapsedMs > 0
                        ? Math.Min(100, (cpuDeltaMs / elapsedMs / _logicalCores) * 100)
                        : 0;

                    nextSamples[process.Id] = new ProcessSample(totalProcessorTime);
                    topProcesses.Add(new ProcessEntry
                    {
                        Name = process.ProcessName,
                        Pid = process.Id,
                        Cpu = Round(cpu),
                        MemoryMB = (int)Math.Round(workingSet / 1024d / 1024d),
                        MemoryPercent = totalPhysicalMemory <= 0
                            ? 0
                            : Round((workingSet / (double)totalPhysicalMemory) * 100)
                    });
                }
                catch
                {
                }
                finally
                {
                    process.Dispose();
                }
            }

            var ordered = topProcesses
                .OrderByDescending(entry => entry.Cpu)
                .ThenByDescending(entry => entry.MemoryMB)
                .ThenBy(entry => entry.Name, StringComparer.OrdinalIgnoreCase)
                .Take(5)
                .ToList();

            lock (_sync)
            {
                _snapshot.TopProcesses = ordered;
                _snapshot.Source = "native host";
            }

            _processSamples.Clear();
            foreach (var pair in nextSamples)
            {
                _processSamples[pair.Key] = pair.Value;
            }

            _lastProcessSampleTime = now;
        }
        catch (Exception error)
        {
            _logger.Error("Failed to sample native process usage.", error);
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

    private static ulong GetTotalPhysicalMemory()
    {
        var memoryStatus = new MemoryStatusEx();
        return GlobalMemoryStatusEx(ref memoryStatus) ? memoryStatus.TotalPhys : 0;
    }

    private void SampleHardwareTemperatures()
    {
        try
        {
            var cpuTemp = TryReadHardwareTemperature("CPU Package", "Core Average", "Tctl", "Tdie", "cpu");
            var gpuTemp = TryReadHardwareTemperature("GPU Core", "GPU Temperature", "GPU Hot Spot", "gpu");

            lock (_sync)
            {
                _snapshot.CpuTemp = cpuTemp;
                _snapshot.GpuTemp = gpuTemp ?? _snapshot.GpuTemp;
                _snapshot.Message = BuildTelemetryMessage(_snapshot);
            }
        }
        catch (Exception error)
        {
            _logger.Warn($"Failed to sample hardware temperatures: {error.Message}");
        }
    }

    private static double? TryReadDiskUsage()
    {
        try
        {
            using var searcher = new ManagementObjectSearcher(
                @"root\cimv2",
                "SELECT PercentIdleTime FROM Win32_PerfFormattedData_PerfDisk_PhysicalDisk WHERE Name = '_Total'");

            foreach (ManagementObject item in searcher.Get())
            {
                if (item["PercentIdleTime"] is null)
                {
                    continue;
                }

                var idle = Convert.ToDouble(item["PercentIdleTime"]);
                return Round(100 - idle);
            }
        }
        catch
        {
        }

        return null;
    }

    private static double? TryReadGpuUsage()
    {
        try
        {
            using var searcher = new ManagementObjectSearcher(
                @"root\cimv2",
                "SELECT Name, UtilizationPercentage FROM Win32_PerfFormattedData_GPUPerformanceCounters_GPUEngine");

            var maximum = double.MinValue;
            foreach (ManagementObject item in searcher.Get())
            {
                var name = Convert.ToString(item["Name"]) ?? "";
                if (name.Contains("engtype_VideoDecode", StringComparison.OrdinalIgnoreCase)
                    || name.Contains("engtype_VideoEncode", StringComparison.OrdinalIgnoreCase)
                    || name.Contains("engtype_3D", StringComparison.OrdinalIgnoreCase)
                    || name.Contains("engtype_Copy", StringComparison.OrdinalIgnoreCase)
                    || name.Contains("engtype_Compute", StringComparison.OrdinalIgnoreCase))
                {
                    maximum = Math.Max(maximum, Convert.ToDouble(item["UtilizationPercentage"] ?? 0));
                }
            }

            return maximum == double.MinValue ? null : Round(maximum);
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
        parts.Add(snapshot.Disk.HasValue ? "Disk activity is live." : "Disk activity is unavailable on this PC.");

        if (snapshot.CpuTemp.HasValue || snapshot.GpuTemp.HasValue)
        {
            parts.Add("Hardware temperatures are live.");
        }
        else
        {
            parts.Add("Hardware temperatures require LibreHardwareMonitor or OpenHardwareMonitor.");
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

    private sealed record ProcessSample(TimeSpan TotalProcessorTime);
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

    public double? Disk { get; set; }

    public double? CpuTemp { get; set; }

    public double? GpuTemp { get; set; }

    public string Source { get; set; } = "native host";

    public List<ProcessEntry> TopProcesses { get; set; } = [];

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
            Disk = Disk,
            CpuTemp = CpuTemp,
            GpuTemp = GpuTemp,
            Source = Source,
            TopProcesses = TopProcesses.Select(entry => entry.Clone()).ToList()
        };
    }
}

public sealed class ProcessEntry
{
    public string Name { get; set; } = "Unknown";

    public int Pid { get; set; }

    public double Cpu { get; set; }

    public int MemoryMB { get; set; }

    public double MemoryPercent { get; set; }

    public ProcessEntry Clone()
    {
        return new ProcessEntry
        {
            Name = Name,
            Pid = Pid,
            Cpu = Cpu,
            MemoryMB = MemoryMB,
            MemoryPercent = MemoryPercent
        };
    }
}
