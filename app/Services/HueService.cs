using System.Net.Http.Json;
using System.Net.Security;
using System.Security.Cryptography.X509Certificates;
using System.Text.Json;

namespace XenonEdgeHost;

public sealed class HueService
{
    private readonly HostLogger _logger;
    private readonly ConfigStore _configStore;
    private readonly object _sync = new();
    private HueSnapshot _snapshot = HueSnapshot.CreateSetup("");
    private string _cacheKey = "";
    private DateTimeOffset _lastRefresh = DateTimeOffset.MinValue;

    public HueService(ConfigStore configStore, HostLogger logger)
    {
        _configStore = configStore;
        _logger = logger;
    }

    public async Task<HueSnapshot> GetSnapshotAsync(AppConfig config, CancellationToken cancellationToken)
    {
        var hue = GetConfigSnapshot(config);
        if (string.IsNullOrWhiteSpace(hue.BridgeIp))
        {
            lock (_sync)
            {
                _snapshot = HueSnapshot.CreateSetup("");
                _cacheKey = "";
                _lastRefresh = DateTimeOffset.MinValue;
                return _snapshot.Clone();
            }
        }

        var cacheKey = $"{hue.BridgeIp}|{hue.AppKey}";
        if (DateTimeOffset.UtcNow - _lastRefresh > TimeSpan.FromSeconds(5)
            || !string.Equals(_cacheKey, cacheKey, StringComparison.OrdinalIgnoreCase))
        {
            await RefreshAsync(hue, cancellationToken);
        }

        lock (_sync)
        {
            var clone = _snapshot.Clone();
            clone.Stale = clone.SampledAt is null || DateTimeOffset.UtcNow - clone.SampledAt.Value > TimeSpan.FromSeconds(20);
            if (clone.Status == "live" && clone.Stale)
            {
                clone.Status = "stale";
            }

            return clone;
        }
    }

    public HueSnapshot GetCachedSnapshot(AppConfig config)
    {
        var hue = GetConfigSnapshot(config);
        if (string.IsNullOrWhiteSpace(hue.BridgeIp))
        {
            return HueSnapshot.CreateSetup("");
        }

        lock (_sync)
        {
            if (!string.Equals(_snapshot.BridgeIp, hue.BridgeIp, StringComparison.OrdinalIgnoreCase))
            {
                return HueSnapshot.CreateSetup(hue.BridgeIp);
            }

            var clone = _snapshot.Clone();
            clone.Stale = clone.SampledAt is null || DateTimeOffset.UtcNow - clone.SampledAt.Value > TimeSpan.FromSeconds(20);
            if (clone.Status == "live" && clone.Stale)
            {
                clone.Status = "stale";
            }

            return clone;
        }
    }

    public async Task<HueSnapshot> LinkBridgeAsync(string? bridgeIp, bool trustCertificate, string? trustedCertificateThumbprint, CancellationToken cancellationToken)
    {
        var normalizedIp = NormalizeBridgeIp(bridgeIp ?? _configStore.Current.Hue.BridgeIp);
        if (string.IsNullOrWhiteSpace(normalizedIp))
        {
            throw new InvalidOperationException("Hue bridge IP is required.");
        }

        var existing = GetConfigSnapshot(_configStore.Snapshot());
        var requestedThumbprint = NormalizeThumbprint(trustedCertificateThumbprint);
        var certificateState = new HueCertificateTrustState
        {
            TrustedThumbprint = trustCertificate
                ? requestedThumbprint
                : existing.BridgeIp.Equals(normalizedIp, StringComparison.OrdinalIgnoreCase) ? existing.CertificateThumbprint : ""
        };
        using var client = CreateClient(certificateState);
        JsonDocument payload;
        try
        {
            payload = await SendRequestAsync(client, normalizedIp, "/api", HttpMethod.Post, new
            {
                devicetype = "xeneon_widgets#dashboard",
                generateclientkey = true
            }, cancellationToken);
        }
        catch (HttpRequestException) when (certificateState.TrustRequired)
        {
            return HueSnapshot.CreateTrustRequired(normalizedIp, certificateState);
        }

        using (payload)
        {
            if (payload.RootElement.ValueKind != JsonValueKind.Array || payload.RootElement.GetArrayLength() == 0)
            {
                throw new InvalidOperationException("Hue bridge returned an unexpected response.");
            }

            var result = payload.RootElement[0];
            if (!result.TryGetProperty("success", out var success) || !success.TryGetProperty("username", out var usernameNode))
            {
                throw new InvalidOperationException(ExtractHueError(payload.RootElement) ?? "Hue link button has not been pressed yet.");
            }

            var appKey = usernameNode.GetString() ?? "";
            var clientKey = success.TryGetProperty("clientkey", out var clientKeyNode) ? clientKeyNode.GetString() ?? "" : "";

            var config = _configStore.Update(current =>
            {
                current.Hue.BridgeIp = normalizedIp;
                current.Hue.AppKey = appKey;
                current.Hue.ClientKey = clientKey;
                current.Hue.CertificateThumbprint = certificateState.RemoteThumbprint;
                return current;
            });

            Invalidate();
            return await GetSnapshotAsync(config, cancellationToken);
        }
    }

