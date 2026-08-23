using NUnit.Framework;

namespace XenonEdgeHost.Tests;

public sealed class NetworkMetricsServiceTests
{
    [Test]
    public void SelectPrimaryInterfaceId_PrefersWindowsRouteOverFasterVirtualAdapter()
    {
        var physical = Candidate("physical", ipv4Index: 12, hasGateway: true, speed: 2_500_000_000);
        var hyperV = Candidate("hyper-v", ipv4Index: 35, hasGateway: false, speed: 10_000_000_000);

        var selected = NetworkMetricsService.SelectPrimaryInterfaceId([hyperV, physical], bestRouteInterfaceIndex: 12);

        Assert.That(selected, Is.EqualTo(physical.Id));
    }

    [Test]
    public void SelectPrimaryInterfaceId_AllowsRoutedVpnWithoutGatewayToWin()
    {
        var physical = Candidate("physical", ipv4Index: 12, hasGateway: true, speed: 2_500_000_000);
        var vpn = Candidate("vpn", ipv4Index: 44, hasGateway: false, speed: 100_000_000);

        var selected = NetworkMetricsService.SelectPrimaryInterfaceId([physical, vpn], bestRouteInterfaceIndex: 44);

        Assert.That(selected, Is.EqualTo(vpn.Id));
    }

    [Test]
    public void SelectPrimaryInterfaceId_FallsBackToGatewayBeforeAdvertisedSpeed()
    {
        var physical = Candidate("physical", ipv4Index: 12, hasGateway: true, speed: 1_000_000_000);
        var virtualAdapter = Candidate("virtual", ipv4Index: 35, hasGateway: false, speed: 10_000_000_000);

        var selected = NetworkMetricsService.SelectPrimaryInterfaceId([virtualAdapter, physical], bestRouteInterfaceIndex: null);

        Assert.That(selected, Is.EqualTo(physical.Id));
    }

    [Test]
    public void SelectPrimaryInterfaceId_IgnoresAdaptersWithoutIpv4Address()
    {
        var disconnected = Candidate("disconnected", ipv4Index: 9, hasAddress: false, hasGateway: true, speed: 10_000_000_000);
        var active = Candidate("active", ipv4Index: 12, hasGateway: true, speed: 1_000_000_000);

        var selected = NetworkMetricsService.SelectPrimaryInterfaceId([disconnected, active], bestRouteInterfaceIndex: 9);

        Assert.That(selected, Is.EqualTo(active.Id));
    }

    private static NetworkAdapterCandidate Candidate(
        string id,
        int ipv4Index,
        bool hasGateway,
        long speed,
        bool hasAddress = true)
    {
        return new NetworkAdapterCandidate(id, ipv4Index, hasAddress, hasGateway, speed);
    }
}
