using System.Reflection;
using System.Text.Json;

namespace XenonEdgeHost;

public sealed class ReleaseService
{
    private const string LatestReleaseApiUrl = "https://api.github.com/repos/SilverFuel/xeneon-widgets/releases/latest";
    private const string ReleasesUrl = "https://github.com/SilverFuel/xeneon-widgets/releases";

    private readonly HttpClient _httpClient;

    public ReleaseService(HttpClient httpClient)
    {
        _httpClient = httpClient;
    }

    public async Task<object> GetLatestReleaseAsync(string? channel, CancellationToken cancellationToken)
    {
        var currentVersion = GetCurrentVersion();
        var normalizedChannel = NormalizeChannel(channel);

        try
        {
            using var request = new HttpRequestMessage(HttpMethod.Get, GetReleaseApiUrl(normalizedChannel));
            request.Headers.UserAgent.ParseAdd($"XenonEdgeHost/{currentVersion}");
            request.Headers.Accept.ParseAdd("application/vnd.github+json");

            using var response = await _httpClient.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, cancellationToken);
            if (!response.IsSuccessStatusCode)
            {
                return BuildUnavailable(currentVersion, normalizedChannel, $"GitHub returned HTTP {(int)response.StatusCode}.");
            }

            await using var stream = await response.Content.ReadAsStreamAsync(cancellationToken);
            using var document = await JsonDocument.ParseAsync(stream, cancellationToken: cancellationToken);
            var root = SelectReleaseElement(document.RootElement, normalizedChannel);
            if (root.ValueKind == JsonValueKind.Undefined)
            {
                return BuildUnavailable(currentVersion, normalizedChannel, "No release matched the selected update channel.");
            }

            var assets = ReadAssets(root);
            var windowsAsset = FindAsset(assets, asset => asset.Name.Contains("setup", StringComparison.OrdinalIgnoreCase) && asset.Name.EndsWith(".exe", StringComparison.OrdinalIgnoreCase));
            var macAsset = FindAsset(assets, asset => asset.Name.EndsWith(".dmg", StringComparison.OrdinalIgnoreCase)
                || asset.Name.Contains("mac", StringComparison.OrdinalIgnoreCase)
                || asset.Name.Contains("darwin", StringComparison.OrdinalIgnoreCase));
            var latestVersion = TextOr(GetString(root, "tag_name"), GetString(root, "name"));

            return new
            {
                supported = true,
                configured = true,
                status = "live",
                channel = normalizedChannel,
                currentVersion,
                latestVersion,
                htmlUrl = TextOr(GetString(root, "html_url"), ReleasesUrl),
                installerUrl = windowsAsset?.DownloadUrl ?? "",
                macUrl = macAsset?.DownloadUrl ?? "",
                assets,
                source = "GitHub Releases",
                sampledAt = DateTime.UtcNow.ToString("O"),
                message = string.IsNullOrWhiteSpace(latestVersion)
                    ? "Release feed is reachable, but no public release tag was found."
                    : $"Latest {normalizedChannel} release is {latestVersion}."
            };
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception error)
        {
            return BuildUnavailable(currentVersion, normalizedChannel, error.Message);
        }
    }

    private static object BuildUnavailable(string currentVersion, string channel, string message)
    {
        return new
        {
            supported = true,
            configured = true,
            status = "error",
            channel,
            currentVersion,
            latestVersion = "",
            htmlUrl = ReleasesUrl,
            installerUrl = "",
            macUrl = "",
            assets = Array.Empty<ReleaseAsset>(),
            source = "GitHub Releases",
            sampledAt = DateTime.UtcNow.ToString("O"),
            message
        };
    }

    private static string NormalizeChannel(string? channel)
    {
        var value = channel?.Trim().ToLowerInvariant() ?? "";
        return value is "beta" or "nightly" ? value : "stable";
    }

    private static string GetReleaseApiUrl(string channel)
    {
        return channel == "stable"
            ? LatestReleaseApiUrl
            : "https://api.github.com/repos/SilverFuel/xeneon-widgets/releases";
    }

    private static JsonElement SelectReleaseElement(JsonElement root, string channel)
    {
        if (root.ValueKind != JsonValueKind.Array)
        {
            return root;
        }

        foreach (var release in root.EnumerateArray())
        {
            var tag = GetString(release, "tag_name");
            var name = GetString(release, "name");
            var prerelease = release.TryGetProperty("prerelease", out var prereleaseElement)
                && prereleaseElement.ValueKind == JsonValueKind.True;
            var combined = $"{tag} {name}";
            var isNightly = combined.Contains("nightly", StringComparison.OrdinalIgnoreCase);
            var isBeta = prerelease || combined.Contains("beta", StringComparison.OrdinalIgnoreCase);

            if (channel == "nightly" && isNightly)
            {
                return release;
            }

            if (channel == "beta" && isBeta && !isNightly)
            {
                return release;
            }
        }

        return root.EnumerateArray().FirstOrDefault();
    }

    private static string GetCurrentVersion()
    {
        var informationalVersion = typeof(App).Assembly.GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion;
        if (!string.IsNullOrWhiteSpace(informationalVersion))
        {
            return informationalVersion.Split('+')[0];
        }

        return typeof(App).Assembly.GetName().Version?.ToString(3) ?? "0.0.0";
    }

    private static List<ReleaseAsset> ReadAssets(JsonElement root)
    {
        if (!root.TryGetProperty("assets", out var assetsElement) || assetsElement.ValueKind != JsonValueKind.Array)
        {
            return [];
        }

        var assets = new List<ReleaseAsset>();
        foreach (var assetElement in assetsElement.EnumerateArray())
        {
            var name = GetString(assetElement, "name");
            var downloadUrl = GetString(assetElement, "browser_download_url");
            if (string.IsNullOrWhiteSpace(name) || string.IsNullOrWhiteSpace(downloadUrl))
            {
                continue;
            }

            assets.Add(new ReleaseAsset(
                name,
                downloadUrl,
                assetElement.TryGetProperty("size", out var sizeElement) && sizeElement.TryGetInt64(out var size) ? size : 0));
        }

        return assets;
    }

    private static ReleaseAsset? FindAsset(IEnumerable<ReleaseAsset> assets, Func<ReleaseAsset, bool> predicate)
    {
        return assets.FirstOrDefault(predicate);
    }

    private static string GetString(JsonElement element, string propertyName)
    {
        return element.TryGetProperty(propertyName, out var value) && value.ValueKind == JsonValueKind.String
            ? value.GetString() ?? ""
            : "";
    }

    private static string TextOr(string value, string fallback)
    {
        return string.IsNullOrWhiteSpace(value) ? fallback : value;
    }
}

public sealed record ReleaseAsset(string Name, string DownloadUrl, long Size);
