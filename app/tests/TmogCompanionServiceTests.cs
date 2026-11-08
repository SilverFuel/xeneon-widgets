using System.Text.Json;
using NUnit.Framework;

namespace XenonEdgeHost.Tests;

[TestFixture]
public sealed class TmogCompanionServiceTests
{
    [TestCase(125000L, 1d, 1d)]
    [TestCase(125000000L, 1d, 1000d)]
    [TestCase(250000L, 2d, 1d)]
    [TestCase(0L, 1d, 0d)]
    public void NetworkRateUsesDecimalMegabits(long bytes, double seconds, double expected)
    {
        Assert.That(NetworkMetricsService.RoundMbps(bytes, seconds), Is.EqualTo(expected));
    }

    private static readonly string Root = Path.Combine(Path.GetTempPath(), "auxora-tmog-fixture");
    private static readonly string Launcher = Path.Combine(Root, "Task Manager TMOG", "Task Manager Launcher.exe");
    private static readonly string App = Path.Combine(Root, "Task Manager TMOG", "Task Manager.exe");

    [Test]
    public void DiscoveryPrefersInstalledLauncherAndDoesNotLaunchOnRead()
    {
        var launched = new List<string>();
        var service = new TmogCompanionService([Root], _ => "1.1.1.0", launched.Add);
        var snapshot = service.GetSnapshot();
        Assert.That(snapshot.Installed, Is.True);
        Assert.That(snapshot.Version, Is.EqualTo("1.1.1.0"));
        Assert.That(launched, Is.Empty);
        service.Open();
        Assert.That(launched, Is.EqualTo(new[] { Launcher }));
    }

    [Test]
    public void LaunchFallsBackToVerifiedMainExecutable()
    {
        var launched = new List<string>();
        var service = new TmogCompanionService([Root], path => path == App ? "1.1.1.0" : null, launched.Add);
        service.Open();
        Assert.That(launched, Is.EqualTo(new[] { App }));
    }

    [Test]
    public void MissingInstallationDoesNotInvokeLauncher()
    {
        var service = new TmogCompanionService([Root], _ => null, _ => Assert.Fail("Unexpected launch"));
        Assert.That(service.GetSnapshot().Installed, Is.False);
        Assert.Throws<InvalidOperationException>((Action)(() => service.Open()));
    }

    [Test]
    public void InstallationIsRecheckedWhenOpening()
    {
        var installed = true;
        var service = new TmogCompanionService([Root], _ => installed ? "1.1.1.0" : null, _ => Assert.Fail("Stale installation launched"));
        Assert.That(service.GetSnapshot().Installed, Is.True);
        installed = false;
        Assert.Throws<InvalidOperationException>((Action)(() => service.Open()));
    }

    [Test]
    public void InaccessibleInstallationIsUnavailable()
    {
        var service = new TmogCompanionService([Root], _ => throw new UnauthorizedAccessException(), _ => Assert.Fail("Unexpected launch"));
        Assert.That(service.GetSnapshot().Installed, Is.False);
    }

    [Test]
    public void DiscoveryDoesNotExposeInstallationPathsOrLicenceData()
    {
        var service = new TmogCompanionService([Root], _ => "1.1.1.0", _ => { });
        var json = JsonSerializer.Serialize(service.GetSnapshot(), new JsonSerializerOptions(JsonSerializerDefaults.Web));
        Assert.That(json, Does.Not.Contain(Root).And.Not.Contain("executablePath").And.Not.Contain("license"));
    }

    [Test]
    public void SystemSnapshotPreservesCapacityThroughputAndSensorTimestamp()
    {
        var original = new SystemSnapshot
        {
            Cpu = null, Ram = 0, MemoryUsedBytes = 0, MemoryTotalBytes = 64000,
            DiskReadBytesPerSecond = null, DiskWriteBytesPerSecond = 0,
            TemperatureSampledAt = DateTimeOffset.UtcNow
        };
        var copy = original.Clone();
        Assert.That(copy.Cpu, Is.Null);
        Assert.That(copy.Ram, Is.EqualTo(0));
        Assert.That(copy.MemoryUsedBytes, Is.EqualTo(0));
        Assert.That(copy.MemoryTotalBytes, Is.EqualTo(64000));
        Assert.That(copy.DiskReadBytesPerSecond, Is.Null);
        Assert.That(copy.DiskWriteBytesPerSecond, Is.EqualTo(0));
        Assert.That(copy.TemperatureSampledAt, Is.EqualTo(original.TemperatureSampledAt));
    }
}
