using Microsoft.Win32;

namespace XenonEdgeHost;

public sealed record WebViewRuntimeInfo(
    bool IsAvailable,
    bool IsFixedVersion,
    bool RequiresWindows10Permissions,
    string? RuntimePath,
    string? Version,
    string Summary)
{
    public static WebViewRuntimeInfo Unchecked { get; } = new(
        IsAvailable: false,
        IsFixedVersion: false,
        RequiresWindows10Permissions: false,
        RuntimePath: null,
        Version: null,
        Summary: "WebView2 runtime has not been checked yet.");
}

public static class WebViewRuntimeLocator
{
    private const string WebViewRuntimeClientId = "{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}";

    public static WebViewRuntimeInfo Configure(HostLogger logger)
    {
        var fixedRuntimePath = FindFixedRuntimePath(AppContext.BaseDirectory);
        if (!string.IsNullOrWhiteSpace(fixedRuntimePath))
        {
            Environment.SetEnvironmentVariable("WEBVIEW2_BROWSER_EXECUTABLE_FOLDER", fixedRuntimePath);

            var version = InferVersionFromPath(fixedRuntimePath);
            var requiresWindows10Permissions = IsWindows10();
            var summary = version is null
                ? $"Using bundled fixed WebView2 runtime from {fixedRuntimePath}."
                : $"Using bundled fixed WebView2 runtime {version} from {fixedRuntimePath}.";

            if (requiresWindows10Permissions)
            {
                summary += " Windows 10 unpackaged apps need FixedRuntime folder AppContainer read permissions.";
            }

            logger.Info(summary);
            return new WebViewRuntimeInfo(
                IsAvailable: true,
                IsFixedVersion: true,
                RequiresWindows10Permissions: requiresWindows10Permissions,
                RuntimePath: fixedRuntimePath,
                Version: version,
                Summary: summary);
        }

        var installedVersion = DetectInstalledRuntimeVersion();
        if (!string.IsNullOrWhiteSpace(installedVersion))
        {
            var summary = $"Using installed Evergreen WebView2 Runtime {installedVersion}.";
            logger.Info(summary);
            return new WebViewRuntimeInfo(
                IsAvailable: true,
                IsFixedVersion: false,
                RequiresWindows10Permissions: false,
                RuntimePath: null,
                Version: installedVersion,
                Summary: summary);
        }

        const string missingSummary =
            "No bundled FixedRuntime folder or installed Evergreen WebView2 Runtime was detected.";
        logger.Warn(missingSummary);
        return new WebViewRuntimeInfo(
            IsAvailable: false,
            IsFixedVersion: false,
            RequiresWindows10Permissions: false,
            RuntimePath: null,
            Version: null,
            Summary: missingSummary);
    }

    private static string? FindFixedRuntimePath(string baseDirectory)
    {
        foreach (var candidateRoot in EnumerateCandidateRoots(baseDirectory))
        {
            if (!Directory.Exists(candidateRoot))
            {
                continue;
            }

            var directExe = Path.Combine(candidateRoot, "msedgewebview2.exe");
            if (File.Exists(directExe))
            {
                return candidateRoot;
            }

            var versionedFolder = Directory.EnumerateFiles(candidateRoot, "msedgewebview2.exe", SearchOption.AllDirectories)
                .Select(path => Path.GetDirectoryName(path))
                .Where(path => !string.IsNullOrWhiteSpace(path))
                .Select(path => path!)
                .OrderByDescending(path => ParseVersionDirectory(path) ?? new Version(0, 0))
                .ThenBy(path => path.Length)
                .FirstOrDefault();

            if (!string.IsNullOrWhiteSpace(versionedFolder))
            {
                return versionedFolder;
            }
        }

        return null;
    }

    private static IEnumerable<string> EnumerateCandidateRoots(string baseDirectory)
    {
        yield return Path.Combine(baseDirectory, "FixedRuntime");

        foreach (var directory in Directory.EnumerateDirectories(baseDirectory, "Microsoft.WebView2.FixedVersionRuntime*", SearchOption.TopDirectoryOnly))
        {
            yield return directory;
        }
    }

    private static string? DetectInstalledRuntimeVersion()
    {
        foreach (var (hive, path) in EnumerateRegistryPaths())
        {
            using var key = hive.OpenSubKey(path);
            var version = key?.GetValue("pv") as string;
            if (!string.IsNullOrWhiteSpace(version) && version != "0.0.0.0")
            {
                return version;
            }
        }

        return null;
    }

    private static IEnumerable<(RegistryKey Hive, string Path)> EnumerateRegistryPaths()
    {
        yield return (Registry.LocalMachine, $@"SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{WebViewRuntimeClientId}");
        yield return (Registry.LocalMachine, $@"SOFTWARE\Microsoft\EdgeUpdate\Clients\{WebViewRuntimeClientId}");
        yield return (Registry.CurrentUser, $@"Software\Microsoft\EdgeUpdate\Clients\{WebViewRuntimeClientId}");
    }

    private static string? InferVersionFromPath(string runtimePath)
    {
        var version = ParseVersionDirectory(runtimePath);
        return version?.ToString();
    }

    private static Version? ParseVersionDirectory(string runtimePath)
    {
        var directoryName = new DirectoryInfo(runtimePath).Name;
        return Version.TryParse(directoryName, out var version) ? version : null;
    }

    private static bool IsWindows10()
    {
        return OperatingSystem.IsWindowsVersionAtLeast(10)
            && !OperatingSystem.IsWindowsVersionAtLeast(10, 0, 22000);
    }
}
