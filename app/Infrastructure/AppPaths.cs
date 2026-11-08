namespace XenonEdgeHost;

public static class AppPaths
{
    public const string ProductName = "Auxora";
    public const string LegacyProductDirectoryName = "XenonEdgeHost";
    public const string ProductDirectoryName = "Auxora";

    public static string RoamingDataDirectory => EnsureMigratedDirectory(ResolveDataRoot(
        Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
        Environment.GetEnvironmentVariable("AUXORA_TEST_ROAMING_ROOT"),
        IsTestDataRootEnabled()));

    public static string LocalDataDirectory => EnsureMigratedDirectory(ResolveDataRoot(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        Environment.GetEnvironmentVariable("AUXORA_TEST_LOCAL_ROOT"),
        IsTestDataRootEnabled()));

    internal static string EnsureMigratedDirectoryForRoot(string root) => EnsureMigratedDirectory(root);

    internal static string ResolveDataRoot(string fallbackRoot, string? testRoot, bool testRootsEnabled)
    {
        if (!testRootsEnabled)
        {
            return fallbackRoot;
        }

        if (string.IsNullOrWhiteSpace(testRoot))
        {
            throw new InvalidOperationException("Auxora test data roots are enabled but an explicit data root is missing.");
        }

        return Path.GetFullPath(testRoot);
    }

    private static bool IsTestDataRootEnabled() => string.Equals(
        Environment.GetEnvironmentVariable("AUXORA_ENABLE_TEST_DATA_ROOTS"),
        "1",
        StringComparison.Ordinal);

    private static string EnsureMigratedDirectory(string root)
    {
        var current = Path.Combine(root, ProductDirectoryName);
        var legacy = Path.Combine(root, LegacyProductDirectoryName);
        Directory.CreateDirectory(current);

        if (!Directory.Exists(legacy))
        {
            return current;
        }

        foreach (var relativePath in new[] { "config.json", "protected-secrets.json", Path.Combine("logs", "host.log") })
        {
            var source = Path.Combine(legacy, relativePath);
            var destination = Path.Combine(current, relativePath);
            if (!File.Exists(source) || File.Exists(destination))
            {
                continue;
            }

            var destinationDirectory = Path.GetDirectoryName(destination);
            if (!string.IsNullOrWhiteSpace(destinationDirectory))
            {
                Directory.CreateDirectory(destinationDirectory);
            }
            File.Copy(source, destination, overwrite: false);
        }

        return current;
    }
}
