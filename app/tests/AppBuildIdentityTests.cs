using NUnit.Framework;

namespace XenonEdgeHost.Tests;

public sealed class AppBuildIdentityTests
{
    [Test]
    public void ProductVersion_UsesCanonicalPrereleaseIdentity()
    {
        Assert.That(AppBuildIdentity.Version, Is.EqualTo("0.3.0-beta.1"));
    }

    [TestCase("stable", "0.3.0-beta.1", "beta")]
    [TestCase("beta", "0.3.0-beta.1", "beta")]
    [TestCase("nightly", "0.3.0-beta.1", "nightly")]
    [TestCase("stable", "0.3.0-nightly.4", "nightly")]
    [TestCase("stable", "0.3.0", "stable")]
    [TestCase("beta", "0.3.0", "beta")]
    public void NormalizeReleaseChannel_MatchesBuildKind(string requested, string version, string expected)
    {
        Assert.That(AppBuildIdentity.NormalizeReleaseChannel(requested, version), Is.EqualTo(expected));
    }
}
