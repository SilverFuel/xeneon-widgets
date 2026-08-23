using NUnit.Framework;
using System.Text.Json;

namespace XenonEdgeHost.Tests;

public sealed class LauncherPrivacyTests
{
    private string _root = "";
    private HostLogger? _logger;
    private ConfigStore? _configStore;

    [SetUp]
    public void SetUp()
    {
        _root = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            $"auxora-launcher-privacy-{Guid.NewGuid():N}");
        Directory.CreateDirectory(_root);
        _logger = new HostLogger(Path.Combine(_root, "logs"));
        _configStore = new ConfigStore(_logger, Path.Combine(_root, "config"));
    }

    [TearDown]
    public void TearDown()
    {
        _logger?.Dispose();
        try { Directory.Delete(_root, recursive: true); } catch { }
    }

    [Test]
    public void ForegroundTracking_DefaultOff_DoesNotPollOrPersist()
    {
        var providerCalls = 0;
        var recentPath = Path.Combine(_root, "recent-apps.json");
        using var service = new LauncherService(
            _logger!,
            _configStore!,
            recentPath,
            () =>
            {
                providerCalls++;
                return Path.Combine(_root, "observed.exe");
            },
            startTimer: false);

        service.CaptureForegroundAppForTest();
        var snapshot = service.GetSnapshot(_configStore!.Snapshot());

        Assert.Multiple((Action)(() =>
        {
            Assert.That(providerCalls, Is.Zero);
            Assert.That(File.Exists(recentPath), Is.False);
            Assert.That(snapshot.Source, Is.EqualTo("Auxora launchers"));
            Assert.That(snapshot.Message, Does.Contain("off"));
        }));
    }

    [Test]
    public void ForegroundTracking_OnPersistsAndTurningOffPurgesHistory()
    {
        var executable = Path.Combine(_root, "Observed Game.exe");
        File.WriteAllText(executable, "test");
        var recentPath = Path.Combine(_root, "recent-apps.json");
        using var service = new LauncherService(
            _logger!,
            _configStore!,
            recentPath,
            () => executable,
            startTimer: false);
        _configStore!.Update(config =>
        {
            config.Dashboard.ForegroundAppTrackingEnabled = true;
            return config;
        });

        service.CaptureForegroundAppForTest();
        Assert.That(File.Exists(recentPath), Is.True);

        var steam = new SteamService(_logger!);
        var provisioning = new ProvisioningService(_configStore, steam, _logger!);
        var controller = new ConfigController(_configStore, provisioning, service);
        controller.UpdateDashboard(new DashboardConfigRequest { ForegroundAppTrackingEnabled = false });

        Assert.Multiple((Action)(() =>
        {
            Assert.That(_configStore.Snapshot().Dashboard.ForegroundAppTrackingEnabled, Is.False);
            Assert.That(File.Exists(recentPath), Is.False);
            Assert.That(service.GetSnapshot(_configStore.Snapshot()).Entries, Is.Empty);
        }));
    }

    [Test]
    public void ForegroundTracking_InFlightCaptureCannotRepopulateAfterOptOut()
    {
        var executable = Path.Combine(_root, "Observed Race.exe");
        File.WriteAllText(executable, "test");
        var recentPath = Path.Combine(_root, "recent-apps.json");
        using var providerEntered = new ManualResetEventSlim(false);
        using var releaseProvider = new ManualResetEventSlim(false);
        using var service = new LauncherService(
            _logger!,
            _configStore!,
            recentPath,
            () =>
            {
                providerEntered.Set();
                Assert.That(releaseProvider.Wait(TimeSpan.FromSeconds(5)), Is.True);
                return executable;
            },
            startTimer: false);
        _configStore!.Update(config =>
        {
            config.Dashboard.ForegroundAppTrackingEnabled = true;
            return config;
        });

        var capture = Task.Run(service.CaptureForegroundAppForTest);
        Assert.That(providerEntered.Wait(TimeSpan.FromSeconds(5)), Is.True);
        var steam = new SteamService(_logger!);
        var provisioning = new ProvisioningService(_configStore, steam, _logger!);
        var controller = new ConfigController(_configStore, provisioning, service);
        controller.UpdateDashboard(new DashboardConfigRequest { ForegroundAppTrackingEnabled = false });
        releaseProvider.Set();
        Assert.That(capture.Wait(TimeSpan.FromSeconds(5)), Is.True);

        Assert.Multiple((Action)(() =>
        {
            Assert.That(_configStore.Snapshot().Dashboard.ForegroundAppTrackingEnabled, Is.False);
            Assert.That(File.Exists(recentPath), Is.False);
            Assert.That(service.GetSnapshot(_configStore.Snapshot()).Entries, Is.Empty);
        }));
    }

    [Test]
    public void ProvisioningPublicPayloads_OmitPrivateLauncherExecutionDetails()
    {
        var privatePath = Path.Combine(_root, "Browser", "private-profile", "browser.exe");
        var snapshot = new ProvisioningSnapshot
        {
            Supported = true,
            Configured = true,
            Status = "live",
            LauncherCount = 1,
            SuggestedLaunchers =
            [
                new ProvisioningLauncherSuggestionPayload
                {
                    Id = "browser-private",
                    DisplayName = "Private Browser",
                    Source = "Start Menu",
                    ExecutablePath = privatePath,
                    IconPath = privatePath,
                    Arguments = "--profile-directory=Private https://private.example.test",
                    Reason = "Trusted Start Menu shortcut",
                    Selected = true
                }
            ]
        };

        var summaryJson = JsonSerializer.Serialize(ProvisioningSummaryPayload.FromSnapshot(snapshot));
        var publicJson = JsonSerializer.Serialize(ProvisioningPublicSnapshot.FromSnapshot(snapshot));

        Assert.Multiple((Action)(() =>
        {
            Assert.That(summaryJson, Does.Not.Contain("SuggestedLaunchers"));
            Assert.That(summaryJson, Does.Not.Contain(privatePath));
            Assert.That(publicJson, Does.Contain("Private Browser"));
            Assert.That(publicJson, Does.Contain("Start Menu"));
            Assert.That(publicJson, Does.Not.Contain("ExecutablePath"));
            Assert.That(publicJson, Does.Not.Contain("IconPath"));
            Assert.That(publicJson, Does.Not.Contain("Arguments"));
            Assert.That(publicJson, Does.Not.Contain("Reason"));
            Assert.That(publicJson, Does.Not.Contain("Selected"));
            Assert.That(publicJson, Does.Not.Contain(privatePath));
            Assert.That(publicJson, Does.Not.Contain("private.example.test"));
        }));
    }
}