    public async Task SetLightStateAsync(AppConfig config, string lightId, object payload, CancellationToken cancellationToken)
    {
        var hue = EnsureLinked(config);
        await SendRequestAsync(hue, $"/api/{Uri.EscapeDataString(hue.AppKey)}/lights/{Uri.EscapeDataString(lightId)}/state", HttpMethod.Put, payload, cancellationToken);
        Invalidate();
    }

    public async Task SetGroupStateAsync(AppConfig config, string groupId, object payload, CancellationToken cancellationToken)
    {
        var hue = EnsureLinked(config);
        await SendRequestAsync(hue, $"/api/{Uri.EscapeDataString(hue.AppKey)}/groups/{Uri.EscapeDataString(groupId)}/action", HttpMethod.Put, payload, cancellationToken);
        Invalidate();
    }

    private async Task RefreshAsync(HueConfigSnapshot hue, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(hue.AppKey))
        {
            lock (_sync)
            {
                _snapshot = HueSnapshot.CreateAwaitingLink(hue.BridgeIp);
                _cacheKey = $"{hue.BridgeIp}|";
                _lastRefresh = DateTimeOffset.UtcNow;
            }

            return;
        }

        try
        {
            using var configDoc = await SendRequestAsync(hue, $"/api/{Uri.EscapeDataString(hue.AppKey)}/config", HttpMethod.Get, null, cancellationToken);
            using var lightsDoc = await SendRequestAsync(hue, $"/api/{Uri.EscapeDataString(hue.AppKey)}/lights", HttpMethod.Get, null, cancellationToken);
            using var groupsDoc = await SendRequestAsync(hue, $"/api/{Uri.EscapeDataString(hue.AppKey)}/groups", HttpMethod.Get, null, cancellationToken);

            var sampledAt = DateTimeOffset.UtcNow;
            lock (_sync)
            {
                _snapshot = new HueSnapshot
                {
                    Supported = true,
                    Configured = true,
                    Linked = true,
                    Status = "live",
                    SampledAt = sampledAt,
                    Stale = false,
                    BridgeIp = hue.BridgeIp,
                    BridgeName = configDoc.RootElement.TryGetProperty("name", out var nameNode) ? nameNode.GetString() ?? "Hue Bridge" : "Hue Bridge",
                    CertificateTrusted = true,
                    CertificateThumbprint = hue.CertificateThumbprint,
                    Lights = NormalizeLights(lightsDoc.RootElement),
                    Groups = NormalizeGroups(groupsDoc.RootElement),
                    Source = "hue local bridge",
                    Message = "Direct Hue bridge control is live."
                };
                _cacheKey = $"{hue.BridgeIp}|{hue.AppKey}";
                _lastRefresh = sampledAt;
            }
        }
        catch (HueCertificateTrustException error)
        {
            lock (_sync)
            {
                _snapshot = HueSnapshot.CreateTrustRequired(hue.BridgeIp, error.State);
                _cacheKey = $"{hue.BridgeIp}|{hue.AppKey}";
                _lastRefresh = DateTimeOffset.UtcNow;
            }
        }
        catch (Exception error)
        {
            _logger.Error("Failed to refresh Hue snapshot.", error);
            var unauthorized = error.Message.Contains("unauthorized user", StringComparison.OrdinalIgnoreCase);
            lock (_sync)
            {
                _snapshot = unauthorized
                    ? HueSnapshot.CreateRelinkRequired(hue.BridgeIp)
                    : HueSnapshot.CreateError(hue.BridgeIp, true, error.Message);
                _cacheKey = $"{hue.BridgeIp}|{hue.AppKey}";
                _lastRefresh = DateTimeOffset.UtcNow;
            }
        }
    }

    private static HueConfigSnapshot EnsureLinked(AppConfig config)
    {
        var hue = GetConfigSnapshot(config);
        if (string.IsNullOrWhiteSpace(hue.BridgeIp) || string.IsNullOrWhiteSpace(hue.AppKey))
        {
            throw new InvalidOperationException("Hue bridge is not linked.");
        }

        return hue;
    }

    private static HueConfigSnapshot GetConfigSnapshot(AppConfig config)
    {
        return new HueConfigSnapshot
        {
            BridgeIp = NormalizeBridgeIp(config.Hue.BridgeIp),
            AppKey = config.Hue.AppKey?.Trim() ?? "",
            ClientKey = config.Hue.ClientKey?.Trim() ?? "",
            CertificateThumbprint = NormalizeThumbprint(config.Hue.CertificateThumbprint)
        };
    }

    private static string NormalizeBridgeIp(string? input)
    {
        return NetworkEndpointGuard.NormalizeLocalHttpsAuthority(input, "Hue bridge");
    }

    private static HttpClient CreateClient(HueCertificateTrustState state)
    {
        return new HttpClient(new HttpClientHandler
        {
            ServerCertificateCustomValidationCallback = (_, certificate, _, errors) => ValidateCertificate(certificate, errors, state)
        }) { Timeout = TimeSpan.FromSeconds(10) };
    }

    private static bool ValidateCertificate(X509Certificate2? certificate, SslPolicyErrors errors, HueCertificateTrustState state)
    {
        if (certificate is null)
        {
            state.TrustRequired = true;
            state.PolicyError = "The Hue bridge did not present a certificate.";
            return false;
        }

        state.RemoteThumbprint = NormalizeThumbprint(certificate.Thumbprint);
        state.RemoteSubject = certificate.Subject ?? "";
        if (errors == SslPolicyErrors.None || string.Equals(state.TrustedThumbprint, state.RemoteThumbprint, StringComparison.OrdinalIgnoreCase))
        {
            state.Trusted = true;
            return true;
        }

        state.TrustRequired = true;
        state.PolicyError = errors.ToString();
        return false;
    }

    private async Task<JsonDocument> SendRequestAsync(HueConfigSnapshot hue, string path, HttpMethod method, object? body, CancellationToken cancellationToken)
    {
        var state = new HueCertificateTrustState { TrustedThumbprint = hue.CertificateThumbprint };
        using var client = CreateClient(state);
        try
        {
            return await SendRequestAsync(client, hue.BridgeIp, path, method, body, cancellationToken);
        }
        catch (HttpRequestException error) when (state.TrustRequired)
        {
            throw new HueCertificateTrustException(state, error);
        }
    }

    private static async Task<JsonDocument> SendRequestAsync(HttpClient client, string bridgeIp, string path, HttpMethod method, object? body, CancellationToken cancellationToken)
    {
        using var request = new HttpRequestMessage(method, $"https://{bridgeIp}{path}");
        request.Headers.Accept.ParseAdd("application/json");
        if (body is not null)
        {
            request.Content = JsonContent.Create(body);
        }

        using var response = await client.SendAsync(request, cancellationToken);
        var raw = await response.Content.ReadAsStringAsync(cancellationToken);
        var document = string.IsNullOrWhiteSpace(raw) ? JsonDocument.Parse("null") : JsonDocument.Parse(raw);

        if (!response.IsSuccessStatusCode)
        {
            using (document)
            {
                throw new InvalidOperationException(ExtractHueError(document.RootElement)
                    ?? $"Hue bridge request failed with status {(int)response.StatusCode}.");
            }
        }

        var hueError = ExtractHueError(document.RootElement);
        if (!string.IsNullOrWhiteSpace(hueError))
        {
            using (document)
            {
                throw new InvalidOperationException(hueError);
            }
        }

        return document;
    }

    private static string? ExtractHueError(JsonElement payload)
    {
        if (payload.ValueKind != JsonValueKind.Array)
        {
            return null;
        }

        foreach (var entry in payload.EnumerateArray())
        {
            if (entry.TryGetProperty("error", out var errorNode)
                && errorNode.TryGetProperty("description", out var descriptionNode))
            {
                return descriptionNode.GetString() ?? "Hue bridge request failed.";
            }
        }

        return null;
    }

    private static List<HueLightPayload> NormalizeLights(JsonElement payload)
    {
        var result = new List<HueLightPayload>();
        if (payload.ValueKind != JsonValueKind.Object)
        {
            return result;
        }

        foreach (var property in payload.EnumerateObject())
        {
            var light = property.Value;
            var state = light.TryGetProperty("state", out var stateNode) ? stateNode : default;
            result.Add(new HueLightPayload
            {
                Id = property.Name,
                Name = light.TryGetProperty("name", out var nameNode) ? nameNode.GetString() ?? property.Name : property.Name,
                On = state.ValueKind == JsonValueKind.Object && state.TryGetProperty("on", out var onNode) && onNode.GetBoolean(),
                Brightness = state.ValueKind == JsonValueKind.Object && state.TryGetProperty("bri", out var briNode)
                    ? (int)Math.Round((briNode.GetDouble() / 254d) * 100d)
                    : 0,
                Reachable = state.ValueKind != JsonValueKind.Object || !state.TryGetProperty("reachable", out var reachableNode) || reachableNode.GetBoolean(),
                Type = light.TryGetProperty("productname", out var productNode)
                    ? productNode.GetString() ?? "Hue light"
                    : light.TryGetProperty("type", out var typeNode) ? typeNode.GetString() ?? "Hue light" : "Hue light",
                ColorMode = state.ValueKind == JsonValueKind.Object && state.TryGetProperty("colormode", out var colorModeNode) ? colorModeNode.GetString() ?? "" : "",
                Hue = TryGetInt(state, "hue"),
                Saturation = TryGetInt(state, "sat") is { } sat ? (int)Math.Round((sat / 254d) * 100d) : null,
                ColorTemperature = TryGetInt(state, "ct")
            });
        }

        return result.OrderBy(light => light.Name, StringComparer.OrdinalIgnoreCase).ToList();
    }

    private static List<HueGroupPayload> NormalizeGroups(JsonElement payload)
    {
        var result = new List<HueGroupPayload>();
        if (payload.ValueKind != JsonValueKind.Object)
        {
            return result;
        }

        foreach (var property in payload.EnumerateObject())
        {
            var group = property.Value;
            var type = group.TryGetProperty("type", out var typeNode) ? typeNode.GetString() ?? "" : "";
            if (type != "Room" && type != "Zone" && type != "LightGroup")
            {
                continue;
            }

            var action = group.TryGetProperty("action", out var actionNode) ? actionNode : default;
            result.Add(new HueGroupPayload
            {
                Id = property.Name,
                Name = group.TryGetProperty("name", out var nameNode) ? nameNode.GetString() ?? property.Name : property.Name,
                On = action.ValueKind == JsonValueKind.Object && action.TryGetProperty("on", out var onNode) && onNode.GetBoolean(),
                Brightness = action.ValueKind == JsonValueKind.Object && action.TryGetProperty("bri", out var briNode)
                    ? (int)Math.Round((briNode.GetDouble() / 254d) * 100d)
                    : 0,
                Type = type,
                Lights = group.TryGetProperty("lights", out var lightsNode) && lightsNode.ValueKind == JsonValueKind.Array ? lightsNode.GetArrayLength() : 0,
                ColorMode = action.ValueKind == JsonValueKind.Object && action.TryGetProperty("colormode", out var colorModeNode) ? colorModeNode.GetString() ?? "" : "",
                Hue = TryGetInt(action, "hue"),
                Saturation = TryGetInt(action, "sat") is { } sat ? (int)Math.Round((sat / 254d) * 100d) : null,
                ColorTemperature = TryGetInt(action, "ct")
            });
        }

        return result.OrderBy(group => group.Name, StringComparer.OrdinalIgnoreCase).ToList();
    }

    private static int? TryGetInt(JsonElement payload, string propertyName)
    {
        if (payload.ValueKind != JsonValueKind.Object || !payload.TryGetProperty(propertyName, out var node))
        {
            return null;
        }

        if (node.ValueKind == JsonValueKind.Number && node.TryGetInt32(out var intValue))
        {
            return intValue;
        }

        if (node.ValueKind == JsonValueKind.Number)
        {
            return (int)Math.Round(node.GetDouble());
        }

        return null;
    }

    private void Invalidate()
    {
        lock (_sync)
        {
            _lastRefresh = DateTimeOffset.MinValue;
            _cacheKey = "";
        }
    }

    public void Dispose()
    {
    }

    private sealed class HueConfigSnapshot
    {
        public string BridgeIp { get; set; } = "";

        public string AppKey { get; set; } = "";

        public string ClientKey { get; set; } = "";

        public string CertificateThumbprint { get; set; } = "";
    }

    private static string NormalizeThumbprint(string? value)
    {
        return (value ?? "").Replace(" ", "", StringComparison.Ordinal).Trim().ToUpperInvariant();
    }

    private sealed class HueCertificateTrustException : Exception
    {
        public HueCertificateTrustException(HueCertificateTrustState state, Exception innerException) : base("Hue bridge certificate requires approval.", innerException)
        {
            State = state;
        }

        public HueCertificateTrustState State { get; }
    }
}

