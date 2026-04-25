using System.Reflection;

namespace XenonEdgeHost;

public sealed class EmbeddedAssetProvider
{
    private readonly Assembly _assembly;
    private readonly string _namespacePrefix;
    private readonly string[] _resourceNames;
    private readonly object _assetCacheSync = new();
    private readonly Dictionary<string, EmbeddedAsset> _assetCache = new(StringComparer.OrdinalIgnoreCase);
    private readonly Dictionary<string, string> _mimeTypes = new(StringComparer.OrdinalIgnoreCase)
    {
        [".css"] = "text/css; charset=utf-8",
        [".html"] = "text/html; charset=utf-8",
        [".js"] = "application/javascript; charset=utf-8",
        [".json"] = "application/json; charset=utf-8",
        [".md"] = "text/markdown; charset=utf-8",
        [".svg"] = "image/svg+xml",
        [".png"] = "image/png",
        [".jpg"] = "image/jpeg",
        [".jpeg"] = "image/jpeg",
        [".gif"] = "image/gif",
        [".webp"] = "image/webp",
        [".woff"] = "font/woff",
        [".woff2"] = "font/woff2",
        [".ttf"] = "font/ttf"
    };

    public EmbeddedAssetProvider()
    {
        _assembly = typeof(App).Assembly;
        _namespacePrefix = typeof(App).Namespace ?? "XenonEdgeHost";
        _resourceNames = _assembly.GetManifestResourceNames();
    }

    public bool TryGetAsset(string requestPath, out EmbeddedAsset asset)
    {
        var normalizedPath = NormalizeRequestPath(requestPath);

        lock (_assetCacheSync)
        {
            if (_assetCache.TryGetValue(normalizedPath, out asset))
            {
                return true;
            }
        }

        var resourceName = ResolveResourceName(normalizedPath);

        if (resourceName is null)
        {
            asset = default;
            return false;
        }

        using var stream = _assembly.GetManifestResourceStream(resourceName);
        if (stream is null)
        {
            asset = default;
            return false;
        }

        using var memory = new MemoryStream();
        stream.CopyTo(memory);

        asset = new EmbeddedAsset(
            normalizedPath,
            GetMimeType(normalizedPath),
            memory.ToArray());

        lock (_assetCacheSync)
        {
            _assetCache[normalizedPath] = asset;
        }

        return true;
    }

    private string? ResolveResourceName(string normalizedPath)
    {
        var dottedPath = normalizedPath.Replace('/', '.');
        var candidates = new[]
        {
            $"WebAssets/{normalizedPath}",
            $"WebAssets\\{normalizedPath}",
            $"{_namespacePrefix}.WebAssets.{dottedPath}"
        };

        foreach (var candidate in candidates)
        {
            if (_resourceNames.Any(name => string.Equals(name, candidate, StringComparison.OrdinalIgnoreCase)))
            {
                return _resourceNames.First(name => string.Equals(name, candidate, StringComparison.OrdinalIgnoreCase));
            }
        }

        return _resourceNames.FirstOrDefault(name =>
            name.EndsWith($"WebAssets/{normalizedPath}", StringComparison.OrdinalIgnoreCase)
            || name.EndsWith($"WebAssets\\{normalizedPath}", StringComparison.OrdinalIgnoreCase)
            || name.EndsWith($".WebAssets.{dottedPath}", StringComparison.OrdinalIgnoreCase));
    }

    private string NormalizeRequestPath(string requestPath)
    {
        var path = string.IsNullOrWhiteSpace(requestPath) || requestPath == "/"
            ? "dashboard.html"
            : requestPath.TrimStart('/').Replace('\\', '/');

        return string.IsNullOrWhiteSpace(path) ? "dashboard.html" : path;
    }

    private string GetMimeType(string normalizedPath)
    {
        var extension = Path.GetExtension(normalizedPath);
        return _mimeTypes.TryGetValue(extension, out var mimeType)
            ? mimeType
            : "application/octet-stream";
    }
}

public readonly record struct EmbeddedAsset(string Path, string ContentType, byte[] Content);
