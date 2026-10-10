using NUnit.Framework;

namespace XenonEdgeHost.Tests;

[TestFixture]
public sealed class ProgramTrayPolicyTests
{
    [TestCase(null)]
    [TestCase("")]
    [TestCase("0")]
    public void TrayIconRemainsEnabledWithoutExplicitTestSuppression(string? suppressionFlag)
    {
        Assert.That(Program.ResolveTrayIconCreation(suppressionFlag, string.Empty), Is.True);
    }

    [Test]
    public void TrayIconMayBeSuppressedForAnIsolatedTestInstance()
    {
        Assert.That(Program.ResolveTrayIconCreation("1", "-test-ABC123"), Is.False);
    }

    [TestCase(null)]
    [TestCase("")]
    [TestCase("   ")]
    public void TrayIconSuppressionFailsClosedOutsideAnIsolatedTestInstance(string? isolatedSuffix)
    {
        Assert.Throws<InvalidOperationException>((Action)(() => Program.ResolveTrayIconCreation("1", isolatedSuffix!)));
    }
}