public sealed class HueCertificateTrustState
{
    public string TrustedThumbprint { get; set; } = "";
    public string RemoteThumbprint { get; set; } = "";
    public string RemoteSubject { get; set; } = "";
    public string PolicyError { get; set; } = "";
    public bool Trusted { get; set; }
    public bool TrustRequired { get; set; }
}

public sealed class HueSnapshot
{
    public bool Supported { get; set; } = true;

    public bool Configured { get; set; }

    public bool Linked { get; set; }

    public string Status { get; set; } = "setup";

    public DateTimeOffset? SampledAt { get; set; }

    public bool Stale { get; set; }

    public string BridgeIp { get; set; } = "";

    public string BridgeName { get; set; } = "";

    public bool CertificateTrusted { get; set; }

    public bool CertificateTrustRequired { get; set; }

    public string CertificateThumbprint { get; set; } = "";

    public string CertificateSubject { get; set; } = "";

    public string CertificateMessage { get; set; } = "";

    public List<HueLightPayload> Lights { get; set; } = new();

    public List<HueGroupPayload> Groups { get; set; } = new();

    public string Source { get; set; } = "hue local bridge";

    public string Message { get; set; } = "";

    public HueSnapshot Clone()
    {
        return new HueSnapshot
        {
            Supported = Supported,
            Configured = Configured,
            Linked = Linked,
            Status = Status,
            SampledAt = SampledAt,
            Stale = Stale,
            BridgeIp = BridgeIp,
            BridgeName = BridgeName,
            CertificateTrusted = CertificateTrusted,
            CertificateTrustRequired = CertificateTrustRequired,
            CertificateThumbprint = CertificateThumbprint,
            CertificateSubject = CertificateSubject,
            CertificateMessage = CertificateMessage,
            Lights = Lights.Select(light => light.Clone()).ToList(),
            Groups = Groups.Select(group => group.Clone()).ToList(),
            Source = Source,
            Message = Message
        };
    }

