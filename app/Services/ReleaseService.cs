using System.Text.Json;

namespace XenonEdgeHost;

public sealed class ReleaseService
{
    private const int MaxReleaseResponseBytes = 2 * 1024 * 1024;
    private const string LatestReleaseApiUrl = "https://api.github.com/repos/SilverFuel/xeneon-widgets/releases/latest";
    private const string ReleasesUrl = "https://github.com/SilverFuel/xeneon-widgets/releases";

    private readonly HttpClient _httpClient;
    private readonly string? _currentVersionOverride;

    public ReleaseService(HttpClient httpClient)
        : this(httpClient, null)
    {
    }

    internal ReleaseService(HttpClient httpClient, string? currentVersionOverride)
    {
        _httpClient = httpClient;
        _currentVersionOverride = currentVersionOverride;
    }

    public async Task<object> GetLatestReleaseAsync(string? channel, CancellationToken cancellationToken)
    {
        var currentVersion = _currentVersionOverride ?? GetCurrentVersion();
        var normalizedChannel = NormalizeChannel(channel, currentVersion);

        try
        {
            using var response = await HttpReadResilience.SendAsync(
                _httpClient,
                () =>
                {
                    var request = new HttpRequestMessage(HttpMethod.Get, GetReleaseApiUrl(normalizedChannel));
                    request.Headers.UserAgent.ParseAdd($"XenonEdgeHost/{currentVersion}");
                    request.Headers.Accept.ParseAdd("application/vnd.github+json");
                    return request;
                },
                MaxReleaseResponseBytes,
                cancellationToken);
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
            var versionComparisonKnown = TryCompareReleaseVersions(latestVersion, currentVersion, out var versionComparison);
            var updateAvailable = versionComparisonKnown && versionComparison > 0;
            var versionRelation = versionComparisonKnown
                ? versionComparison > 0 ? "newer" : versionComparison < 0 ? "older" : "current"
                : "unknown";
            var downloadAllowed = updateAvailable && versionRelation == "newer";
            var exposedAssets = downloadAllowed
                ? assets
                : assets.Select(HideDownloadLocations).ToList();

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
                versionRelation,
                downloadAllowed,
                htmlUrl = TextOr(GetString(root, "html_url"), ReleasesUrl),
                installerUrl = downloadAllowed ? windowsAsset?.DownloadUrl ?? "" : "",
                macUrl = downloadAllowed ? macAsset?.DownloadUrl ?? "" : "",
                assets = exposedAssets,
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
            versionRelation = "unknown",
            downloadAllowed = false,
            htmlUrl = ReleasesUrl,
            installerUrl = "",
            macUrl = "",
            assets = Array.Empty<ReleaseAsset>(),
            trust = new
            {
                installer = "missing",
                hashStatus = "missing",
                signatureStatus = "missing",
                verificationStatus = "missing",
                trusted = false
            },
            hashStatus = "missing",
            signatureStatus = "missing",
            source = "GitHub Releases",
            sampledAt = DateTime.UtcNow.ToString("O"),
            message
        };
    }

    private static string NormalizeChannel(string? channel, string currentVersion)
    {
        return AppBuildIdentity.NormalizeReleaseChannel(channel, currentVersion);
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
            return ReleaseMatchesChannel(root, channel) ? root : default;
        }

        JsonElement selected = default;
        SemanticVersion? selectedVersion = null;
        foreach (var release in root.EnumerateArray())
        {
            if (!ReleaseMatchesChannel(release, channel))
            {
                continue;
            }

            var versionText = TextOr(GetString(release, "tag_name"), GetString(release, "name"));
            if (!TryParseReleaseVersion(versionText, out var version))
            {
                continue;
            }

            if (selectedVersion is null || version.CompareTo(selectedVersion.Value) > 0)
            {
                selected = release;
                selectedVersion = version;
            }
        }

