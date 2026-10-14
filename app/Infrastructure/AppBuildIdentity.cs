using System.Reflection;

namespace XenonEdgeHost;

public static class AppBuildIdentity
{
    public static string Version => GetProductVersion(typeof(AppBuildIdentity).Assembly);

    internal static string GetProductVersion(Assembly assembly)
    {
        var informationalVersion = assembly.GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion;
        if (!string.IsNullOrWhiteSpace(informationalVersion))
        {
            return informationalVersion.Split('+')[0];
        }

        return assembly.GetName().Version?.ToString(3) ?? "0.0.0";
    }

    internal static string NormalizeReleaseChannel(string? requested, string? productVersion = null)
    {
        var channel = requested?.Trim().ToLowerInvariant() ?? "";
        if (channel is not ("stable" or "beta" or "nightly"))
        {
            channel = "stable";
        }

        var version = string.IsNullOrWhiteSpace(productVersion) ? Version : productVersion.Trim();
        var prereleaseIndex = version.IndexOf('-');
        if (prereleaseIndex < 0)
        {
            return channel;
        }

        var prerelease = version[(prereleaseIndex + 1)..];
        if (prerelease.Contains("nightly", StringComparison.OrdinalIgnoreCase))
        {
            return "nightly";
        }

        return channel == "nightly" ? "nightly" : "beta";
    }
}
