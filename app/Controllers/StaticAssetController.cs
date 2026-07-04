using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace XenonEdgeHost;

public sealed class StaticAssetController
{
    private const string FallbackDashboardAssetRevision = "local";
    private const string SessionHeaderName = "X-Xenon-Session";
    private readonly EmbeddedAssetProvider _assetProvider;
    private readonly string _sessionToken;

    public StaticAssetController(EmbeddedAssetProvider assetProvider, string sessionToken)
    {
        _assetProvider = assetProvider;
        _sessionToken = sessionToken;
        AssetRevision = LoadDashboardAssetRevision();
    }

    public string AssetRevision { get; }

    public async Task<bool> TryHandleAsync(string path, HttpListenerResponse response, CancellationToken cancellationToken)
    {
        if (!_assetProvider.TryGetAsset(path, out var asset))
        {
            return false;
        }

        await WriteAssetAsync(response, asset, cancellationToken);
        return true;
    }

    private string LoadDashboardAssetRevision()
    {
        try
        {
            if (!_assetProvider.TryGetAsset("assets/revision.json", out var asset))
            {
                return FallbackDashboardAssetRevision;
            }

            using var document = JsonDocument.Parse(asset.Content);
            if (document.RootElement.TryGetProperty("assetRevision", out var revision)
                && revision.ValueKind == JsonValueKind.String)
            {
                var value = revision.GetString()?.Trim();
                if (!string.IsNullOrWhiteSpace(value))
                {
                    return value;
                }
            }
        }
        catch
        {
        }

        return FallbackDashboardAssetRevision;
    }

    private async Task WriteAssetAsync(HttpListenerResponse response, EmbeddedAsset asset, CancellationToken cancellationToken)
    {
        var content = asset.Content;
        string? nonce = null;
        if (asset.ContentType.StartsWith("text/html", StringComparison.OrdinalIgnoreCase))
        {
            nonce = CreateNonce();
            content = InjectSessionBootstrap(asset.Content, nonce);
        }

        response.StatusCode = 200;
        response.ContentType = asset.ContentType;
        response.Headers["Cache-Control"] = ShouldDisableCaching(asset.Path)
            ? "no-cache, no-store, must-revalidate"
            : "public, max-age=604800";
        ApplySecurityHeaders(response, asset.ContentType, nonce);
        response.ContentLength64 = content.LongLength;
        await response.OutputStream.WriteAsync(content, cancellationToken);
        response.Close();
    }

    private byte[] InjectSessionBootstrap(byte[] content, string nonce)
    {
        var html = Encoding.UTF8.GetString(content);
        if (!html.Contains("</head>", StringComparison.OrdinalIgnoreCase)
            || html.Contains("window.XenonSessionToken", StringComparison.OrdinalIgnoreCase))
        {
            return content;
        }

        var nonceAttribute = WebUtility.HtmlEncode(nonce);
        var script = BuildSessionBootstrapScript();
        var injection = $$"""
          <script nonce="{{nonceAttribute}}">
          {{script}}
          </script>
        """;

        var index = html.IndexOf("</head>", StringComparison.OrdinalIgnoreCase);
        return Encoding.UTF8.GetBytes(html.Insert(index, injection));
    }

    private string BuildSessionBootstrapScript()
    {
        var tokenJson = JsonSerializer.Serialize(_sessionToken);
        return $$"""
          (() => {
            window.XenonSessionToken = {{tokenJson}};
            const originalFetch = window.fetch;
            if (!originalFetch || originalFetch.__xenonSessionWrapped) {
              return;
            }
            function requestMethod(input, init) {
              return String((init && init.method) || (input && input.method) || "GET").toUpperCase();
            }
            window.fetch = function(input, init) {
              const method = requestMethod(input, init || {});
              if (!/^(GET|HEAD|OPTIONS)$/.test(method)) {
                const headers = new Headers((init && init.headers) || (input && input.headers) || undefined);
                if (!headers.has("{{SessionHeaderName}}")) {
                  headers.set("{{SessionHeaderName}}", window.XenonSessionToken);
                }
                init = Object.assign({}, init || {}, { headers });
              }
              return originalFetch.call(this, input, init);
            };
            window.fetch.__xenonSessionWrapped = true;
          })();
        """;
    }

    private static string CreateNonce()
    {
        return Convert.ToBase64String(RandomNumberGenerator.GetBytes(16));
    }

    private static void ApplySecurityHeaders(HttpListenerResponse response, string contentType, string? nonce)
    {
        response.Headers["X-Content-Type-Options"] = "nosniff";
        response.Headers["Referrer-Policy"] = "no-referrer";
        if (!contentType.StartsWith("text/html", StringComparison.OrdinalIgnoreCase))
        {
            return;
        }

        var scriptSource = string.IsNullOrWhiteSpace(nonce)
            ? "'self'"
            : $"'self' 'nonce-{nonce}'";
        response.Headers["Content-Security-Policy"] =
            "default-src 'self'; "
            + $"script-src {scriptSource}; "
            + "connect-src 'self' http://127.0.0.1:* http://localhost:* ws://127.0.0.1:* ws://localhost:*; "
            + "img-src 'self' data: blob: http: https:; "
            + "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
            + "font-src 'self' data: https://fonts.gstatic.com; "
            + "media-src 'self' blob: data:; "
            + "object-src 'none'; base-uri 'self'; frame-ancestors 'none'";
    }

    private static bool ShouldDisableCaching(string path)
    {
        return path.EndsWith(".html", StringComparison.OrdinalIgnoreCase)
            || path.EndsWith(".js", StringComparison.OrdinalIgnoreCase)
            || path.EndsWith(".css", StringComparison.OrdinalIgnoreCase)
            || path.EndsWith(".json", StringComparison.OrdinalIgnoreCase);
    }
}
