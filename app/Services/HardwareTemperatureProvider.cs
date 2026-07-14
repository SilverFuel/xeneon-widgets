using LibreHardwareMonitor.Hardware;

namespace XenonEdgeHost;

internal sealed class HardwareTemperatureProvider : IDisposable
{
    private readonly HostLogger _logger;
    private readonly Func<Computer> _computerFactory;
    private readonly Action<Computer> _computerUpdater;
    private readonly object _sync = new();
    private Computer? _computer;
    private bool _unavailable;
    private bool _disposed;

    public HardwareTemperatureProvider(HostLogger logger)
        : this(logger, CreateComputer)
    {
    }

    internal HardwareTemperatureProvider(HostLogger logger, Func<Computer> computerFactory)
        : this(logger, computerFactory, computer => computer.Accept(UpdateVisitor.Instance))
    {
    }

    internal HardwareTemperatureProvider(HostLogger logger, Func<Computer> computerFactory, Action<Computer> computerUpdater)
    {
        _logger = logger;
        _computerFactory = computerFactory;
        _computerUpdater = computerUpdater;
    }

    public HardwareTemperatureSnapshot Read()
    {
        lock (_sync)
        {
            if (_disposed || _unavailable)
            {
                return HardwareTemperatureSnapshot.Empty;
            }

            try
            {
                EnsureOpen();
            }
            catch (Exception error)
            {
                _unavailable = true;
                CloseComputer();
                _logger.Warn($"Embedded hardware temperature provider is unavailable ({error.GetType().Name}).");
                return HardwareTemperatureSnapshot.Empty;
            }

            try
            {
                var computer = _computer!;
                _computerUpdater(computer);

                var cpu = new List<TemperatureCandidate>();
                var gpu = new List<TemperatureCandidate>();
                foreach (var hardware in EnumerateHardware(computer.Hardware))
                {
                    var target = hardware.HardwareType switch
                    {
                        HardwareType.Cpu => cpu,
                        HardwareType.GpuAmd or HardwareType.GpuIntel or HardwareType.GpuNvidia => gpu,
                        _ => null
                    };
                    if (target is null)
                    {
                        continue;
                    }

                    foreach (var sensor in hardware.Sensors)
                    {
                        if (sensor.SensorType == SensorType.Temperature && sensor.Value is float value)
                        {
                            target.Add(new TemperatureCandidate(sensor.Name, value));
                        }
                    }
                }

                return new HardwareTemperatureSnapshot(
                    SelectPreferredTemperature(cpu, "CPU Package", "Core Average", "Tctl", "Tdie"),
                    SelectPreferredTemperature(gpu, "GPU Core", "GPU Temperature", "GPU Hot Spot"),
                    "LibreHardwareMonitor embedded");
            }
            catch (Exception error)
            {
                CloseComputer();
                _logger.Warn($"Embedded hardware temperature read failed and will retry ({error.GetType().Name}).");
                return HardwareTemperatureSnapshot.Empty;
            }
        }
    }

    public void Dispose()
    {
        lock (_sync)
        {
            if (_disposed)
            {
                return;
            }

            _disposed = true;
            CloseComputer();
        }
    }

    internal static double? SelectPreferredTemperature(
        IEnumerable<TemperatureCandidate> candidates,
        params string[] preferredNames)
    {
        var valid = candidates
            .Where(candidate => candidate.Value > 0 && candidate.Value <= 130)
            .ToList();
        if (valid.Count == 0)
        {
            return null;
        }

        foreach (var preferredName in preferredNames)
        {
            var preferred = valid
                .Where(candidate => candidate.Name.Contains(preferredName, StringComparison.OrdinalIgnoreCase))
                .Select(candidate => candidate.Value)
                .DefaultIfEmpty(double.MinValue)
                .Max();
            if (preferred != double.MinValue)
            {
                return Math.Round(preferred, 1);
            }
        }

        return Math.Round(valid.Max(candidate => candidate.Value), 1);
    }

    private void EnsureOpen()
    {
        if (_computer is not null)
        {
            return;
        }

        _computer = _computerFactory();
        _computer.Open();
    }

    private static Computer CreateComputer()
    {
        return new Computer
        {
            IsCpuEnabled = true,
            IsGpuEnabled = true
        };
    }

    private void CloseComputer()
    {
        if (_computer is null)
        {
            return;
        }

        try
        {
            _computer.Close();
        }
        catch
        {
        }
        finally
        {
            _computer = null;
        }
    }

    private static IEnumerable<IHardware> EnumerateHardware(IEnumerable<IHardware> hardware)
    {
        foreach (var item in hardware)
        {
            yield return item;
            foreach (var child in EnumerateHardware(item.SubHardware))
            {
                yield return child;
            }
        }
    }

    private sealed class UpdateVisitor : IVisitor
    {
        public static UpdateVisitor Instance { get; } = new();

        public void VisitComputer(IComputer computer) => computer.Traverse(this);

        public void VisitHardware(IHardware hardware)
        {
            hardware.Update();
            foreach (var child in hardware.SubHardware)
            {
                child.Accept(this);
            }
        }

        public void VisitSensor(ISensor sensor)
        {
        }

        public void VisitParameter(IParameter parameter)
        {
        }
    }
}

internal sealed record TemperatureCandidate(string Name, double Value);

internal sealed record HardwareTemperatureSnapshot(double? Cpu, double? Gpu, string Source)
{
    public static HardwareTemperatureSnapshot Empty { get; } = new(null, null, "unavailable");
}
