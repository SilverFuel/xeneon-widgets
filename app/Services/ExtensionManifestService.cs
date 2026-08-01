using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace XenonEdgeHost;

public sealed class ExtensionManifestService
{
    private static readonly HashSet<string> AllowedPermissions = new(StringComparer.OrdinalIgnoreCase)
    {
        "system.read", "network.read", "audio.read", "audio.control",
        "smart-home.read", "smart-home.control", "actions.execute"
    };

    private readonly string _extensionsDirectory;
    private readonly string _trustStorePath;
    private readonly HostLogger _logger;

    public ExtensionManifestService(HostLogger logger)
        : this(logger, null, null)
    {
    }

    internal ExtensionManifestService(HostLogger logger, string? extensionsDirectory, string? trustStorePath)
    {
        _logger = logger;
        _extensionsDirectory = extensionsDirectory ?? Path.Combine(AppPaths.RoamingDataDirectory, "extensions");
        _trustStorePath = trustStorePath ?? Path.Combine(AppContext.BaseDirectory, "assets", "trusted-extension-publishers.json");
        Directory.CreateDirectory(_extensionsDirectory);
    }

    public object GetSnapshot()
    {
        var publishers = LoadPublishers();
        var extensions = Directory.EnumerateFiles(_extensionsDirectory, "auxora-extension.json", SearchOption.AllDirectories)
            .Take(100).Select(path => Inspect(path, publishers)).ToList();
        return new
        {
            supported = true,
            status = "ready",
            extensionsDirectory = _extensionsDirectory,
            trustedPublisherCount = publishers.Count,
            extensions,
            permissions = AllowedPermissions.OrderBy(value => value).ToArray(),
            verifiedCount = extensions.Count(extension => extension.Verified),
            thirdPartyLoadingEnabled = false,
            message = extensions.Count == 0
                ? "No third-party manifests are installed. Third-party loading is disabled in this beta."
                : $"{extensions.Count(extension => extension.Verified)} of {extensions.Count} manifests passed inspection. Third-party loading is disabled in this beta."
        };
    }

    private ExtensionInspection Inspect(string manifestPath, IReadOnlyDictionary<string, string> publishers)
    {
        try
        {
            var manifest = JsonSerializer.Deserialize<ExtensionManifest>(File.ReadAllText(manifestPath), new JsonSerializerOptions { PropertyNameCaseInsensitive = true })
                ?? throw new InvalidOperationException("Manifest is empty.");
            var root = Path.GetDirectoryName(manifestPath) ?? _extensionsDirectory;
            var entrypoint = Path.GetFullPath(Path.Combine(root, manifest.Entrypoint ?? ""));
            if (!entrypoint.StartsWith(Path.GetFullPath(root) + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase) || !File.Exists(entrypoint))
            {
                throw new InvalidOperationException("Entrypoint must exist inside the extension directory.");
            }

            var permissions = (manifest.Permissions ?? []).Distinct(StringComparer.OrdinalIgnoreCase).ToList();
            var invalid = permissions.Where(permission => !AllowedPermissions.Contains(permission)).ToList();
            if (invalid.Count > 0)
            {
                throw new InvalidOperationException($"Unknown permissions: {string.Join(", ", invalid)}");
            }

            var contentHash = Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(entrypoint)));
            if (!string.Equals(contentHash, NormalizeHash(manifest.ContentSha256), StringComparison.OrdinalIgnoreCase))
            {
                throw new InvalidOperationException("Entrypoint hash does not match the signed manifest.");
            }
            if (!publishers.TryGetValue(manifest.PublisherKeyId ?? "", out var publicKeyPem))
            {
                throw new InvalidOperationException("Publisher is not trusted.");
            }

            using var rsa = RSA.Create();
            rsa.ImportFromPem(publicKeyPem);
            var signature = Convert.FromBase64String(manifest.Signature ?? "");
            if (!rsa.VerifyData(Encoding.UTF8.GetBytes(BuildSignedPayload(manifest, permissions, contentHash)), signature,
                    HashAlgorithmName.SHA256, RSASignaturePadding.Pss))
            {
                throw new InvalidOperationException("Manifest signature is invalid.");
            }

            return new ExtensionInspection(manifest.Id ?? "", manifest.Name ?? manifest.Id ?? "Extension", manifest.Version ?? "0.0.0",
                manifest.PublisherKeyId ?? "", permissions, true, false,
                "Signature, content hash, and permissions verified. Loading is disabled in this beta.", manifestPath);
        }
        catch (Exception error)
        {
            _logger.Warn($"Extension manifest rejected at {manifestPath}: {error.Message}");
            return new ExtensionInspection("", Path.GetFileName(Path.GetDirectoryName(manifestPath)) ?? "Extension", "", "", [], false, false, error.Message, manifestPath);
        }
    }

    private IReadOnlyDictionary<string, string> LoadPublishers()
    {
        try
        {
            if (!File.Exists(_trustStorePath))
            {
                return new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            }
            var store = JsonSerializer.Deserialize<PublisherTrustStore>(File.ReadAllText(_trustStorePath), new JsonSerializerOptions { PropertyNameCaseInsensitive = true });
            return (store?.Publishers ?? [])
                .Where(publisher => !string.IsNullOrWhiteSpace(publisher.KeyId) && !string.IsNullOrWhiteSpace(publisher.PublicKeyPem))
                .ToDictionary(publisher => publisher.KeyId!, publisher => publisher.PublicKeyPem!, StringComparer.OrdinalIgnoreCase);
        }
        catch (Exception error)
        {
            _logger.Warn($"Extension publisher trust store could not be read: {error.Message}");
            return new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        }
    }

    private static string BuildSignedPayload(ExtensionManifest manifest, IReadOnlyCollection<string> permissions, string contentHash) => string.Join("\n", new[]
    {
        manifest.Id?.Trim() ?? "", manifest.Version?.Trim() ?? "", manifest.Entrypoint?.Replace('\\', '/').Trim() ?? "",
        string.Join(",", permissions.OrderBy(value => value, StringComparer.OrdinalIgnoreCase)), contentHash
    });

    private static string NormalizeHash(string? hash) => new string((hash ?? "").Where(Uri.IsHexDigit).Select(char.ToUpperInvariant).ToArray());

    private sealed class ExtensionManifest
    {
        public string? Id { get; set; }
        public string? Name { get; set; }
        public string? Version { get; set; }
        public string? Entrypoint { get; set; }
        public string? PublisherKeyId { get; set; }
        public string? ContentSha256 { get; set; }
        public string? Signature { get; set; }
        public List<string>? Permissions { get; set; }
    }

    private sealed class PublisherTrustStore { public List<TrustedPublisher>? Publishers { get; set; } }
    private sealed class TrustedPublisher { public string? KeyId { get; set; } public string? PublicKeyPem { get; set; } }
}

public sealed record ExtensionInspection(string Id, string Name, string Version, string PublisherKeyId, List<string> Permissions, bool Verified, bool Loadable, string Message, string ManifestPath);
