using NUnit.Framework;

namespace XenonEdgeHost.Tests;

public sealed class AppPathsTests
{
    [Test]
    public void TestDataRootOverride_IsExplicitAndFailsClosedWhenIncomplete()
    {
        var fallback = Path.Combine(Path.GetTempPath(), "fallback-root");
        var requested = Path.Combine(Path.GetTempPath(), "isolated-root", "..");

        Assert.Multiple((Action)(() =>
        {
            Assert.That(AppPaths.ResolveDataRoot(fallback, requested, false), Is.EqualTo(fallback));
            Assert.That(AppPaths.ResolveDataRoot(fallback, requested, true), Is.EqualTo(Path.GetFullPath(requested)));
            Assert.Throws<InvalidOperationException>((Action)(() => AppPaths.ResolveDataRoot(fallback, "", true)));
        }));
    }

    [Test]
    public void IsolatedTestInstanceSuffix_RequiresExplicitRootsAndIdentity()
    {
        const string enabled = "1";
        const string roaming = "C:\\temp\\roaming";
        const string local = "C:\\temp\\local";
        const string instanceId = "rendered-dashboard-123";

        var first = Program.ResolveIsolatedTestInstanceSuffix(enabled, roaming, local, instanceId);
        var second = Program.ResolveIsolatedTestInstanceSuffix(enabled, roaming, local, instanceId);

        Assert.Multiple((Action)(() =>
        {
            Assert.That(Program.ResolveIsolatedTestInstanceSuffix(null, roaming, local, instanceId), Is.Empty);
            Assert.That(Program.ResolveIsolatedTestInstanceSuffix(enabled, "", local, instanceId), Is.Empty);
            Assert.That(Program.ResolveIsolatedTestInstanceSuffix(enabled, roaming, local, ""), Is.Empty);
            Assert.That(first, Does.Match("^-test-[0-9A-F]{16}$"));
            Assert.That(second, Is.EqualTo(first));
            Assert.That(Program.ResolveIsolatedTestInstanceSuffix(enabled, roaming, local, "different-run"), Is.Not.EqualTo(first));
        }));
    }

    [Test]
    public void DashboardUri_UsesItsConfiguredLocalOriginForTheBridge()
    {
        var baseUri = new Uri("http://127.0.0.1:54321/");
        var dashboard = BridgeManager.BuildDashboardUri(baseUri, "20260818-01", advanced: false);
        var settings = BridgeManager.BuildDashboardUri(baseUri, "20260818-01", advanced: true);

        Assert.Multiple((Action)(() =>
        {
            Assert.That(dashboard.GetLeftPart(UriPartial.Path), Is.EqualTo("http://127.0.0.1:54321/dashboard.html"));
            Assert.That(dashboard.Query, Is.EqualTo("?bridge=http%3A%2F%2F127.0.0.1%3A54321&v=20260818-01"));
            Assert.That(settings.Query, Is.EqualTo("?advanced=1&bridge=http%3A%2F%2F127.0.0.1%3A54321&v=20260818-01"));
        }));
    }

    [Test]
    public void Migration_CopiesLegacySettingsWithoutDeletingRollbackData()
    {
        var root = Path.Combine(Path.GetTempPath(), $"auxora-path-tests-{Guid.NewGuid():N}");
        var legacy = Path.Combine(root, AppPaths.LegacyProductDirectoryName);
        Directory.CreateDirectory(legacy);
        File.WriteAllText(Path.Combine(legacy, "config.json"), "{\"port\":9876}");

        try
        {
            var migrated = AppPaths.EnsureMigratedDirectoryForRoot(root);

            Assert.That(migrated, Is.EqualTo(Path.Combine(root, AppPaths.ProductDirectoryName)));
            Assert.That(File.ReadAllText(Path.Combine(migrated, "config.json")), Does.Contain("9876"));
            Assert.That(File.Exists(Path.Combine(legacy, "config.json")), Is.True, "legacy data is retained for rollback");
        }
        finally
        {
            try { Directory.Delete(root, recursive: true); } catch { }
        }
    }
}
