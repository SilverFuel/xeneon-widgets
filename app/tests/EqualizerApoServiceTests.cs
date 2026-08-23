using NUnit.Framework;

namespace XenonEdgeHost.Tests;

[TestFixture]
public sealed class EqualizerApoServiceTests
{
    private string _root = "";
    private HostLogger _logger = null!;

    [SetUp]
    public void SetUp()
    {
        _root = Path.Combine(Path.GetTempPath(), "auxora-equalizer-tests-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(_root);
        _logger = new HostLogger(Path.Combine(_root, "logs"));
    }

    [TearDown]
    public void TearDown()
    {
        _logger.Dispose();
        if (Directory.Exists(_root))
        {
            Directory.Delete(_root, recursive: true);
        }
    }

    [Test]
    public void GetSnapshot_WhenEqualizerApoIsMissing_ReportsHonestSetupState()
    {
        var service = new EqualizerApoService(_logger, () => null);

        var snapshot = service.GetSnapshot();

        Assert.That(snapshot.Installed, Is.False);
        Assert.That(snapshot.Connected, Is.False);
        Assert.That(snapshot.Status, Is.EqualTo("missing"));
        Assert.That(snapshot.Bands, Has.Count.EqualTo(10));
    }

    [Test]
    public void EnableIntegration_AppendsOneIncludeAndCreatesManagedConfiguration()
    {
        var configPath = CreateEqualizerConfig("# Existing user configuration");
        var service = new EqualizerApoService(_logger, () => configPath);

        var first = service.EnableIntegration();
        var second = service.EnableIntegration();
        var mainConfiguration = File.ReadAllText(Path.Combine(configPath, "config.txt"));

        Assert.That(first.Connected, Is.True);
        Assert.That(second.Connected, Is.True);
        Assert.That(
            mainConfiguration.Split(EqualizerApoService.IncludeDirective).Length - 1,
            Is.EqualTo(1));
        Assert.That(File.Exists(Path.Combine(configPath, EqualizerApoService.ManagedFileName)), Is.True);
    }

    [Test]
    public void EnableIntegration_ReplacesOnlyTheUntouchedEqualizerApoDemoFilters()
    {
        const string stockConfiguration =
            "Preamp: -6 dB\n"
            + "Include: example.txt\n"
            + "GraphicEQ: 25 0; 40 0; 63 0; 100 0; 160 0; 250 0; 400 0; 630 0; 1000 0; 1600 0; 2500 0; 4000 0; 6300 0; 10000 0; 16000 0\n"
            + "# Auxora Equalizer - remove the next line to disconnect Auxora\n"
            + "Include: auxora.txt";
        var configPath = CreateEqualizerConfig(stockConfiguration);
        var service = new EqualizerApoService(_logger, () => configPath);

        var snapshot = service.EnableIntegration();
        var mainConfiguration = File.ReadAllText(Path.Combine(configPath, "config.txt"));

        Assert.That(snapshot.Connected, Is.True);
        Assert.That(mainConfiguration, Does.Contain(EqualizerApoService.IncludeDirective));
        Assert.That(mainConfiguration, Does.Not.Contain("Preamp: -6 dB"));
        Assert.That(mainConfiguration, Does.Not.Contain("Include: example.txt"));
        Assert.That(mainConfiguration, Does.Not.Contain("GraphicEQ: 25 0"));
    }

    [Test]
    public void EnableIntegration_PreservesCustomEqualizerApoFilters()
    {
        const string customConfiguration =
            "Preamp: -3 dB\n"
            + "Filter: ON PK Fc 80 Hz Gain 2 dB Q 1.0";
        var configPath = CreateEqualizerConfig(customConfiguration);
        var service = new EqualizerApoService(_logger, () => configPath);

        service.EnableIntegration();
        var mainConfiguration = File.ReadAllText(Path.Combine(configPath, "config.txt"));

        Assert.That(mainConfiguration, Does.Contain("Preamp: -3 dB"));
        Assert.That(mainConfiguration, Does.Contain("Filter: ON PK Fc 80 Hz Gain 2 dB Q 1.0"));
        Assert.That(mainConfiguration, Does.Contain(EqualizerApoService.IncludeDirective));
    }

    [Test]
    public void GetSnapshot_ReadsThePresetStoredInTheManagedFile()
    {
        var configPath = CreateEqualizerConfig(EqualizerApoService.IncludeDirective);
        File.WriteAllText(
            Path.Combine(configPath, EqualizerApoService.ManagedFileName),
            EqualizerApoService.BuildManagedConfiguration(
                "Gaming",
                bypassed: false,
                [3, 2, 0, -2, -1, 2, 4, 3, 1, 0]));
        var service = new EqualizerApoService(_logger, () => configPath);

        var snapshot = service.GetSnapshot();

        Assert.That(snapshot.Preset, Is.EqualTo("Gaming"));
        Assert.That(snapshot.Bands.Single(band => band.Frequency == 2000).Gain, Is.EqualTo(4));
    }

    [Test]
    public void Update_WithPreset_WritesGraphicEqAndAutomaticClippingProtection()
    {
        var configPath = CreateEqualizerConfig(EqualizerApoService.IncludeDirective);
        var service = new EqualizerApoService(_logger, () => configPath);

        var snapshot = service.Update(new EqualizerApoUpdateRequest { Preset = "Bass Boost" });
        var managedConfiguration = File.ReadAllText(Path.Combine(configPath, EqualizerApoService.ManagedFileName));

        Assert.That(snapshot.Status, Is.EqualTo("live"));
        Assert.That(snapshot.Preset, Is.EqualTo("Bass Boost"));
        Assert.That(snapshot.HeadroomDb, Is.EqualTo(-6));
        Assert.That(managedConfiguration, Does.Contain("Preamp: -6 dB"));
        Assert.That(managedConfiguration, Does.Contain("GraphicEQ: 31 6; 62 5;"));
    }

    [TestCase("Warm", 31, 3)]
    [TestCase("Bright", 16000, 6)]
    [TestCase("Late Night", 31, -4)]
    public void Update_WithExpandedPreset_AppliesTheExpectedSoundShape(
        string preset,
        int frequency,
        double expectedGain)
    {
        var configPath = CreateEqualizerConfig(EqualizerApoService.IncludeDirective);
        var service = new EqualizerApoService(_logger, () => configPath);

        var snapshot = service.Update(new EqualizerApoUpdateRequest { Preset = preset });

        Assert.That(snapshot.Preset, Is.EqualTo(preset));
        Assert.That(snapshot.Bands.Single(band => band.Frequency == frequency).Gain, Is.EqualTo(expectedGain));
    }

    [Test]
    public void Update_WhenBypassed_PreservesTheSelectedPreset()
    {
        var configPath = CreateEqualizerConfig(EqualizerApoService.IncludeDirective);
        var service = new EqualizerApoService(_logger, () => configPath);
        service.Update(new EqualizerApoUpdateRequest { Preset = "Voice" });

        var snapshot = service.Update(new EqualizerApoUpdateRequest { Bypassed = true });
        var managedConfiguration = File.ReadAllText(Path.Combine(configPath, EqualizerApoService.ManagedFileName));

        Assert.That(snapshot.Bypassed, Is.True);
        Assert.That(snapshot.Status, Is.EqualTo("bypassed"));
        Assert.That(snapshot.Preset, Is.EqualTo("Voice"));
        Assert.That(managedConfiguration, Does.Not.Contain("GraphicEQ:"));
    }

    [Test]
    public void Update_RejectsIncompleteCustomBands()
    {
        var configPath = CreateEqualizerConfig(EqualizerApoService.IncludeDirective);
        var service = new EqualizerApoService(_logger, () => configPath);

        Action update = () =>
            service.Update(new EqualizerApoUpdateRequest
            {
                Bands =
                [
                    new EqualizerBandRequest { Frequency = 31, Gain = 2 }
                ]
            });
        var error = Assert.Throws<InvalidOperationException>(update);

        Assert.That(error!.Message, Does.Contain("All 10"));
    }

    [Test]
    public void Update_RejectsDuplicateCustomBandFrequencies()
    {
        var configPath = CreateEqualizerConfig(EqualizerApoService.IncludeDirective);
        var service = new EqualizerApoService(_logger, () => configPath);

        Action update = () =>
            service.Update(new EqualizerApoUpdateRequest
            {
                Bands =
                [
                    new EqualizerBandRequest { Frequency = 31, Gain = 0 },
                    new EqualizerBandRequest { Frequency = 31, Gain = 1 },
                    new EqualizerBandRequest { Frequency = 62, Gain = 0 },
                    new EqualizerBandRequest { Frequency = 125, Gain = 0 },
                    new EqualizerBandRequest { Frequency = 250, Gain = 0 },
                    new EqualizerBandRequest { Frequency = 500, Gain = 0 },
                    new EqualizerBandRequest { Frequency = 1000, Gain = 0 },
                    new EqualizerBandRequest { Frequency = 2000, Gain = 0 },
                    new EqualizerBandRequest { Frequency = 4000, Gain = 0 },
                    new EqualizerBandRequest { Frequency = 8000, Gain = 0 }
                ]
            });
        var error = Assert.Throws<InvalidOperationException>(update);

        Assert.That(error!.Message, Does.Contain("exactly once"));
    }

    [Test]
    public void BuildManagedConfiguration_UsesOfficialGraphicEqShape()
    {
        var configuration = EqualizerApoService.BuildManagedConfiguration(
            "Custom",
            bypassed: false,
            [0, 1, 2, 3, 4, 5, 4, 3, 2, 1]);

        Assert.That(configuration, Does.Contain("Preamp: -5 dB"));
        Assert.That(configuration, Does.Contain("GraphicEQ: 31 0; 62 1; 125 2;"));
        Assert.That(configuration, Does.EndWith(Environment.NewLine));
    }

    private string CreateEqualizerConfig(string mainConfiguration)
    {
        var configPath = Path.Combine(_root, "EqualizerAPO", "config");
        Directory.CreateDirectory(configPath);
        File.WriteAllText(Path.Combine(configPath, "config.txt"), mainConfiguration + Environment.NewLine);
        return configPath;
    }
}
