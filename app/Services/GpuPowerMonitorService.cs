using System.Globalization;
using System.Management;
using System.Text;
using System.Text.RegularExpressions;

namespace XenonEdgeHost;

public sealed class GpuPowerMonitorService : IDisposable
{
    private static readonly Regex Rtx50SeriesPattern = new(@"\bRTX\s*50\d{2}\b|\bRTX\s*50\s*Series\b", RegexOptions.IgnoreCase | RegexOptions.Compiled);
    private static readonly Regex UnitPattern = new(@"\[(?<unit>[^\]]+)\]\s*$|\((?<unit>[^)]+)\)\s*$", RegexOptions.Compiled);
    private static readonly Regex UnsafeIdPattern = new(@"[^a-z0-9]+", RegexOptions.IgnoreCase | RegexOptions.Compiled);
    private readonly HostLogger _logger;
    private readonly object _sync = new();
    private System.Threading.Timer? _timer;
    private GpuPowerSnapshot _snapshot = new();
    private int _sampling;
    private bool _started;

    public GpuPowerMonitorService(HostLogger logger)
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
        Sample();
        _timer = new System.Threading.Timer(_ => Sample(), null, TimeSpan.FromSeconds(5), TimeSpan.FromSeconds(5));
        _logger.Info("GPU power monitor service started.");
    }

    public GpuPowerSnapshot GetSnapshot()
    {
        lock (_sync)
        {
            var snapshot = _snapshot.Clone();
            snapshot.Stale = !snapshot.SampledAt.HasValue || DateTimeOffset.UtcNow - snapshot.SampledAt.Value > TimeSpan.FromSeconds(20);
            if (snapshot.Stale && string.Equals(snapshot.Status, "live", StringComparison.OrdinalIgnoreCase))
            {
                snapshot.Status = "stale";
            }

            return snapshot;
        }
    }

    public void Dispose()
    {
        _timer?.Dispose();
    }

    private void Sample()
    {
        if (Interlocked.Exchange(ref _sampling, 1) == 1)
        {
            return;
        }

        try
        {
            var gpuNames = TryReadGpuNames();
            var sensors = new List<GpuPowerSensorReading>();
            sensors.AddRange(ReadWmiSensors(@"root\LibreHardwareMonitor", "LibreHardwareMonitor"));
            sensors.AddRange(ReadWmiSensors(@"root\OpenHardwareMonitor", "OpenHardwareMonitor"));
            sensors.AddRange(ReadHwInfoCsvSensors());

            var deduped = DeduplicateSensors(sensors);
            var pins = deduped
                .Where(sensor => sensor.Kind.StartsWith("pin", StringComparison.OrdinalIgnoreCase))
                .OrderBy(sensor => sensor.Label, StringComparer.OrdinalIgnoreCase)
                .ToList();
            var rails = deduped
                .Where(sensor => sensor.Kind.Contains("12v", StringComparison.OrdinalIgnoreCase)
                    || sensor.Kind.Contains("voltage", StringComparison.OrdinalIgnoreCase)
                    || sensor.Kind.Contains("current", StringComparison.OrdinalIgnoreCase))
                .Where(sensor => !pins.Any(pin => string.Equals(pin.Id, sensor.Id, StringComparison.OrdinalIgnoreCase)))
                .OrderBy(sensor => sensor.Label, StringComparer.OrdinalIgnoreCase)
                .ToList();
            var power = deduped
                .Where(sensor => string.Equals(sensor.Type, "Power", StringComparison.OrdinalIgnoreCase))
                .OrderBy(sensor => sensor.Label, StringComparer.OrdinalIgnoreCase)
                .ToList();
            var temperatures = deduped
                .Where(sensor => string.Equals(sensor.Type, "Temperature", StringComparison.OrdinalIgnoreCase))
                .OrderByDescending(sensor => sensor.Value ?? double.MinValue)
                .ToList();
            var alerts = deduped
                .Where(sensor => string.Equals(sensor.Status, "warn", StringComparison.OrdinalIgnoreCase)
                    || string.Equals(sensor.Status, "danger", StringComparison.OrdinalIgnoreCase))
                .OrderByDescending(sensor => string.Equals(sensor.Status, "danger", StringComparison.OrdinalIgnoreCase))
                .ThenBy(sensor => sensor.Label, StringComparer.OrdinalIgnoreCase)
                .ToList();

            var rtx50Detected = gpuNames.Any(name => Rtx50SeriesPattern.IsMatch(name));
            var sampledAt = DateTimeOffset.UtcNow;
            var snapshot = new GpuPowerSnapshot
            {
                Supported = true,
                Status = deduped.Count > 0 ? "live" : "setup",
                SampledAt = sampledAt,
                Stale = false,
                Source = BuildSourceSummary(deduped),
                Message = BuildMessage(gpuNames, rtx50Detected, deduped, pins),
                GpuNames = gpuNames,
                Rtx50SeriesDetected = rtx50Detected,
                Sensors = deduped,
                Pins = pins,
                Rails = rails,
                Power = power,
                Temperatures = temperatures,
                Alerts = alerts,
                TotalPower = SelectTotalPower(power),
                HottestTemperature = temperatures.FirstOrDefault()
            };

            lock (_sync)
            {
                _snapshot = snapshot;
            }
        }
        catch (Exception error)
        {
            _logger.Warn($"Failed to sample GPU power sensors: {error.Message}");
            lock (_sync)
            {
                var snapshot = _snapshot.Clone();
                snapshot.Status = "error";
                snapshot.Message = "GPU power sensor sampling failed.";
                snapshot.Source = string.IsNullOrWhiteSpace(snapshot.Source)
                    ? "GPU sensor monitor"
                    : snapshot.Source;
                snapshot.SampledAt = DateTimeOffset.UtcNow;
                snapshot.Stale = false;
                _snapshot = snapshot;
            }
        }
        finally
        {
            Interlocked.Exchange(ref _sampling, 0);
        }
    }

    private static List<string> TryReadGpuNames()
    {
        try
        {
            using var searcher = new ManagementObjectSearcher(
                @"root\cimv2",
                "SELECT Name FROM Win32_VideoController WHERE Name IS NOT NULL");

            return searcher.Get()
                .Cast<ManagementObject>()
                .Select(item => Convert.ToString(item["Name"]) ?? "")
                .Where(name => !string.IsNullOrWhiteSpace(name))
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .OrderBy(name => name, StringComparer.OrdinalIgnoreCase)
                .ToList();
        }
        catch
        {
            return [];
        }
    }

    private static List<GpuPowerSensorReading> ReadWmiSensors(string namespacePath, string source)
    {
        var readings = new List<GpuPowerSensorReading>();

        try
        {
            using var searcher = new ManagementObjectSearcher(
                namespacePath,
                "SELECT Name, Identifier, Parent, Value, SensorType FROM Sensor");

            foreach (ManagementObject sensor in searcher.Get())
            {
                var name = Convert.ToString(sensor["Name"]) ?? "";
                var identifier = Convert.ToString(sensor["Identifier"]) ?? "";
                var parent = Convert.ToString(sensor["Parent"]) ?? "";
                var sensorType = Convert.ToString(sensor["SensorType"]) ?? "";
                var combined = string.Join(" ", name, identifier, parent, sensorType);

                if (!IsGpuSensorCandidate(combined) || !IsInterestingSensor(combined, sensorType))
                {
                    continue;
                }

                var value = ToNullableDouble(sensor["Value"]);
                if (!value.HasValue)
                {
                    continue;
                }

                readings.Add(BuildReading(
                    source,
                    name,
                    parent,
                    sensorType,
                    UnitForSensorType(sensorType),
                    value.Value.ToString("0.###", CultureInfo.InvariantCulture),
                    value));
            }
        }
        catch
        {
        }

        return readings;
    }

    private static List<GpuPowerSensorReading> ReadHwInfoCsvSensors()
    {
        var readings = new List<GpuPowerSensorReading>();

        foreach (var filePath in FindHwInfoCsvCandidates())
        {
            if (TryReadHwInfoCsv(filePath, out var fileReadings))
            {
                readings.AddRange(fileReadings);
                if (readings.Count > 0)
                {
                    break;
                }
            }
        }

        return readings;
    }

    private static IEnumerable<string> FindHwInfoCsvCandidates()
    {
        var explicitFile = Environment.GetEnvironmentVariable("XENON_HWINFO_LOG");
        if (!string.IsNullOrWhiteSpace(explicitFile) && File.Exists(explicitFile))
        {
            yield return explicitFile;
        }

        var directories = new List<string>();
        var explicitDirectory = Environment.GetEnvironmentVariable("XENON_HWINFO_LOG_DIR");
        if (!string.IsNullOrWhiteSpace(explicitDirectory))
        {
            directories.Add(explicitDirectory);
        }

        var documents = Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments);
        var desktop = Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory);
        var userProfile = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);

        AddIfNotEmpty(directories, Path.Combine(documents, "HWiNFO64"));
        AddIfNotEmpty(directories, Path.Combine(documents, "HWiNFO"));
        AddIfNotEmpty(directories, documents);
        AddIfNotEmpty(directories, desktop);
        AddIfNotEmpty(directories, Path.Combine(userProfile, "Downloads"));

        foreach (var directory in directories.Distinct(StringComparer.OrdinalIgnoreCase))
        {
            if (!Directory.Exists(directory))
            {
                continue;
            }

            IEnumerable<string> files;
            try
            {
                files = Directory.EnumerateFiles(directory, "*.csv", SearchOption.TopDirectoryOnly)
                    .Where(path => Path.GetFileName(path).Contains("hwinfo", StringComparison.OrdinalIgnoreCase)
                        || Path.GetFileName(path).Contains("sensor", StringComparison.OrdinalIgnoreCase))
                    .OrderByDescending(File.GetLastWriteTimeUtc)
                    .Take(8)
                    .ToArray();
            }
            catch
            {
                continue;
            }

            foreach (var file in files)
            {
                yield return file;
            }
        }
    }

    private static void AddIfNotEmpty(List<string> values, string value)
    {
        if (!string.IsNullOrWhiteSpace(value))
        {
            values.Add(value);
        }
    }

    private static bool TryReadHwInfoCsv(string filePath, out List<GpuPowerSensorReading> readings)
    {
        readings = [];

        try
        {
            string? headerLine = null;
            string? lastLine = null;
            var headerColumnCount = 0;

            foreach (var line in File.ReadLines(filePath))
            {
                if (string.IsNullOrWhiteSpace(line))
                {
                    continue;
                }

                var trimmedLine = line.Trim();
                var columns = ParseCsvLine(trimmedLine);
                if (LooksLikeHwInfoHeader(columns))
                {
                    headerLine = trimmedLine;
                    lastLine = null;
                    headerColumnCount = columns.Count;
                    continue;
                }

                if (headerLine is not null && columns.Count >= Math.Min(headerColumnCount, 2))
                {
                    lastLine = trimmedLine;
                }
            }

            if (string.IsNullOrWhiteSpace(headerLine)
                || string.IsNullOrWhiteSpace(lastLine)
                || string.Equals(headerLine, lastLine, StringComparison.Ordinal))
            {
                return false;
            }

            var headers = ParseCsvLine(headerLine);
            var values = ParseCsvLine(lastLine);
            var count = Math.Min(headers.Count, values.Count);

            for (var index = 0; index < count; index++)
            {
                var header = CleanHeaderCell(headers[index]);
                var rawValue = values[index].Trim();
                if (string.IsNullOrWhiteSpace(header)
                    || string.IsNullOrWhiteSpace(rawValue)
                    || string.Equals(header, "Date", StringComparison.OrdinalIgnoreCase)
                    || string.Equals(header, "Time", StringComparison.OrdinalIgnoreCase))
                {
                    continue;
                }

                var unit = ExtractUnit(header);
                var type = TypeForHeader(header, unit);
                var combined = $"{header} {unit} {type}";
                if (!IsGpuSensorCandidate(combined) || !IsInterestingSensor(combined, type))
                {
                    continue;
                }

                var numericValue = ParseNullableNumber(rawValue);
                if (!numericValue.HasValue && !LooksLikeStatusSensor(combined))
                {
                    continue;
                }

                readings.Add(BuildReading(
                    "HWiNFO CSV",
                    CleanSensorName(header),
                    Path.GetFileName(filePath),
                    type,
                    unit,
                    rawValue,
                    numericValue));
            }
        }
        catch
        {
            return false;
        }

        return readings.Count > 0;
    }

    private static bool LooksLikeHwInfoHeader(List<string> columns)
    {
        if (columns.Count < 2)
        {
            return false;
        }

        var headers = columns
            .Select(CleanHeaderCell)
            .Where(header => !string.IsNullOrWhiteSpace(header))
            .ToList();
        var sensorHeaders = headers
            .Where(header => !string.Equals(header, "Date", StringComparison.OrdinalIgnoreCase)
                && !string.Equals(header, "Time", StringComparison.OrdinalIgnoreCase))
            .ToList();

        if (sensorHeaders.Count == 0)
        {
            return false;
        }

        return sensorHeaders.Any(header =>
        {
            var unit = ExtractUnit(header);
            var type = TypeForHeader(header, unit);
            var combined = $"{header} {unit} {type}";
            return IsGpuSensorCandidate(combined) && IsInterestingSensor(combined, type);
        });
    }

    private static string CleanHeaderCell(string value)
    {
        return value.Trim('\uFEFF', ' ', '"');
    }

    private static GpuPowerSensorReading BuildReading(
        string source,
        string name,
        string device,
        string type,
        string unit,
        string rawValue,
        double? value)
    {
        var label = BuildLabel(name);
        var kind = KindForSensor(name, type, unit);
        double? normalizedValue = value.HasValue ? Math.Round(value.Value, 3) : null;
        return new GpuPowerSensorReading
        {
            Id = StableId($"{source}-{device}-{name}-{type}-{unit}"),
            Label = label,
            Name = name,
            Device = string.IsNullOrWhiteSpace(device) ? "GPU" : device,
            Type = string.IsNullOrWhiteSpace(type) ? "Sensor" : type,
            Kind = kind,
            Unit = unit,
            Value = normalizedValue,
            RawValue = rawValue,
            DisplayValue = FormatDisplayValue(rawValue, normalizedValue, unit),
            Status = InferStatus(name, type, unit, rawValue, normalizedValue),
            Source = source,
            Detail = BuildDetail(name, type, source),
            SampledAt = DateTimeOffset.UtcNow
        };
    }

    private static List<GpuPowerSensorReading> DeduplicateSensors(List<GpuPowerSensorReading> sensors)
    {
        var byId = new Dictionary<string, GpuPowerSensorReading>(StringComparer.OrdinalIgnoreCase);

        foreach (var sensor in sensors)
        {
            var key = StableId($"{sensor.Label}-{sensor.Type}-{sensor.Unit}");
            if (!byId.ContainsKey(key)
                || string.Equals(sensor.Source, "HWiNFO CSV", StringComparison.OrdinalIgnoreCase))
            {
                byId[key] = sensor;
            }
        }

        return byId.Values
            .OrderBy(sensor => sensor.Label, StringComparer.OrdinalIgnoreCase)
            .ToList();
    }

    private static bool IsGpuSensorCandidate(string value)
    {
        return ContainsAny(value,
            "gpu",
            "nvidia",
            "geforce",
            "rtx",
            "graphics",
            "12vhpwr",
            "12v-2x6",
            "12v2x6",
            "16-pin",
            "pin",
            "power detector",
            "pcie");
    }

    private static bool IsInterestingSensor(string combined, string sensorType)
    {
        if (ContainsAny(combined,
            "12vhpwr",
            "12v-2x6",
            "12v2x6",
            "16-pin",
            "power detector",
            "pin",
            "pcie",
            "pci-e",
            "voltage",
            "current",
            "power",
            "watt",
            "rail"))
        {
            return true;
        }

        return ContainsAny(sensorType, "Voltage", "Current", "Power", "Temperature");
    }

    private static bool LooksLikeStatusSensor(string value)
    {
        return ContainsAny(value, "status", "protect", "detector", "fault", "warning", "pin");
    }

    private static string KindForSensor(string name, string type, string unit)
    {
        var combined = $"{name} {type} {unit}";
        if (ContainsAny(combined, "pin-protect", "power detector", "fault", "protect"))
        {
            return ContainsAny(combined, "current", "amp") ? "pin-protect-current" : "pin-protect-status";
        }

        if (ContainsAny(combined, "pin", "12vhpwr", "12v-2x6", "12v2x6", "16-pin"))
        {
            if (ContainsAny(combined, "current", "amp", " A"))
            {
                return "pin-current";
            }

            if (ContainsAny(combined, "voltage", " V"))
            {
                return "pin-voltage";
            }

            return "pin";
        }

        if (ContainsAny(combined, "12v", "12 v"))
        {
            if (ContainsAny(combined, "current", "amp", " A"))
            {
                return "current-12v";
            }

            return "voltage-12v";
        }

        if (ContainsAny(type, "Power") || ContainsAny(unit, "W"))
        {
            return ContainsAny(combined, "total") ? "total-power-draw" : "gpu-power";
        }

        if (ContainsAny(type, "Temperature") || ContainsAny(unit, "C", "\u00b0C"))
        {
            return "gpu-temp";
        }

        if (ContainsAny(type, "Current") || ContainsAny(unit, "A"))
        {
            return "gpu-current";
        }

        if (ContainsAny(type, "Voltage") || ContainsAny(unit, "V"))
        {
            return "gpu-voltage";
        }

        return "gpu-sensor";
    }

    private static string TypeForHeader(string header, string unit)
    {
        if (ContainsAny(unit, "°C", "C") || ContainsAny(header, "temperature", "temp", "hot spot", "hotspot"))
        {
            return "Temperature";
        }

        if (ContainsAny(unit, "RPM") || ContainsAny(header, "fan"))
        {
            return "Fan";
        }

        if (ContainsAny(unit, "W") || ContainsAny(header, "power", "watt"))
        {
            return "Power";
        }

        if (string.Equals(unit, "A", StringComparison.OrdinalIgnoreCase)
            || ContainsAny(header, "current", "amp"))
        {
            return "Current";
        }

        if (string.Equals(unit, "V", StringComparison.OrdinalIgnoreCase)
            || ContainsAny(header, "voltage", "volt"))
        {
            return "Voltage";
        }

        if (ContainsAny(unit, "%") || ContainsAny(header, "usage", "load"))
        {
            return "Load";
        }

        if (LooksLikeStatusSensor(header))
        {
            return "Status";
        }

        return "Sensor";
    }

    private static string UnitForSensorType(string sensorType)
    {
        if (string.Equals(sensorType, "Temperature", StringComparison.OrdinalIgnoreCase))
        {
            return "C";
        }

        if (string.Equals(sensorType, "Voltage", StringComparison.OrdinalIgnoreCase))
        {
            return "V";
        }

        if (string.Equals(sensorType, "Current", StringComparison.OrdinalIgnoreCase))
        {
            return "A";
        }

        if (string.Equals(sensorType, "Power", StringComparison.OrdinalIgnoreCase))
        {
            return "W";
        }

        if (string.Equals(sensorType, "Load", StringComparison.OrdinalIgnoreCase))
        {
            return "%";
        }

        if (string.Equals(sensorType, "Fan", StringComparison.OrdinalIgnoreCase))
        {
            return "RPM";
        }

        return "";
    }

    private static string ExtractUnit(string header)
    {
        var match = UnitPattern.Match(header);
        return match.Success ? match.Groups["unit"].Value.Trim() : "";
    }

    private static string CleanSensorName(string header)
    {
        return UnitPattern.Replace(header, "").Trim();
    }

    private static string BuildLabel(string name)
    {
        var label = CleanSensorName(name);
        var separators = new[] { ":", "/" };
        foreach (var separator in separators)
        {
            var index = label.LastIndexOf(separator, StringComparison.Ordinal);
            if (index >= 0 && index < label.Length - 1)
            {
                label = label[(index + 1)..].Trim();
            }
        }

        return string.IsNullOrWhiteSpace(label) ? "GPU sensor" : label;
    }

    private static string BuildDetail(string name, string type, string source)
    {
        var cleanName = CleanSensorName(name);
        return string.IsNullOrWhiteSpace(type)
            ? $"{source} sensor"
            : $"{type} via {source}";
    }

    private static string FormatDisplayValue(string rawValue, double? value, string unit)
    {
        if (!value.HasValue)
        {
            return string.IsNullOrWhiteSpace(rawValue) ? "--" : rawValue;
        }

        var rounded = Math.Abs(value.Value) >= 100
            ? value.Value.ToString("0", CultureInfo.InvariantCulture)
            : value.Value.ToString("0.##", CultureInfo.InvariantCulture);
        return string.IsNullOrWhiteSpace(unit) ? rounded : $"{rounded} {unit}";
    }

    private static string InferStatus(string name, string type, string unit, string rawValue, double? value)
    {
        var combined = $"{name} {type} {unit} {rawValue}";
        if (ContainsAny(combined, "fault", "fail", "critical", "abnormal", "warning", "alert", "reseat"))
        {
            return "danger";
        }

        if (ContainsAny(combined, "normal", "ok", "good"))
        {
            return "good";
        }

        if (value.HasValue
            && (ContainsAny(combined, "12v", "12 v", "12vhpwr", "12v-2x6", "12v2x6", "pin"))
            && (string.Equals(unit, "V", StringComparison.OrdinalIgnoreCase)
                || ContainsAny(type, "Voltage")))
        {
            if (value.Value < 11.4 || value.Value > 12.8)
            {
                return "danger";
            }

            if (value.Value < 11.7 || value.Value > 12.4)
            {
                return "warn";
            }
        }

        return "good";
    }

    private static GpuPowerSensorReading? SelectTotalPower(List<GpuPowerSensorReading> power)
    {
        return power.FirstOrDefault(sensor => ContainsAny(sensor.Name, "total", "board", "gpu power", "power draw"))
            ?? power.OrderByDescending(sensor => sensor.Value ?? double.MinValue).FirstOrDefault();
    }

    private static string BuildSourceSummary(List<GpuPowerSensorReading> sensors)
    {
        var sources = sensors.Select(sensor => sensor.Source)
            .Where(source => !string.IsNullOrWhiteSpace(source))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();

        return sources.Count == 0 ? "Waiting for GPU sensor source" : string.Join(" + ", sources);
    }

    private static string BuildMessage(List<string> gpuNames, bool rtx50Detected, List<GpuPowerSensorReading> sensors, List<GpuPowerSensorReading> pins)
    {
        if (sensors.Count == 0)
        {
            return rtx50Detected
                ? "RTX 50-series GPU detected. Start LibreHardwareMonitor, OpenHardwareMonitor, or an HWiNFO CSV sensor log to expose connector readings."
                : "No connector sensors are exposed yet. The panel will show RTX 50-series and other GPU power readings when a local sensor source provides them.";
        }

        if (pins.Count > 0)
        {
            return rtx50Detected
                ? $"RTX 50-series GPU detected with {pins.Count} connector pin readings live."
                : $"{pins.Count} connector pin readings are live.";
        }

        var gpuName = gpuNames.FirstOrDefault() ?? "GPU";
        return $"{gpuName} power and rail sensors are live. Per-pin readings will appear when the card/tool exposes them.";
    }

    private static double? ToNullableDouble(object? value)
    {
        try
        {
            return value is null ? null : Convert.ToDouble(value, CultureInfo.InvariantCulture);
        }
        catch
        {
            return null;
        }
    }

    private static double? ParseNullableNumber(string value)
    {
        var normalized = new string(value
            .Trim()
            .Replace(",", ".", StringComparison.Ordinal)
            .TakeWhile(character => char.IsDigit(character) || character == '-' || character == '+' || character == '.')
            .ToArray());

        return double.TryParse(normalized, NumberStyles.Float, CultureInfo.InvariantCulture, out var parsed)
            ? parsed
            : null;
    }

    private static List<string> ParseCsvLine(string line)
    {
        var values = new List<string>();
        var current = new StringBuilder();
        var inQuotes = false;

        for (var index = 0; index < line.Length; index++)
        {
            var character = line[index];
            if (character == '"')
            {
                if (inQuotes && index + 1 < line.Length && line[index + 1] == '"')
                {
                    current.Append('"');
                    index++;
                }
                else
                {
                    inQuotes = !inQuotes;
                }

                continue;
            }

            if (character == ',' && !inQuotes)
            {
                values.Add(current.ToString());
                current.Clear();
                continue;
            }

            current.Append(character);
        }

        values.Add(current.ToString());
        return values;
    }

    private static bool ContainsAny(string value, params string[] needles)
    {
        return needles.Any(needle => value.Contains(needle, StringComparison.OrdinalIgnoreCase));
    }

    private static string StableId(string value)
    {
        var id = UnsafeIdPattern.Replace(value.ToLowerInvariant(), "-").Trim('-');
        if (string.IsNullOrWhiteSpace(id))
        {
            return "gpu-sensor";
        }

        return id.Length <= 96 ? id : id[..96];
    }
}

