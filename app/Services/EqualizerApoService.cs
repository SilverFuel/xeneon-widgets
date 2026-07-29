using System.Globalization;
using Microsoft.Win32;

namespace XenonEdgeHost;

public sealed class EqualizerApoService
{
    internal const string ManagedFileName = "auxora.txt";
    internal const string IncludeDirective = "Include: auxora.txt";
    private const string ManagedMainConfiguration =
        "# Equalizer APO configuration managed by Auxora"
        + "\r\n"
        + IncludeDirective
        + "\r\n";

    private static readonly int[] BandFrequencies =
    [
        31,
        62,
        125,
        250,
        500,
        1000,
        2000,
        4000,
        8000,
        16000
    ];

    private static readonly IReadOnlyDictionary<string, double[]> PresetBands =
        new Dictionary<string, double[]>(StringComparer.OrdinalIgnoreCase)
        {
            ["Flat"] = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
            ["Bass Boost"] = [6, 5, 4, 2, 0, -1, -1, 0, 1, 2],
            ["Voice"] = [-4, -3, -2, -1, 1, 3, 4, 2, 0, -2],
            ["Movie"] = [4, 3, 2, 0, -1, 1, 3, 4, 3, 2],
            ["Gaming"] = [3, 2, 0, -2, -1, 2, 4, 3, 1, 0]
        };

    private readonly HostLogger _logger;
    private readonly Func<string?> _configPathResolver;
    private readonly object _sync = new();

    public EqualizerApoService(HostLogger logger)
        : this(logger, ResolveConfigPath)
    {
    }

    internal EqualizerApoService(HostLogger logger, Func<string?> configPathResolver)
    {
        _logger = logger;
        _configPathResolver = configPathResolver;
    }

    public EqualizerApoSnapshot GetSnapshot()
    {
        lock (_sync)
        {
            return GetSnapshotCore();
        }
    }

    public EqualizerApoSnapshot EnableIntegration()
    {
        lock (_sync)
        {
            var configPath = RequireConfigPath();
            var mainConfigPath = Path.Combine(configPath, "config.txt");
            var managedConfigPath = Path.Combine(configPath, ManagedFileName);

            try
            {
                if (!File.Exists(managedConfigPath))
                {
                    WriteManagedConfiguration(
                        managedConfigPath,
                        "Flat",
                        bypassed: false,
                        PresetBands["Flat"]);
                }

                var mainConfiguration = File.ReadAllText(mainConfigPath);
                if (IsUntouchedDefaultConfiguration(mainConfiguration))
                {
                    File.WriteAllText(mainConfigPath, ManagedMainConfiguration);
                    mainConfiguration = ManagedMainConfiguration;
                    _logger.Info("Removed Equalizer APO's untouched demo filters before enabling Auxora.");
                }

                if (!ContainsIncludeDirective(mainConfiguration))
                {
                    var prefix = mainConfiguration.Length == 0 || mainConfiguration.EndsWith('\n')
                        ? ""
                        : Environment.NewLine;
                    File.AppendAllText(
                        mainConfigPath,
                        prefix
                        + "# Auxora Equalizer - remove the next line to disconnect Auxora"
                        + Environment.NewLine
                        + IncludeDirective
                        + Environment.NewLine);
                }

                _logger.Info("Equalizer APO integration enabled.");
                return GetSnapshotCore();
            }
            catch (UnauthorizedAccessException error)
            {
                throw new InvalidOperationException(
                    "Windows blocked access to Equalizer APO. Run Auxora as administrator once, then choose Connect again.",
                    error);
            }
            catch (IOException error)
            {
                throw new InvalidOperationException(
                    "Equalizer APO's configuration could not be updated. Close its Configuration Editor and try again.",
                    error);
            }
        }
    }