        return selected;
    }

    private static bool ReleaseMatchesChannel(JsonElement release, string channel)
    {
        var tag = GetString(release, "tag_name");
        var name = GetString(release, "name");
        var combined = $"{tag} {name}";
        var isNightly = combined.Contains("nightly", StringComparison.OrdinalIgnoreCase);
        var prereleaseFlag = release.TryGetProperty("prerelease", out var prereleaseElement)
            && prereleaseElement.ValueKind == JsonValueKind.True;
        var hasPrereleaseVersion = TryParseReleaseVersion(TextOr(tag, name), out var version) && version.IsPrerelease;
        var isPrerelease = prereleaseFlag || hasPrereleaseVersion;

        return channel switch
        {
            "nightly" => isPrerelease && isNightly,
            "beta" => isPrerelease && !isNightly,
            _ => !isPrerelease
        };
    }

    private static string GetCurrentVersion()
    {
        return AppBuildIdentity.Version;
    }

    private static bool TryCompareReleaseVersions(string latestVersion, string currentVersion, out int comparison)
    {
        comparison = 0;
        if (!TryParseReleaseVersion(latestVersion, out var latest) || !TryParseReleaseVersion(currentVersion, out var current))
        {
            return false;
        }

        comparison = latest.CompareTo(current);
        return true;
    }

    internal static bool TryParseReleaseVersion(string value, out SemanticVersion version)
    {
        version = default;
        var normalized = value.Trim().TrimStart('v', 'V');
        var buildIndex = normalized.IndexOf('+');
        if (buildIndex >= 0)
        {
            normalized = normalized[..buildIndex];
        }

        var prerelease = Array.Empty<string>();
        var prereleaseIndex = normalized.IndexOf('-');
        if (prereleaseIndex >= 0)
        {
            prerelease = normalized[(prereleaseIndex + 1)..].Split('.', StringSplitOptions.RemoveEmptyEntries);
            normalized = normalized[..prereleaseIndex];
            if (prerelease.Length == 0)
            {
                return false;
            }
        }

        var core = normalized.Split('.');
        if (core.Length != 3
            || !int.TryParse(core[0], out var major)
            || !int.TryParse(core[1], out var minor)
            || !int.TryParse(core[2], out var patch)
            || major < 0 || minor < 0 || patch < 0)
        {
            return false;
        }

        if (prerelease.Any(identifier => !identifier.All(character => char.IsAsciiLetterOrDigit(character) || character == '-')))
        {
            return false;
        }

        version = new SemanticVersion(major, minor, patch, prerelease);
        return true;
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

    private static ReleaseAsset HideDownloadLocations(ReleaseAsset asset)
    {
        return asset with
        {
            DownloadUrl = "",
            Sha256Url = "",
            SignatureUrl = ""
        };
    }

    private static object BuildReleaseTrust(ReleaseAsset? installer)
    {
        return new
        {
            installer = installer is null ? "missing" : installer.Name,
            hashStatus = installer?.HashStatus ?? "missing",
            signatureStatus = installer?.SignatureStatus ?? "missing",
            verificationStatus = installer is null ? "missing" : "not-verified",
            trusted = false
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

internal readonly record struct SemanticVersion(
    int Major,
    int Minor,
    int Patch,
    IReadOnlyList<string> PrereleaseIdentifiers) : IComparable<SemanticVersion>
{
    public bool IsPrerelease => PrereleaseIdentifiers.Count > 0;

    public int CompareTo(SemanticVersion other)
    {
        var coreComparison = Major.CompareTo(other.Major);
        if (coreComparison == 0) coreComparison = Minor.CompareTo(other.Minor);
        if (coreComparison == 0) coreComparison = Patch.CompareTo(other.Patch);
        if (coreComparison != 0) return coreComparison;

        if (!IsPrerelease && !other.IsPrerelease) return 0;
        if (!IsPrerelease) return 1;
        if (!other.IsPrerelease) return -1;

        var identifierCount = Math.Max(PrereleaseIdentifiers.Count, other.PrereleaseIdentifiers.Count);
        for (var index = 0; index < identifierCount; index++)
        {
            if (index >= PrereleaseIdentifiers.Count) return -1;
            if (index >= other.PrereleaseIdentifiers.Count) return 1;

            var left = PrereleaseIdentifiers[index];
            var right = other.PrereleaseIdentifiers[index];
            var leftNumeric = int.TryParse(left, out var leftNumber);
            var rightNumeric = int.TryParse(right, out var rightNumber);
            if (leftNumeric && rightNumeric)
            {
                var numericComparison = leftNumber.CompareTo(rightNumber);
                if (numericComparison != 0) return numericComparison;
                continue;
            }

            if (leftNumeric != rightNumeric) return leftNumeric ? -1 : 1;
            var textComparison = string.Compare(left, right, StringComparison.Ordinal);
            if (textComparison != 0) return textComparison;
        }

        return 0;
    }

    public static bool operator >(SemanticVersion left, SemanticVersion right) => left.CompareTo(right) > 0;
    public static bool operator <(SemanticVersion left, SemanticVersion right) => left.CompareTo(right) < 0;
}