    public static HueSnapshot CreateSetup(string bridgeIp)
    {
        return new HueSnapshot
        {
            Supported = true,
            Configured = !string.IsNullOrWhiteSpace(bridgeIp),
            Linked = false,
            Status = "setup",
            BridgeIp = bridgeIp,
            Message = string.IsNullOrWhiteSpace(bridgeIp)
                ? "Enter your Hue Bridge IP and press the physical link button."
                : "Press the bridge link button, then link it from the dashboard."
        };
    }

    public static HueSnapshot CreateAwaitingLink(string bridgeIp)
    {
        return new HueSnapshot
        {
            Supported = true,
            Configured = true,
            Linked = false,
            Status = "setup",
            BridgeIp = bridgeIp,
            Message = "Press the bridge link button, then finish linking from the dashboard."
        };
    }

    public static HueSnapshot CreateRelinkRequired(string bridgeIp)
    {
        return new HueSnapshot
        {
            Supported = true,
            Configured = true,
            Linked = false,
            Status = "setup",
            BridgeIp = bridgeIp,
            Message = "Stored Hue credentials are no longer accepted. Press the bridge button and relink."
        };
    }

    public static HueSnapshot CreateTrustRequired(string bridgeIp, HueCertificateTrustState state)
    {
        return new HueSnapshot
        {
            Supported = true,
            Configured = true,
            Linked = false,
            Status = "certificate-review",
            BridgeIp = bridgeIp,
            CertificateTrustRequired = true,
            CertificateThumbprint = state.RemoteThumbprint,
            CertificateSubject = state.RemoteSubject,
            CertificateMessage = string.IsNullOrWhiteSpace(state.PolicyError) ? "Review the Hue bridge certificate before linking." : state.PolicyError,
            Message = "Review the Hue bridge certificate, then explicitly trust it before linking."
        };
    }