    public EqualizerApoSnapshot Update(EqualizerApoUpdateRequest request)
    {
        ArgumentNullException.ThrowIfNull(request);

        lock (_sync)
        {
            var configPath = RequireConfigPath();
            var mainConfiguration = File.ReadAllText(Path.Combine(configPath, "config.txt"));
            if (!ContainsIncludeDirective(mainConfiguration))
            {
                throw new InvalidOperationException("Connect Auxora to Equalizer APO before changing sound settings.");
            }

            var current = ReadManagedConfiguration(Path.Combine(configPath, ManagedFileName));
            var preset = string.IsNullOrWhiteSpace(request.Preset)
                ? current.Preset
                : request.Preset.Trim();
            double[] bands;

            if (request.Bands is { Count: > 0 })
            {
                bands = ValidateBands(request.Bands);
                preset = "Custom";
            }
            else if (PresetBands.TryGetValue(preset, out var presetBands))
            {
                bands = presetBands.ToArray();
            }
            else if (string.Equals(preset, "Custom", StringComparison.OrdinalIgnoreCase))
            {
                bands = current.Bands;
            }
            else
            {
                throw new InvalidOperationException("Choose a built-in preset or provide all 10 equalizer bands.");
            }

            var bypassed = request.Bypassed ?? current.Bypassed;
            try
            {
                WriteManagedConfiguration(
                    Path.Combine(configPath, ManagedFileName),
                    NormalizePresetName(preset),
                    bypassed,
                    bands);
                _logger.Info($"Equalizer APO settings updated: preset={NormalizePresetName(preset)}, bypassed={bypassed}.");
                return GetSnapshotCore();
            }
            catch (UnauthorizedAccessException error)
            {
                throw new InvalidOperationException(
                    "Windows blocked the equalizer change. Run Auxora as administrator and try again.",
                    error);
            }
            catch (IOException error)
            {
                throw new InvalidOperationException(
                    "The equalizer change could not be saved. Close Equalizer APO's Configuration Editor and try again.",
                    error);
            }
        }
    }

