using NUnit.Framework;
using System.Net;
using System.Net.NetworkInformation;
using System.Net.Sockets;
using System.Text.Json;

namespace XenonEdgeHost.Tests;

public sealed class RemoteSessionServiceTests
{
    private string _tempDirectory = "";
    private HostLogger? _logger;

    [SetUp]
    public void SetUp()
    {
        _tempDirectory = Path.Combine(Path.GetTempPath(), $"auxora-remote-security-tests-{Guid.NewGuid():N}");
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
    public void Start_RemainsUnavailableAndDoesNotBindLanListener()
    {
        var remotePort = FindUnusedPort();
        using var service = CreateService(remotePort - 1);

        var snapshot = Snapshot(service.Start());

        Assert.That(RemoteSessionService.EnabledForCurrentBeta, Is.False);
        Assert.That(snapshot.GetProperty("supported").GetBoolean(), Is.False);
        Assert.That(snapshot.GetProperty("active").GetBoolean(), Is.False);
        Assert.That(snapshot.GetProperty("status").GetString(), Is.EqualTo("unavailable"));
        Assert.That(snapshot.GetProperty("url").GetString(), Is.Empty);
        Assert.That(snapshot.GetProperty("qrSvg").GetString(), Is.Empty);
        Assert.That(IPGlobalProperties.GetIPGlobalProperties().GetActiveTcpListeners().Select(endpoint => endpoint.Port), Does.Not.Contain(remotePort));
    }

    [Test]
    public void Snapshot_ContainsNoBearerCredentialMaterial()
    {
        using var service = CreateService(8976);

        var json = JsonSerializer.Serialize(service.GetSnapshot());

        Assert.That(json, Does.Not.Contain("token").IgnoreCase);
        Assert.That(json, Does.Not.Contain("http://").IgnoreCase);
        Assert.That(json, Does.Not.Contain("<svg").IgnoreCase);
    }

    private RemoteSessionService CreateService(int dashboardPort)
    {
        var configStore = new ConfigStore(_logger!, Path.Combine(_tempDirectory, "config"));
        var sceneService = new SceneService(configStore);
        var actionChains = new ActionChainService(sceneService, new SystemActionsService(_logger!));
        return new RemoteSessionService(sceneService, actionChains, _logger!, dashboardPort);
    }

    private static JsonElement Snapshot(object payload)
    {
        using var document = JsonDocument.Parse(JsonSerializer.Serialize(payload));
        return document.RootElement.Clone();
    }

    private static int FindUnusedPort()
    {
        using var listener = new TcpListener(IPAddress.Loopback, 0);
        listener.Start();
        return ((IPEndPoint)listener.LocalEndpoint).Port;
    }
}