    public static HueSnapshot CreateError(string bridgeIp, bool configured, string message)
    {
        return new HueSnapshot
        {
            Supported = true,
            Configured = configured,
            Linked = configured,
            Status = "error",
            BridgeIp = bridgeIp,
            Message = message
        };
    }
}

public sealed class HueLightPayload
{
    public string Id { get; set; } = "";

    public string Name { get; set; } = "";

    public bool On { get; set; }

    public int Brightness { get; set; }

    public bool Reachable { get; set; } = true;

    public string Type { get; set; } = "Hue light";

    public string ColorMode { get; set; } = "";

    public int? Hue { get; set; }

    public int? Saturation { get; set; }

    public int? ColorTemperature { get; set; }

    public HueLightPayload Clone()
    {
        return new HueLightPayload
        {
            Id = Id,
            Name = Name,
            On = On,
            Brightness = Brightness,
            Reachable = Reachable,
            Type = Type,
            ColorMode = ColorMode,
            Hue = Hue,
            Saturation = Saturation,
            ColorTemperature = ColorTemperature
        };
    }
}

public sealed class HueGroupPayload
{
    public string Id { get; set; } = "";

    public string Name { get; set; } = "";

    public bool On { get; set; }

    public int Brightness { get; set; }

    public string Type { get; set; } = "Room";

    public int Lights { get; set; }

    public string ColorMode { get; set; } = "";

    public int? Hue { get; set; }

    public int? Saturation { get; set; }

    public int? ColorTemperature { get; set; }

    public HueGroupPayload Clone()
    {
        return new HueGroupPayload
        {
            Id = Id,
            Name = Name,
            On = On,
            Brightness = Brightness,
            Type = Type,
            Lights = Lights,
            ColorMode = ColorMode,
            Hue = Hue,
            Saturation = Saturation,
            ColorTemperature = ColorTemperature
        };
    }
}