    internal static bool ContainsIncludeDirective(string configuration)
    {
        return configuration
            .Split(['\r', '\n'], StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Any(line => string.Equals(line, IncludeDirective, StringComparison.OrdinalIgnoreCase));
    }

    internal static bool IsUntouchedDefaultConfiguration(string configuration)
    {
        var commands = configuration
            .Split(['\r', '\n'], StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Where(line => !line.StartsWith('#'))
            .ToList();
        var auxoraIncludes = commands.Count(line =>
            string.Equals(line, IncludeDirective, StringComparison.OrdinalIgnoreCase));
        var stockCommands = commands
            .Where(line => !string.Equals(line, IncludeDirective, StringComparison.OrdinalIgnoreCase))
            .ToList();

        if (auxoraIncludes > 1
            || stockCommands.Count != 3
            || !stockCommands.Any(line => string.Equals(line, "Preamp: -6 dB", StringComparison.OrdinalIgnoreCase))
            || !stockCommands.Any(line => string.Equals(line, "Include: example.txt", StringComparison.OrdinalIgnoreCase)))
        {
            return false;
        }

        var graphicEq = stockCommands.FirstOrDefault(line =>
            line.StartsWith("GraphicEQ:", StringComparison.OrdinalIgnoreCase));
        if (graphicEq is null)
        {
            return false;
        }

        var expectedFrequencies = new[]
        {
            25,
            40,
            63,
            100,
            160,
            250,
            400,
            630,
            1000,
            1600,
            2500,
            4000,
            6300,
            10000,
            16000
        };
        var pairs = graphicEq[(graphicEq.IndexOf(':') + 1)..]
            .Split(';', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        if (pairs.Length != expectedFrequencies.Length)
        {
            return false;
        }

        for (var index = 0; index < pairs.Length; index++)
        {
            var parts = pairs[index]
                .Split(' ', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
            if (parts.Length != 2
                || !int.TryParse(parts[0], NumberStyles.Integer, CultureInfo.InvariantCulture, out var frequency)
                || !double.TryParse(parts[1], NumberStyles.Float, CultureInfo.InvariantCulture, out var gain)
                || frequency != expectedFrequencies[index]
                || gain != 0)
            {
                return false;
            }
        }

        return true;
    }

    internal static double CalculateHeadroom(IReadOnlyList<double> bands)
    {
        var highestBoost = bands.Count == 0 ? 0 : bands.Max();
        return -Math.Clamp(highestBoost, 0, 12);
    }

    internal static string BuildManagedConfiguration(string preset, bool bypassed, IReadOnlyList<double> bands)
    {
        var normalizedBands = bands
            .Select(value => Math.Round(Math.Clamp(value, -12, 12), 1))
            .ToArray();
        var lines = new List<string>
        {
            "# Managed by Auxora. Use Auxora to change this file.",
            $"# Auxora preset: {NormalizePresetName(preset)}",
            $"# Auxora bypass: {bypassed.ToString().ToLowerInvariant()}"
        };

        if (bypassed)
        {
            lines.Add("# Equalizer bypassed. No sound processing is applied.");
        }
        else
        {
            lines.Add($"Preamp: {FormatNumber(CalculateHeadroom(normalizedBands))} dB");
            lines.Add(
                "GraphicEQ: "
                + string.Join(
                    "; ",
                    BandFrequencies.Select((frequency, index) =>
                        $"{frequency} {FormatNumber(normalizedBands[index])}")));
        }

        return string.Join(Environment.NewLine, lines) + Environment.NewLine;
    }

    private EqualizerApoSnapshot GetSnapshotCore()
    {
        var configPath = _configPathResolver();
        if (string.IsNullOrWhiteSpace(configPath)
            || !Directory.Exists(configPath)
            || !File.Exists(Path.Combine(configPath, "config.txt")))
        {
            return EqualizerApoSnapshot.CreateMissing(BandFrequencies, PresetBands.Keys);
        }

        try
        {
            var mainConfiguration = File.ReadAllText(Path.Combine(configPath, "config.txt"));
            var connected = ContainsIncludeDirective(mainConfiguration);
            var managed = ReadManagedConfiguration(Path.Combine(configPath, ManagedFileName));
            return new EqualizerApoSnapshot
            {
                Supported = true,
                Installed = true,
                Connected = connected,
                Bypassed = managed.Bypassed,
                Status = connected
                    ? managed.Bypassed ? "bypassed" : "live"
                    : "setup",
                Message = connected
                    ? managed.Bypassed
                        ? "Equalizer is connected but currently bypassed."
                        : "Auxora is connected to Equalizer APO."
                    : "Equalizer APO is installed. Connect it to Auxora to start shaping sound.",
                Engine = "Equalizer APO",
                Preset = managed.Preset,
                HeadroomDb = CalculateHeadroom(managed.Bands),
                Bands = BandFrequencies
                    .Select((frequency, index) => new EqualizerBandPayload
                    {
                        Frequency = frequency,
                        Gain = managed.Bands[index]
                    })
                    .ToList(),
                Presets = PresetBands.Keys.ToList()
            };
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException)
        {
            _logger.Error("Failed to read Equalizer APO configuration.", error);
            return new EqualizerApoSnapshot
            {
                Supported = true,
                Installed = true,
                Connected = false,
                Status = "error",
                Message = "Equalizer APO was found, but Auxora could not read its configuration.",
                Engine = "Equalizer APO",
                Preset = "Flat",
                Bands = CreateFlatBandPayloads(),
                Presets = PresetBands.Keys.ToList()
            };
        }
    }

    private string RequireConfigPath()
    {
        var configPath = _configPathResolver();
        if (string.IsNullOrWhiteSpace(configPath)
            || !Directory.Exists(configPath)
            || !File.Exists(Path.Combine(configPath, "config.txt")))
        {
            throw new InvalidOperationException("Install Equalizer APO first, then return here and choose Check again.");
        }

        return Path.GetFullPath(configPath);
    }

    private static ManagedEqualizerConfiguration ReadManagedConfiguration(string path)
    {
        if (!File.Exists(path))
        {
            return new ManagedEqualizerConfiguration("Flat", false, PresetBands["Flat"].ToArray());
        }

        var lines = File.ReadAllLines(path);
        var preset = ReadMetadata(lines, "# Auxora preset:") ?? "Custom";
        var bypassed = bool.TryParse(ReadMetadata(lines, "# Auxora bypass:"), out var bypassValue) && bypassValue;
        var graphicEqLine = lines.FirstOrDefault(line =>
            line.TrimStart().StartsWith("GraphicEQ:", StringComparison.OrdinalIgnoreCase));
        var parsedBands = ParseGraphicEq(graphicEqLine);

        return new ManagedEqualizerConfiguration(
            NormalizePresetName(preset),
            bypassed,
            parsedBands ?? PresetBands.GetValueOrDefault(preset, PresetBands["Flat"]).ToArray());
    }

    private static string? ReadMetadata(IEnumerable<string> lines, string prefix)
    {
        var line = lines.FirstOrDefault(candidate =>
            candidate.TrimStart().StartsWith(prefix, StringComparison.OrdinalIgnoreCase));
        return line is null ? null : line[(line.IndexOf(prefix, StringComparison.OrdinalIgnoreCase) + prefix.Length)..].Trim();
    }

    private static double[]? ParseGraphicEq(string? line)
    {
        if (string.IsNullOrWhiteSpace(line))
        {
            return null;
        }

        var values = new Dictionary<int, double>();
        foreach (var pair in line[(line.IndexOf(':') + 1)..].Split(';', StringSplitOptions.RemoveEmptyEntries))
        {
            var parts = pair.Split(' ', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
            if (parts.Length != 2
                || !int.TryParse(parts[0], NumberStyles.Integer, CultureInfo.InvariantCulture, out var frequency)
                || !double.TryParse(parts[1], NumberStyles.Float, CultureInfo.InvariantCulture, out var gain))
            {
                return null;
            }

            values[frequency] = Math.Round(Math.Clamp(gain, -12, 12), 1);
        }

        return BandFrequencies.All(values.ContainsKey)
            ? BandFrequencies.Select(frequency => values[frequency]).ToArray()
            : null;
    }

    private static double[] ValidateBands(IReadOnlyList<EqualizerBandRequest> bands)
    {
        if (bands.Count != BandFrequencies.Length)
        {
            throw new InvalidOperationException("All 10 equalizer bands are required.");
        }

        var uniqueFrequencyCount = bands.Select(band => band.Frequency).Distinct().Count();
        if (uniqueFrequencyCount != BandFrequencies.Length)
        {
            throw new InvalidOperationException("Each equalizer frequency must be provided exactly once.");
        }

        var byFrequency = bands.ToDictionary(band => band.Frequency, band => band.Gain);
        if (!BandFrequencies.All(byFrequency.ContainsKey))
        {
            throw new InvalidOperationException("The equalizer bands do not match Auxora's 10-band layout.");
        }

        if (byFrequency.Values.Any(gain => double.IsNaN(gain) || double.IsInfinity(gain) || gain is < -12 or > 12))
        {
            throw new InvalidOperationException("Each equalizer band must be between -12 dB and +12 dB.");
        }

        return BandFrequencies.Select(frequency => Math.Round(byFrequency[frequency], 1)).ToArray();
    }

    private static void WriteManagedConfiguration(string path, string preset, bool bypassed, IReadOnlyList<double> bands)
    {
        File.WriteAllText(path, BuildManagedConfiguration(preset, bypassed, bands));
    }

    private static string NormalizePresetName(string preset)
    {
        var match = PresetBands.Keys.FirstOrDefault(value =>
            string.Equals(value, preset, StringComparison.OrdinalIgnoreCase));
        return match ?? (string.Equals(preset, "Custom", StringComparison.OrdinalIgnoreCase) ? "Custom" : preset.Trim());
    }

    private static string FormatNumber(double value)
    {
        return value.ToString("0.#", CultureInfo.InvariantCulture);
    }

    private static List<EqualizerBandPayload> CreateFlatBandPayloads()
    {
        return BandFrequencies
            .Select(frequency => new EqualizerBandPayload { Frequency = frequency, Gain = 0 })
            .ToList();
    }

    private static string? ResolveConfigPath()
    {
        foreach (var view in new[] { RegistryView.Registry64, RegistryView.Registry32 })
        {
            try
            {
                using var localMachine = RegistryKey.OpenBaseKey(RegistryHive.LocalMachine, view);
                using var key = localMachine.OpenSubKey(@"SOFTWARE\EqualizerAPO", writable: false);
                if (key?.GetValue("ConfigPath") is string registryPath
                    && Directory.Exists(registryPath))
                {
                    return registryPath;
                }
            }
            catch
            {
            }
        }

        var candidates = new[]
        {
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "EqualizerAPO", "config"),
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), "EqualizerAPO", "config")
        };
        return candidates.FirstOrDefault(Directory.Exists);
    }

    private sealed record ManagedEqualizerConfiguration(string Preset, bool Bypassed, double[] Bands);
}

public sealed class EqualizerApoSnapshot
{
    public bool Supported { get; set; } = true;

    public bool Installed { get; set; }

    public bool Connected { get; set; }

    public bool Bypassed { get; set; }

    public string Status { get; set; } = "setup";

    public string Message { get; set; } = "";

    public string Engine { get; set; } = "Equalizer APO";

    public string Preset { get; set; } = "Flat";

    public double HeadroomDb { get; set; }

    public List<EqualizerBandPayload> Bands { get; set; } = new();

    public List<string> Presets { get; set; } = new();

    internal static EqualizerApoSnapshot CreateMissing(
        IReadOnlyList<int> frequencies,
        IEnumerable<string> presets)
    {
        return new EqualizerApoSnapshot
        {
            Supported = true,
            Installed = false,
            Connected = false,
            Bypassed = false,
            Status = "missing",
            Message = "Install Equalizer APO to turn on real sound shaping.",
            Engine = "Equalizer APO",
            Preset = "Flat",
            HeadroomDb = 0,
            Bands = frequencies
                .Select(frequency => new EqualizerBandPayload { Frequency = frequency, Gain = 0 })
                .ToList(),
            Presets = presets.ToList()
        };
    }
}

public sealed class EqualizerBandPayload
{
    public int Frequency { get; set; }

    public double Gain { get; set; }
}

public sealed class EqualizerApoUpdateRequest
{
    public string? Preset { get; set; }

    public bool? Bypassed { get; set; }

    public List<EqualizerBandRequest>? Bands { get; set; }
}

public sealed class EqualizerBandRequest
{
    public int Frequency { get; set; }

    public double Gain { get; set; }
}
