using NUnit.Framework;

namespace XenonEdgeHost.Tests;

public sealed class ConfigStoreSecurityTests
{
    private string _tempDirectory = "";
    private HostLogger? _logger;

    [SetUp]
    public void SetUp()
    {
        _tempDirectory = Path.Combine(Path.GetTempPath(), $"auxora-config-security-tests-{Guid.NewGuid():N}");
        Directory.CreateDirectory(_tempDirectory);
        _logger = new HostLogger(Path.Combine(_tempDirectory, "logs"));
    }

    [TearDown]
    public void TearDown()
    {
        _logger?.Dispose();
        try { Directory.Delete(_tempDirectory, recursive: true); } catch { }
    }

    [Test]
    public void PlaintextCalendarUrl_IsMigratedToProtectedStorageAndRemovedFromConfig()
    {
        const string calendarUrl = "https://calendar.example/private.ics?token=secret-value";
        var configDirectory = Path.Combine(_tempDirectory, "config");
        Directory.CreateDirectory(configDirectory);
        File.WriteAllText(
            Path.Combine(configDirectory, "config.json"),
            """
            {
              "calendar": {
                "icsUrl": "https://calendar.example/private.ics?token=secret-value"
              }
            }
            """);

        var store = new ConfigStore(_logger!, configDirectory);

        Assert.That(store.Snapshot().Calendar.IcsUrl, Is.EqualTo(calendarUrl));
        Assert.That(File.ReadAllText(Path.Combine(configDirectory, "config.json")), Does.Not.Contain(calendarUrl));
        var protectedSecrets = File.ReadAllText(Path.Combine(configDirectory, "protected-secrets.json"));
        Assert.That(protectedSecrets, Does.Contain("calendar.icsUrl"));
        Assert.That(protectedSecrets, Does.Not.Contain(calendarUrl));
    }

    [Test]
    public void ResetLocalData_ClearsProtectedCalendarUrl()
    {
        const string calendarUrl = "https://calendar.example/private.ics?token=reset-me";
        var configDirectory = Path.Combine(_tempDirectory, "config");
        var store = new ConfigStore(_logger!, configDirectory);
        store.Update(config =>
        {
            config.Calendar.IcsUrl = calendarUrl;
            return config;
        });

        var reset = store.ResetLocalData();

        Assert.That(reset.Calendar.IcsUrl, Is.Empty);
        Assert.That(File.ReadAllText(Path.Combine(configDirectory, "config.json")), Does.Not.Contain(calendarUrl));
        var protectedSecrets = File.ReadAllText(Path.Combine(configDirectory, "protected-secrets.json"));
        Assert.That(protectedSecrets, Does.Not.Contain("calendar.icsUrl"));
        Assert.That(protectedSecrets, Does.Not.Contain(calendarUrl));
    }

    [Test]
    public void PlaintextFrigatePassword_IsMigratedToProtectedStorageAndRemovedFromConfig()
    {
        const string password = "legacy-frigate-password";
        var configDirectory = Path.Combine(_tempDirectory, "frigate-config");
        Directory.CreateDirectory(configDirectory);
        File.WriteAllText(
            Path.Combine(configDirectory, "config.json"),
            """
            {
              "frigate": {
                "baseUrl": "https://192.168.1.50:8971/",
                "camera": "driveway",
                "username": "viewer",
                "password": "legacy-frigate-password"
              }
            }
            """);

        var store = new ConfigStore(_logger!, configDirectory);

        Assert.That(store.Snapshot().Frigate.Password, Is.EqualTo(password));
        Assert.That(File.ReadAllText(Path.Combine(configDirectory, "config.json")), Does.Not.Contain(password));
        var protectedSecrets = File.ReadAllText(Path.Combine(configDirectory, "protected-secrets.json"));
        Assert.That(protectedSecrets, Does.Contain("frigate.password"));
        Assert.That(protectedSecrets, Does.Not.Contain(password));
    }

    [Test]
    public void ObsoleteAutomaticRollbackMetadata_IsDroppedDuringConfigurationLoad()
    {
        var configDirectory = Path.Combine(_tempDirectory, "rollback-config");
        Directory.CreateDirectory(configDirectory);
        File.WriteAllText(
            Path.Combine(configDirectory, "config.json"),
            """
            {
              "dashboard": {
                "releaseChannel": "beta",
                "updateRollbackEnabled": true,
                "lastKnownGoodVersion": "0.3.0.0",
                "lastKnownGoodPath": "C:\\fake\\XenonEdgeHost.exe"
              }
            }
            """);

        var store = new ConfigStore(_logger!, configDirectory);
        var saved = File.ReadAllText(Path.Combine(configDirectory, "config.json"));

        Assert.That(store.Snapshot().Dashboard.ReleaseChannel, Is.EqualTo("beta"));
        Assert.That(saved, Does.Not.Contain("updateRollbackEnabled"));
        Assert.That(saved, Does.Not.Contain("lastKnownGoodVersion"));
        Assert.That(saved, Does.Not.Contain("lastKnownGoodPath"));
        Assert.That(saved, Does.Not.Contain("XenonEdgeHost.exe"));
    }
}
