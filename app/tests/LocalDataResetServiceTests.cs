using NUnit.Framework;

namespace XenonEdgeHost.Tests;

public sealed class LocalDataResetServiceTests
{
    private string _root = "";
    private HostLogger? _logger;

    [SetUp]
    public void SetUp()
    {
        _root = Path.Combine(Path.GetTempPath(), $"auxora-reset-{Guid.NewGuid():N}");
        Directory.CreateDirectory(_root);
        _logger = new HostLogger(Path.Combine(_root, "logs"));
    }

    [TearDown]
    public void TearDown()
    {
        _logger?.Dispose();
        try
        {
            foreach (var file in Directory.EnumerateFiles(_root, "*", SearchOption.AllDirectories))
            {
                File.SetAttributes(file, FileAttributes.Normal);
            }
            Directory.Delete(_root, recursive: true);
        }
        catch { }
    }

    [Test]
    public async Task ResetAll_ClearsEveryClaimedRequiredStoreAndReturnsReceipt()
    {
        var configDirectory = Path.Combine(_root, "config");
        var recentPath = Path.Combine(_root, "recent-apps.json");
        var telemetryDirectory = Path.Combine(_root, "telemetry");
        var legacyRoaming = Path.Combine(_root, "legacy-roaming");
        var legacyLocal = Path.Combine(_root, "legacy-local");
        var executable = Path.Combine(_root, "Observed.exe");
        File.WriteAllText(executable, "test");
        var store = new ConfigStore(_logger!, configDirectory);
        store.Update(config =>
        {
            config.Weather.ApiKey = "weather-secret";
            config.Calendar.IcsUrl = "https://calendar.example/private.ics";
            config.Dashboard.ForegroundAppTrackingEnabled = true;
            return config;
        });
        using var launcher = new LauncherService(_logger!, store, recentPath, () => executable, startTimer: false);
        launcher.CaptureForegroundAppForTest();
        Directory.CreateDirectory(telemetryDirectory);
        File.WriteAllText(Path.Combine(telemetryDirectory, "presentmon-test.csv"), "telemetry");
        using var performance = new GamePerformanceService(_logger!, store, telemetryDirectory);
        Directory.CreateDirectory(legacyRoaming);
        Directory.CreateDirectory(Path.Combine(legacyLocal, "Telemetry"));
        Directory.CreateDirectory(Path.Combine(legacyLocal, "logs"));
        File.WriteAllText(Path.Combine(legacyRoaming, "config.json"), "{}");
        File.WriteAllText(Path.Combine(legacyRoaming, "protected-secrets.json"), "{}");
        File.WriteAllText(Path.Combine(legacyLocal, "recent-apps.json"), "{}");
        File.WriteAllText(Path.Combine(legacyLocal, "Telemetry", "presentmon-old.csv"), "old");
        File.WriteAllText(Path.Combine(legacyLocal, "logs", "host.log"), "old log");
        _logger!.Info("delete me");
        var runtimeClearCalls = 0;
        var service = new LocalDataResetService(store, launcher, performance, _logger, legacyRoaming, legacyLocal, () => runtimeClearCalls++);
        var browserClearCalls = 0;
        service.SetBrowserDataClearer(_ =>
        {
            browserClearCalls++;
            return Task.FromResult(new ResetStepReceipt
            {
                Id = "webview-data",
                Label = "WebView browsing data",
                Required = false,
                Status = "cleared",
                Message = "Cleared test profile."
            });
        });

        var receipt = await service.ResetAllAsync(CancellationToken.None);
        var reset = store.Snapshot();

        Assert.Multiple((Action)(() =>
        {
            Assert.That(receipt.Ok, Is.True);
            Assert.That(receipt.Steps.Where(step => step.Required).Select(step => step.Status), Is.All.EqualTo("cleared"));
            Assert.That(browserClearCalls, Is.EqualTo(1));
            Assert.That(runtimeClearCalls, Is.EqualTo(1));
            Assert.That(reset.Weather.ApiKey, Is.Empty);
            Assert.That(reset.Calendar.IcsUrl, Is.Empty);
            Assert.That(reset.Dashboard.ForegroundAppTrackingEnabled, Is.False);
            Assert.That(File.Exists(recentPath), Is.False);
            Assert.That(Directory.EnumerateFiles(telemetryDirectory, "presentmon-*.csv"), Is.Empty);
            Assert.That(File.Exists(Path.Combine(legacyRoaming, "config.json")), Is.False);
            Assert.That(File.Exists(Path.Combine(legacyRoaming, "protected-secrets.json")), Is.False);
            Assert.That(File.Exists(Path.Combine(legacyLocal, "recent-apps.json")), Is.False);
            Assert.That(File.Exists(Path.Combine(legacyLocal, "Telemetry", "presentmon-old.csv")), Is.False);
            Assert.That(File.Exists(_logger.LogPath), Is.False);
        }));
    }

    [Test]
    public async Task ResetAll_RequiredDeletionFailureIsVisibleAndFailsReceipt()
    {
        var store = new ConfigStore(_logger!, Path.Combine(_root, "config"));
        var recentPath = Path.Combine(_root, "recent-apps.json");
        var telemetryDirectory = Path.Combine(_root, "telemetry");
        using var launcher = new LauncherService(_logger!, store, recentPath, () => null, startTimer: false);
        using var performance = new GamePerformanceService(_logger!, store, telemetryDirectory);
        var legacyRoaming = Path.Combine(_root, "legacy-roaming");
        var legacyLocal = Path.Combine(_root, "legacy-local");
        Directory.CreateDirectory(legacyRoaming);
        var blocked = Path.Combine(legacyRoaming, "config.json");
        File.WriteAllText(blocked, "{}");
        File.SetAttributes(blocked, FileAttributes.ReadOnly);
        var service = new LocalDataResetService(store, launcher, performance, _logger!, legacyRoaming, legacyLocal);

        var receipt = await service.ResetAllAsync(CancellationToken.None);
        var failed = receipt.Steps.Single(step => step.Id == "legacy-data");

        Assert.Multiple((Action)(() =>
        {
            Assert.That(receipt.Ok, Is.False);
            Assert.That(receipt.Status, Is.EqualTo("failed"));
            Assert.That(failed.Required, Is.True);
            Assert.That(failed.Status, Is.EqualTo("failed"));
            Assert.That(File.Exists(blocked), Is.True);
        }));
    }
}
