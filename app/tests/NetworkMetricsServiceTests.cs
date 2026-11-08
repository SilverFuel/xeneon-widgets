using NUnit.Framework;

namespace XenonEdgeHost.Tests;

public sealed class NetworkMetricsServiceTests
{
    private static readonly DateTimeOffset SampleTime = new(2026, 11, 8, 0, 0, 0, TimeSpan.Zero);

    [Test]
    public void ThroughputRequiresTwoReadableSamplesAndPreservesMeasuredZero()
    {
        var counter = new NetworkThroughputCounter();
        Assert.That(counter.Sample("ethernet", 100, 200, SampleTime), Is.EqualTo(((double?)null, (double?)null)));
        Assert.That(counter.Sample("ethernet", 250100, 200, SampleTime.AddSeconds(2)), Is.EqualTo(((double?)1, (double?)0)));
    }

    [Test]
    public void UnreadableCountersRequireFreshBaselineAfterRecovery()
    {
        var counter = new NetworkThroughputCounter();
        counter.Sample("ethernet", 100, 200, SampleTime);
        Assert.That(counter.Sample("ethernet", null, null, SampleTime.AddSeconds(2)), Is.EqualTo(((double?)null, (double?)null)));
        Assert.That(counter.Sample("ethernet", 1000000, 2000000, SampleTime.AddSeconds(4)), Is.EqualTo(((double?)null, (double?)null)));
        Assert.That(counter.Sample("ethernet", 1250000, 2500000, SampleTime.AddSeconds(6)), Is.EqualTo(((double?)1, (double?)2)));
    }

    [Test]
    public void InterfaceSwitchAndCounterResetLeaveGapsInsteadOfArtificialZero()
    {
        var counter = new NetworkThroughputCounter();
        counter.Sample("ethernet", 1000000, 2000000, SampleTime);
        Assert.That(counter.Sample("wifi", 500, 700, SampleTime.AddSeconds(2)), Is.EqualTo(((double?)null, (double?)null)));
        Assert.That(counter.Sample("wifi", 100, 200, SampleTime.AddSeconds(4)), Is.EqualTo(((double?)null, (double?)null)));
        Assert.That(counter.Sample("wifi", 250100, 500200, SampleTime.AddSeconds(6)), Is.EqualTo(((double?)1, (double?)2)));
    }

    [TestCase(0)]
    [TestCase(-2)]
    public void NonIncreasingSampleTimeCannotProduceThroughputSpike(int seconds)
    {
        var counter = new NetworkThroughputCounter();
        counter.Sample("ethernet", 100, 200, SampleTime);
        Assert.That(counter.Sample("ethernet", 250100, 500200, SampleTime.AddSeconds(seconds)), Is.EqualTo(((double?)null, (double?)null)));
    }

    [Test]
    public void SnapshotKeepsThroughputTimestampIndependentFromPingUpdates()
    {
        var snapshot = new NetworkSnapshot { SampledAt = SampleTime.AddSeconds(20), ThroughputSampledAt = SampleTime };
        var copy = snapshot.Clone();
        Assert.That(copy.ThroughputSampledAt, Is.EqualTo(SampleTime));
        Assert.That(copy.SampledAt, Is.EqualTo(SampleTime.AddSeconds(20)));
    }

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
