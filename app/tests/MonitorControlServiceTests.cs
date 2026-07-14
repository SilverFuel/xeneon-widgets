using NUnit.Framework;
using XenonEdgeHost;

namespace XenonEdgeHost.Tests;

public sealed class MonitorControlServiceTests
{
    [Test]
    public void ParseVcpCapabilities_ReturnsOnlyTopLevelControlCodes()
    {
        var result = MonitorControlService.ParseVcpCapabilities(
            "(prot(monitor)type(LCD)vcp(10 12 60(01 03 11) D6(01 04)))");

        Assert.That(result, Is.EquivalentTo(new byte[] { 0x10, 0x12, 0x60, 0xD6 }));
    }

    [Test]
    public void ParseVcpCapabilities_RejectsMalformedCapabilityStrings()
    {
        var result = MonitorControlService.ParseVcpCapabilities("vcp(10 12");

        Assert.That(result, Is.Null);
    }

    [TestCase(0, 255, 0)]
    [TestCase(50, 255, 128)]
    [TestCase(100, 255, 255)]
    [TestCase(200, 80, 80)]
    public void ScalePercentage_UsesTheMonitorMaximum(int percentage, int maximum, int expected)
    {
        Assert.That(MonitorControlService.ScalePercentage(percentage, (uint)maximum), Is.EqualTo((uint)expected));
    }
}
