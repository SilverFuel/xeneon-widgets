namespace XenonEdgeHost;

public static class AppPaths
{
    public const string ProductName = "Auxora";
    public const string LegacyProductDirectoryName = "XenonEdgeHost";
    public const string ProductDirectoryName = "Auxora";

    public static string RoamingDataDirectory => EnsureMigratedDirectory(
        Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData));

    public static string LocalDataDirectory => EnsureMigratedDirectory(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData));

    internal static string EnsureMigratedDirectoryForRoot(string root) => EnsureMigratedDirectory(root);

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
