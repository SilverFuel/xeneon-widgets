using NUnit.Framework;
using System.Diagnostics;

namespace XenonEdgeHost.Tests;

public sealed class RecoveryServiceTests
{
    private string _root = "";
    private HostLogger? _logger;

    [SetUp]
    public void SetUp()
    {
        _root = Path.Combine(Path.GetTempPath(), $"auxora-recovery-{Guid.NewGuid():N}");
        Directory.CreateDirectory(_root);
        _logger = new HostLogger(Path.Combine(_root, "logs"));
    }

    [TearDown]
    public void TearDown()
    {
        _logger?.Dispose();
        try { Directory.Delete(_root, recursive: true); } catch { }
    }

    [Test]
    public void DevelopmentRun_TruthfullyDisablesActionsThatNeedInstalledScripts()
    {
        var service = new RecoveryService(_logger!, Path.Combine(_root, "dev output"), new RecordingLauncher());
        var snapshot = service.GetSnapshot();

        Assert.Multiple((Action)(() =>
        {
            Assert.That(snapshot.Actions.Single(action => action.Id == "retry").Available, Is.True);
            Assert.That(snapshot.Actions.Single(action => action.Id == "repair").Available, Is.False);
            Assert.That(snapshot.Actions.Single(action => action.Id == "safe-mode").Available, Is.False);
            Assert.That(snapshot.Actions.Single(action => action.Id == "repair").Message, Does.Contain("unpackaged development run"));
            Assert.That(service.Execute("repair").Ok, Is.False);
        }));
    }

    [Test]
    public void InstalledRepair_UsesFixedExecutableAndSeparatedArguments()
    {
        var installDirectory = Path.Combine(_root, "Installed Auxora");
        Directory.CreateDirectory(installDirectory);
        var repairScript = Path.Combine(installDirectory, "repair.ps1");
        File.WriteAllText(repairScript, "# test");
        File.WriteAllText(Path.Combine(installDirectory, "Launch-XenonSafeMode.ps1"), "# test");
        var launcher = new RecordingLauncher();
        var service = new RecoveryService(_logger!, installDirectory, launcher);

        var result = service.Execute("repair");
        var started = launcher.Started.Single();

        Assert.Multiple((Action)(() =>
        {
            Assert.That(result.Ok, Is.True);
            Assert.That(started.UseShellExecute, Is.False);
            Assert.That(started.FileName, Does.EndWith("powershell.exe").IgnoreCase);
            Assert.That(started.ArgumentList, Does.Contain("-File"));
            Assert.That(started.ArgumentList, Does.Contain(repairScript));
            Assert.That(started.Arguments, Is.Empty);
        }));
    }

    private sealed class RecordingLauncher : IRecoveryProcessLauncher
    {
        public List<ProcessStartInfo> Started { get; } = [];

        public void Start(ProcessStartInfo startInfo)
        {
            Started.Add(startInfo);
        }
    }
}