public sealed class GpuPowerSnapshot
{
    public bool Supported { get; set; } = true;

    public string Status { get; set; } = "starting";

    public DateTimeOffset? SampledAt { get; set; }

    public bool Stale { get; set; }

    public string Message { get; set; } = "";

    public string Source { get; set; } = "Waiting for GPU sensor source";

    public List<string> GpuNames { get; set; } = [];

    public bool Rtx50SeriesDetected { get; set; }

    public List<GpuPowerSensorReading> Sensors { get; set; } = [];

    public List<GpuPowerSensorReading> Pins { get; set; } = [];

    public List<GpuPowerSensorReading> Rails { get; set; } = [];

    public List<GpuPowerSensorReading> Power { get; set; } = [];

    public List<GpuPowerSensorReading> Temperatures { get; set; } = [];

    public List<GpuPowerSensorReading> Alerts { get; set; } = [];

    public GpuPowerSensorReading? TotalPower { get; set; }

    public GpuPowerSensorReading? HottestTemperature { get; set; }

    public GpuPowerSnapshot Clone()
    {
        return new GpuPowerSnapshot
        {
            Supported = Supported,
            Status = Status,
            SampledAt = SampledAt,
            Stale = Stale,
            Message = Message,
            Source = Source,
            GpuNames = GpuNames.ToList(),
            Rtx50SeriesDetected = Rtx50SeriesDetected,
            Sensors = Sensors.Select(sensor => sensor.Clone()).ToList(),
            Pins = Pins.Select(sensor => sensor.Clone()).ToList(),
            Rails = Rails.Select(sensor => sensor.Clone()).ToList(),
            Power = Power.Select(sensor => sensor.Clone()).ToList(),
            Temperatures = Temperatures.Select(sensor => sensor.Clone()).ToList(),
            Alerts = Alerts.Select(sensor => sensor.Clone()).ToList(),
            TotalPower = TotalPower?.Clone(),
            HottestTemperature = HottestTemperature?.Clone()
        };
    }
}

public sealed class GpuPowerSensorReading
{
    public string Id { get; set; } = "";

    public string Label { get; set; } = "";

    public string Name { get; set; } = "";

    public string Device { get; set; } = "";

    public string Type { get; set; } = "";

    public string Kind { get; set; } = "";

    public string Unit { get; set; } = "";

    public double? Value { get; set; }

    public string RawValue { get; set; } = "";

    public string DisplayValue { get; set; } = "";

    public string Status { get; set; } = "good";

    public string Source { get; set; } = "";

    public string Detail { get; set; } = "";

    public DateTimeOffset? SampledAt { get; set; }

    public GpuPowerSensorReading Clone()
    {
        return new GpuPowerSensorReading
        {
            Id = Id,
            Label = Label,
            Name = Name,
            Device = Device,
            Type = Type,
            Kind = Kind,
            Unit = Unit,
            Value = Value,
            RawValue = RawValue,
            DisplayValue = DisplayValue,
            Status = Status,
            Source = Source,
            Detail = Detail,
            SampledAt = SampledAt
        };
    }
}
