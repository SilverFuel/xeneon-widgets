using NUnit.Framework;

namespace XenonEdgeHost.Tests;

public sealed class AppPathsTests
{
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
