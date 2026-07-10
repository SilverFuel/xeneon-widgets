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
            var windowsAsset = FindAsset(assets, asset => !IsTrustSidecar(asset.Name)
                && asset.Name.Contains("setup", StringComparison.OrdinalIgnoreCase)
                && asset.Name.EndsWith(".exe", StringComparison.OrdinalIgnoreCase));
            var macAsset = FindAsset(assets, asset => !IsTrustSidecar(asset.Name)
                && (asset.Name.EndsWith(".dmg", StringComparison.OrdinalIgnoreCase)
                    || asset.Name.Contains("mac", StringComparison.OrdinalIgnoreCase)
                    || asset.Name.Contains("darwin", StringComparison.OrdinalIgnoreCase)));
            var latestVersion = TextOr(GetString(root, "tag_name"), GetString(root, "name"));
            var trust = BuildReleaseTrust(windowsAsset);
            var versionComparisonKnown = TryIsVersionNewer(latestVersion, currentVersion, out var updateAvailable);

            return new
            {
                supported = true,
                configured = true,
                status = "live",
                channel = normalizedChannel,
                currentVersion,
                latestVersion,
                updateAvailable,
                versionComparisonKnown,
                htmlUrl = TextOr(GetString(root, "html_url"), ReleasesUrl),
                installerUrl = windowsAsset?.DownloadUrl ?? "",
                macUrl = macAsset?.DownloadUrl ?? "",
                assets,
                trust,
                hashStatus = windowsAsset?.HashStatus ?? "missing",
                signatureStatus = windowsAsset?.SignatureStatus ?? "missing",
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
            updateAvailable = false,
            versionComparisonKnown = false,
            htmlUrl = ReleasesUrl,
            installerUrl = "",
            macUrl = "",
            assets = Array.Empty<ReleaseAsset>(),
            trust = new
            {
                installer = "missing",
                hashStatus = "missing",
                signatureStatus = "missing",
                trusted = false
            },
            hashStatus = "missing",
            signatureStatus = "missing",
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

    private static bool TryIsVersionNewer(string latestVersion, string currentVersion, out bool updateAvailable)
    {
        updateAvailable = false;
        if (!TryParseReleaseVersion(latestVersion, out var latest) || !TryParseReleaseVersion(currentVersion, out var current))
        {
            return false;
        }

        updateAvailable = latest > current;
        return true;
    }

    private static bool TryParseReleaseVersion(string value, out Version version)
    {
        var normalized = value.Trim().TrimStart('v', 'V');
        var prereleaseIndex = normalized.IndexOfAny(['-', '+']);
        if (prereleaseIndex >= 0)
        {
            normalized = normalized[..prereleaseIndex];
        }

        return Version.TryParse(normalized, out version!);
    }

    private static List<ReleaseAsset> ReadAssets(JsonElement root)
    {
        if (!root.TryGetProperty("assets", out var assetsElement) || assetsElement.ValueKind != JsonValueKind.Array)
        {
            return [];
        }

        var rawAssets = new List<ReleaseAsset>();
        foreach (var assetElement in assetsElement.EnumerateArray())
        {
            var name = GetString(assetElement, "name");
            var downloadUrl = GetString(assetElement, "browser_download_url");
            if (string.IsNullOrWhiteSpace(name) || string.IsNullOrWhiteSpace(downloadUrl))
            {
                continue;
            }

            rawAssets.Add(new ReleaseAsset(
                name,
                downloadUrl,
                assetElement.TryGetProperty("size", out var sizeElement) && sizeElement.TryGetInt64(out var size) ? size : 0,
                "",
                "",
                "missing",
                "missing"));
        }

        return rawAssets
            .Select(asset => EnrichTrustStatus(asset, rawAssets))
            .ToList();
    }

    private static ReleaseAsset EnrichTrustStatus(ReleaseAsset asset, IReadOnlyCollection<ReleaseAsset> assets)
    {
        if (IsTrustSidecar(asset.Name))
        {
            return asset with
            {
                HashStatus = IsHashSidecar(asset.Name) ? "sidecar" : "not-applicable",
                SignatureStatus = IsSignatureSidecar(asset.Name) ? "sidecar" : "not-applicable"
            };
        }

        var hashAsset = FindAsset(assets, candidate => IsHashForAsset(candidate.Name, asset.Name));
        var signatureAsset = FindAsset(assets, candidate => IsSignatureForAsset(candidate.Name, asset.Name));
        return asset with
        {
            Sha256Url = hashAsset?.DownloadUrl ?? "",
            SignatureUrl = signatureAsset?.DownloadUrl ?? "",
            HashStatus = hashAsset is null ? "missing" : "available",
            SignatureStatus = signatureAsset is null ? "missing" : "available"
        };
    }

    private static object BuildReleaseTrust(ReleaseAsset? installer)
    {
        return new
        {
            installer = installer is null ? "missing" : installer.Name,
            hashStatus = installer?.HashStatus ?? "missing",
            signatureStatus = installer?.SignatureStatus ?? "missing",
            trusted = string.Equals(installer?.HashStatus, "available", StringComparison.OrdinalIgnoreCase)
                && string.Equals(installer?.SignatureStatus, "available", StringComparison.OrdinalIgnoreCase)
        };
    }

    private static bool IsHashForAsset(string candidateName, string assetName)
    {
        return string.Equals(candidateName, assetName + ".sha256", StringComparison.OrdinalIgnoreCase)
            || string.Equals(candidateName, assetName + ".sha256sum", StringComparison.OrdinalIgnoreCase)
            || string.Equals(candidateName, assetName + ".sha256.txt", StringComparison.OrdinalIgnoreCase)
            || string.Equals(candidateName, assetName + ".hash", StringComparison.OrdinalIgnoreCase);
    }

    private static bool IsSignatureForAsset(string candidateName, string assetName)
    {
        return string.Equals(candidateName, assetName + ".sig", StringComparison.OrdinalIgnoreCase)
            || string.Equals(candidateName, assetName + ".signature", StringComparison.OrdinalIgnoreCase)
            || string.Equals(candidateName, assetName + ".asc", StringComparison.OrdinalIgnoreCase)
            || string.Equals(candidateName, assetName + ".sigstore", StringComparison.OrdinalIgnoreCase);
    }

    private static bool IsTrustSidecar(string assetName)
    {
        return IsHashSidecar(assetName) || IsSignatureSidecar(assetName);
    }

    private static bool IsHashSidecar(string assetName)
    {
        return assetName.EndsWith(".sha256", StringComparison.OrdinalIgnoreCase)
            || assetName.EndsWith(".sha256sum", StringComparison.OrdinalIgnoreCase)
            || assetName.EndsWith(".sha256.txt", StringComparison.OrdinalIgnoreCase)
            || assetName.EndsWith(".hash", StringComparison.OrdinalIgnoreCase);
    }

    private static bool IsSignatureSidecar(string assetName)
    {
        return assetName.EndsWith(".sig", StringComparison.OrdinalIgnoreCase)
            || assetName.EndsWith(".signature", StringComparison.OrdinalIgnoreCase)
            || assetName.EndsWith(".asc", StringComparison.OrdinalIgnoreCase)
            || assetName.EndsWith(".sigstore", StringComparison.OrdinalIgnoreCase);
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

public sealed record ReleaseAsset(
    string Name,
    string DownloadUrl,
    long Size,
    string Sha256Url,
    string SignatureUrl,
    string HashStatus,
    string SignatureStatus);
