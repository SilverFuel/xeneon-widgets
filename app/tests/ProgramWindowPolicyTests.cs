using NUnit.Framework;

namespace XenonEdgeHost.Tests;

[TestFixture]
public sealed class ProgramWindowPolicyTests
{
    [TestCase(null)]
    [TestCase("")]
    [TestCase("0")]
    public void WindowRemainsVisibleWithoutExplicitTestSuppression(string? suppressionFlag)
    {
        Assert.That(Program.ResolveWindowSuppression(suppressionFlag, string.Empty), Is.False);
    }

    [Test]
    public void WindowMayBeSuppressedForAnIsolatedTestInstance()
    {
        Assert.That(Program.ResolveWindowSuppression("1", "-test-ABC123"), Is.True);
    }

    [TestCase(null)]
    [TestCase("")]
    [TestCase("   ")]
    public void WindowSuppressionFailsClosedOutsideAnIsolatedTestInstance(string? isolatedSuffix)
    {
        Assert.Throws<InvalidOperationException>((Action)(() => Program.ResolveWindowSuppression("1", isolatedSuffix!)));
    }

    [Test]
    public void ProductionWebViewProfileRetainsLegacyLocation()
    {
        var productionRoot = Path.Combine(Path.GetTempPath(), "production-local");
        var isolatedRoot = Path.Combine(Path.GetTempPath(), "isolated-local", "Auxora");

        Assert.That(
            MainWindow.ResolveWebViewUserDataPath(false, productionRoot, isolatedRoot),
            Is.EqualTo(Path.Combine(productionRoot, "XenonEdgeHost", "WebView2")));
    }

    [Test]
    public void SuppressedWindowUsesOnlyIsolatedWebViewProfile()
    {
        var productionRoot = Path.Combine(Path.GetTempPath(), "production-local");
        var isolatedRoot = Path.Combine(Path.GetTempPath(), "isolated-local", "Auxora");

        Assert.That(
            MainWindow.ResolveWebViewUserDataPath(true, productionRoot, isolatedRoot),
            Is.EqualTo(Path.Combine(isolatedRoot, "WebView2")));
    }

    [TestCase(null)]
    [TestCase("")]
    [TestCase("   ")]
    public void SuppressedWindowFailsClosedWithoutIsolatedWebViewProfile(string? isolatedRoot)
    {
        Assert.Throws<InvalidOperationException>((Action)(() =>
            MainWindow.ResolveWebViewUserDataPath(true, Path.GetTempPath(), isolatedRoot)));
    }
}
