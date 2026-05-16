using System.Globalization;
using System.Net;
using System.Net.Http.Json;
using System.Net.NetworkInformation;
using System.Net.Sockets;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace XenonEdgeHost;

public sealed class UniFiService : IDisposable
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase
    };
    private static readonly TimeSpan DiscoveryCacheTtl = TimeSpan.FromMinutes(2);
    private static readonly TimeSpan LinkedCacheTtl = TimeSpan.FromSeconds(8);

    private readonly ConfigStore _configStore;
    private readonly HostLogger _logger;
    private readonly HttpClient _discoveryClient;
    private readonly object _sync = new();
    private readonly CancellationTokenSource _disposeCancellation = new();
    private UniFiDiscovery? _cachedDiscovery;
    private DateTimeOffset _cachedAt = DateTimeOffset.MinValue;
    private Task? _refreshTask;
    private UniFiNetworkPayload? _cachedLinkedPayload;
    private DateTimeOffset _linkedCachedAt = DateTimeOffset.MinValue;
    private string _linkedCacheKey = "";

    public UniFiService(ConfigStore configStore, HostLogger logger)
    {
        _configStore = configStore;
        _logger = logger;
        _discoveryClient = new HttpClient(new HttpClientHandler
        {
            ServerCertificateCustomValidationCallback = HttpClientHandler.DangerousAcceptAnyServerCertificateValidator
        })
        {
            Timeout = TimeSpan.FromSeconds(2)
        };
    }

    public async Task<UniFiNetworkPayload> GetNetworkPayloadAsync(NetworkSnapshot network, CancellationToken cancellationToken)
    {
        var config = GetConfigSnapshot(_configStore.Snapshot());
        var discovery = await DiscoverAsync(cancellationToken);
        if (config.Configured)
        {
            return await GetLinkedPayloadAsync(config, discovery, network, cancellationToken);
        }

        return BuildDiscoveryPayload(network, discovery, checking: false);
    }

    public UniFiNetworkPayload GetCachedNetworkPayload(NetworkSnapshot network)
    {
        var config = GetConfigSnapshot(_configStore.Snapshot());
        if (config.Configured)
        {
            lock (_sync)
            {
                if (_cachedLinkedPayload is not null && DateTimeOffset.UtcNow - _linkedCachedAt < TimeSpan.FromSeconds(30))
                {
                    return MergeNativeNetwork(ClonePayload(_cachedLinkedPayload), network);
                }
            }
        }

        UniFiDiscovery? discovery;
        bool shouldRefresh;
        lock (_sync)
        {
            discovery = _cachedDiscovery;
            shouldRefresh = discovery is null || DateTimeOffset.UtcNow - _cachedAt > DiscoveryCacheTtl;
        }

        if (shouldRefresh)
        {
            RefreshDiscoveryInBackground();
        }

        return config.Configured
            ? BuildConfiguredSetupPayload(config, discovery ?? CreateMissingDiscovery(), network)
            : BuildDiscoveryPayload(network, discovery ?? CreateMissingDiscovery(), discovery is null);
    }

    public async Task<UniFiNetworkPayload> LinkAsync(UniFiLinkRequest request, NetworkSnapshot network, CancellationToken cancellationToken)
    {
        var discovery = await DiscoverAsync(cancellationToken);
        var existing = GetConfigSnapshot(_configStore.Snapshot());
        var host = NormalizeHost(request.Host) ?? discovery.Host;
        var username = request.Username?.Trim() ?? "";
        var password = request.Password?.Trim() ?? "";
        var site = NormalizeSite(request.Site);

        if (string.IsNullOrWhiteSpace(host))
        {
            throw new InvalidOperationException("UniFi console was not found. Enter the console IP or hostname.");
        }

        if (string.IsNullOrWhiteSpace(username))
        {
            username = existing.Host.Equals(host, StringComparison.OrdinalIgnoreCase) ? existing.Username : "";
        }

        if (string.IsNullOrWhiteSpace(password))
        {
            password = existing.Host.Equals(host, StringComparison.OrdinalIgnoreCase) ? existing.Password : "";
        }

        if (string.IsNullOrWhiteSpace(username))
        {
            throw new InvalidOperationException("UniFi username is required.");
        }

        if (string.IsNullOrWhiteSpace(password))
        {
            throw new InvalidOperationException("UniFi password is required.");
        }

        var linkedConfig = new UniFiConfigSnapshot(host, username, password, site);
        var payload = await FetchLinkedPayloadAsync(linkedConfig, discovery, network, cancellationToken);
        _configStore.Update(current =>
        {
            current.UniFi.Host = host;
            current.UniFi.Username = username;
            current.UniFi.Password = password;
            current.UniFi.Site = site;
            return current;
        });

        CacheLinkedPayload(payload, linkedConfig);
        return payload;
    }

    public UniFiNetworkPayload Disconnect(NetworkSnapshot network)
    {
        _configStore.Update(current =>
        {
            current.UniFi.Host = "";
            current.UniFi.Username = "";
            current.UniFi.Password = "";
            current.UniFi.Site = "default";
            return current;
        });

        lock (_sync)
        {
            _cachedLinkedPayload = null;
            _linkedCacheKey = "";
            _linkedCachedAt = DateTimeOffset.MinValue;
        }

        return BuildDiscoveryPayload(network, _cachedDiscovery ?? CreateMissingDiscovery(), checking: false);
    }

    public void RefreshDiscoveryInBackground()
    {
        lock (_sync)
        {
            if (_refreshTask is not null && !_refreshTask.IsCompleted)
            {
                return;
            }

            _refreshTask = Task.Run(async () =>
            {
                try
                {
                    await DiscoverAsync(_disposeCancellation.Token, forceRefresh: true);
                }
                catch (OperationCanceledException)
                {
                }
                catch (Exception error)
                {
                    _logger.Warn($"Background UniFi discovery failed: {error.Message}");
                }
            });
        }
    }

    public void Dispose()
    {
        _disposeCancellation.Cancel();
        _discoveryClient.Dispose();
        _disposeCancellation.Dispose();
    }

    private async Task<UniFiNetworkPayload> GetLinkedPayloadAsync(
        UniFiConfigSnapshot config,
        UniFiDiscovery discovery,
        NetworkSnapshot network,
        CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(config.Password))
        {
            return BuildConfiguredSetupPayload(config, discovery, network);
        }

        lock (_sync)
        {
            if (_cachedLinkedPayload is not null
                && string.Equals(_linkedCacheKey, config.CacheKey, StringComparison.Ordinal)
                && DateTimeOffset.UtcNow - _linkedCachedAt < LinkedCacheTtl)
            {
                return MergeNativeNetwork(ClonePayload(_cachedLinkedPayload), network);
            }
        }

        try
        {
            var payload = await FetchLinkedPayloadAsync(config, discovery, network, cancellationToken);
            CacheLinkedPayload(payload, config);
            return payload;
        }
        catch (Exception error) when (error is HttpRequestException or InvalidOperationException or TaskCanceledException or JsonException)
        {
            _logger.Warn($"UniFi refresh failed: {error.Message}");
            return BuildConfiguredErrorPayload(config, discovery, network, error.Message);
        }
    }

    private async Task<UniFiNetworkPayload> FetchLinkedPayloadAsync(
        UniFiConfigSnapshot config,
        UniFiDiscovery discovery,
        NetworkSnapshot network,
        CancellationToken cancellationToken)
    {
        using var session = CreateSession(config.Host);
        var mode = await LoginAsync(session, config, cancellationToken);
        var site = Uri.EscapeDataString(config.Site);

        using var clientsDocument = await ReadDocumentAsync(session, $"{mode.NetworkPrefix}/api/s/{site}/stat/sta", cancellationToken);
        var clientSummary = NormalizeClients(clientsDocument.RootElement);

        var aps = new List<UniFiApPayload>();
        using (var devicesDocument = await TryReadDocumentAsync(session, $"{mode.NetworkPrefix}/api/s/{site}/stat/device", cancellationToken))
        {
            if (devicesDocument is not null)
            {
                aps = NormalizeAps(devicesDocument.RootElement);
            }
        }

        var connectivity = new List<UniFiHealthPayload>
        {
            new() { Label = "Internet", Value = network.Ping.HasValue ? 100 : 55 },
            new() { Label = "UniFi API", Value = 100 },
            new() { Label = "Clients", Value = clientSummary.Clients.Total > 0 ? 100 : 72 }
        };
        long? latency = network.Ping;

        using (var healthDocument = await TryReadDocumentAsync(session, $"{mode.NetworkPrefix}/api/s/{site}/stat/health", cancellationToken))
        {
            if (healthDocument is not null)
            {
                connectivity = NormalizeHealth(healthDocument.RootElement, connectivity);
                latency ??= ReadHealthLatency(healthDocument.RootElement);
            }
        }

        return new UniFiNetworkPayload
        {
            Supported = true,
            Configured = true,
            Linked = true,
            Detected = true,
            Status = "live",
            Message = "UniFi Network is linked locally.",
            Gateway = string.IsNullOrWhiteSpace(discovery.Name) || !discovery.Detected ? $"UniFi {config.Host}" : discovery.Name,
            GatewayCopy = $"Connected locally to https://{config.Host}.",
            Source = mode.Label,
            Provider = "UniFi Network",
            GatewayIp = config.Host,
            Site = config.Site,
            Wan = new UniFiWanPayload
            {
                Name = "Local WAN sample",
                DownloadMbps = network.Download,
                UploadMbps = network.Upload,
                CapacityDownMbps = Math.Max(100, network.LinkSpeedMbps ?? 1000),
                CapacityUpMbps = Math.Max(100, network.LinkSpeedMbps ?? 1000)
            },
            LatencyMs = latency,
            PacketLoss = network.Ping.HasValue ? 0 : null,
            Clients = clientSummary.Clients,
            Aps = aps,
            TopClients = clientSummary.TopClients,
            Connectivity = connectivity
        };
    }

    private static UniFiNetworkPayload BuildDiscoveryPayload(NetworkSnapshot network, UniFiDiscovery discovery, bool checking)
    {
        var detected = discovery.Detected;
        return new UniFiNetworkPayload
        {
            Supported = true,
            Configured = false,
            Linked = false,
            Detected = detected,
            Status = detected ? "detected" : checking ? "checking" : "setup",
            Message = detected
                ? "UniFi console detected. Connect with local UniFi credentials for clients and APs."
                : checking
                    ? "Xenon is checking your local network for UniFi in the background."
                    : "No UniFi console is linked.",
            Gateway = detected ? discovery.Name : "UniFi Network",
            GatewayCopy = detected ? $"Detected locally at {discovery.Url}." : "Connect a local UniFi console when you want gateway detail.",
            Source = "Xenon UniFi detector",
            Provider = detected ? discovery.Provider : "UniFi",
            GatewayIp = discovery.Host,
            Wan = new UniFiWanPayload
            {
                Name = "Local connection",
                DownloadMbps = network.Download,
                UploadMbps = network.Upload,
                CapacityDownMbps = Math.Max(100, network.LinkSpeedMbps ?? 1000),
                CapacityUpMbps = Math.Max(100, network.LinkSpeedMbps ?? 1000)
            },
            LatencyMs = network.Ping,
            Clients = new UniFiClientsPayload(),
            Aps = detected
                ?
                [
                    new UniFiApPayload
                    {
                        Name = discovery.Name,
                        Status = "detected",
                        Channel = "UniFi OS",
                        Uplink = discovery.Host
                    }
                ]
                : [],
            Connectivity =
            [
                new UniFiHealthPayload { Label = "Internet", Value = network.Ping.HasValue ? 100 : 55 },
                new UniFiHealthPayload { Label = "Local network", Value = string.IsNullOrWhiteSpace(network.Gateway) ? 70 : 100 }
            ]
        };
    }

    private static UniFiNetworkPayload BuildConfiguredSetupPayload(UniFiConfigSnapshot config, UniFiDiscovery discovery, NetworkSnapshot network)
    {
        var payload = BuildDiscoveryPayload(network, discovery.Detected ? discovery : CreateDetected(config.Host, $"https://{config.Host}/", "UniFi Network"), false);
        payload.Configured = true;
        payload.Linked = false;
        payload.Detected = true;
        payload.Status = "setup";
        payload.Message = "UniFi is saved but needs a password refresh.";
        payload.GatewayIp = config.Host;
        payload.Site = config.Site;
        payload.GatewayCopy = $"Saved console https://{config.Host}.";
        return payload;
    }

    private static UniFiNetworkPayload BuildConfiguredErrorPayload(UniFiConfigSnapshot config, UniFiDiscovery discovery, NetworkSnapshot network, string message)
    {
        var payload = BuildConfiguredSetupPayload(config, discovery, network);
        payload.Status = "error";
        payload.Message = string.IsNullOrWhiteSpace(message) ? "UniFi link failed." : message;
        payload.Source = "UniFi local API";
        return payload;
    }

    private void CacheLinkedPayload(UniFiNetworkPayload payload, UniFiConfigSnapshot config)
    {
        lock (_sync)
        {
            _cachedLinkedPayload = ClonePayload(payload);
            _linkedCachedAt = DateTimeOffset.UtcNow;
            _linkedCacheKey = config.CacheKey;
        }
    }

    private static UniFiNetworkPayload MergeNativeNetwork(UniFiNetworkPayload payload, NetworkSnapshot network)
    {
        payload.Wan.DownloadMbps = network.Download;
        payload.Wan.UploadMbps = network.Upload;
        payload.LatencyMs = network.Ping ?? payload.LatencyMs;
        payload.PacketLoss = network.Ping.HasValue ? 0 : payload.PacketLoss;
        return payload;
    }

    private async Task<UniFiDiscovery> DiscoverAsync(CancellationToken cancellationToken, bool forceRefresh = false)
    {
        lock (_sync)
        {
            if (!forceRefresh && _cachedDiscovery is not null && DateTimeOffset.UtcNow - _cachedAt < DiscoveryCacheTtl)
            {
                return _cachedDiscovery;
            }
        }

        foreach (var host in GetCandidateHosts(GetConfigSnapshot(_configStore.Snapshot()).Host))
        {
            var discovery = await ProbeHostAsync(host, cancellationToken);
            if (discovery.Detected)
            {
                Cache(discovery);
                return discovery;
            }
        }

        var missing = CreateMissingDiscovery();
        Cache(missing);
        return missing;
    }

    private async Task<UniFiDiscovery> ProbeHostAsync(string host, CancellationToken cancellationToken)
    {
        var url = $"https://{host}/";
        try
        {
            using var request = new HttpRequestMessage(HttpMethod.Get, url);
            using var response = await _discoveryClient.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, cancellationToken);
            if (response.StatusCode is HttpStatusCode.Unauthorized or HttpStatusCode.Forbidden)
            {
                return CreateDetected(host, url, "UniFi OS");
            }

            var content = await response.Content.ReadAsStringAsync(cancellationToken);
            var title = ReadTitle(content);
            var looksLikeUniFi = title.Contains("UniFi", StringComparison.OrdinalIgnoreCase)
                || content.Contains("UniFi", StringComparison.OrdinalIgnoreCase)
                || content.Contains("Ubiquiti", StringComparison.OrdinalIgnoreCase);

            return looksLikeUniFi
                ? CreateDetected(host, url, string.IsNullOrWhiteSpace(title) ? "UniFi OS" : title)
                : new UniFiDiscovery { Detected = false };
        }
        catch (Exception error) when (error is HttpRequestException or TaskCanceledException or OperationCanceledException or ObjectDisposedException)
        {
            return new UniFiDiscovery { Detected = false };
        }
        catch (Exception error)
        {
            _logger.Warn($"UniFi probe failed for {host}: {error.Message}");
            return new UniFiDiscovery { Detected = false };
        }
    }

    private static UniFiSession CreateSession(string host)
    {
        var cookies = new CookieContainer();
        var handler = new HttpClientHandler
        {
            CookieContainer = cookies,
            UseCookies = true,
            ServerCertificateCustomValidationCallback = HttpClientHandler.DangerousAcceptAnyServerCertificateValidator
        };
        return new UniFiSession(new HttpClient(handler) { Timeout = TimeSpan.FromSeconds(8) }, new Uri($"https://{host.TrimEnd('/')}/"));
    }

    private static async Task<UniFiApiMode> LoginAsync(UniFiSession session, UniFiConfigSnapshot config, CancellationToken cancellationToken)
    {
        var loginPayload = new
        {
            username = config.Username,
            password = config.Password,
            remember = true
        };
        var modes = new[]
        {
            new UniFiApiMode("UniFi OS local API", "/api/auth/login", "/proxy/network"),
            new UniFiApiMode("UniFi Controller local API", "/api/login", "")
        };
        var lastMessage = "";

        foreach (var mode in modes)
        {
            using var response = await session.Client.PostAsJsonAsync(new Uri(session.BaseUri, mode.LoginPath), loginPayload, JsonOptions, cancellationToken);
            var raw = await response.Content.ReadAsStringAsync(cancellationToken);
            if (response.IsSuccessStatusCode)
            {
                return mode;
            }

            if (response.StatusCode is HttpStatusCode.NotFound or HttpStatusCode.MethodNotAllowed)
            {
                lastMessage = $"Login endpoint {mode.LoginPath} was not accepted.";
                continue;
            }

            lastMessage = ExtractError(raw) ?? $"UniFi login failed with status {(int)response.StatusCode}.";
        }

        throw new InvalidOperationException(string.IsNullOrWhiteSpace(lastMessage) ? "UniFi login failed." : lastMessage);
    }

    private static async Task<JsonDocument> ReadDocumentAsync(UniFiSession session, string path, CancellationToken cancellationToken)
    {
        using var response = await session.Client.GetAsync(new Uri(session.BaseUri, path), cancellationToken);
        var raw = await response.Content.ReadAsStringAsync(cancellationToken);
        if (!response.IsSuccessStatusCode)
        {
            throw new InvalidOperationException(ExtractError(raw) ?? $"UniFi request failed with status {(int)response.StatusCode}.");
        }

        return string.IsNullOrWhiteSpace(raw) ? JsonDocument.Parse("{}") : JsonDocument.Parse(raw);
    }

    private static async Task<JsonDocument?> TryReadDocumentAsync(UniFiSession session, string path, CancellationToken cancellationToken)
    {
        try
        {
            return await ReadDocumentAsync(session, path, cancellationToken);
        }
        catch
        {
            return null;
        }
    }

    private static UniFiClientSummary NormalizeClients(JsonElement root)
    {
        var clients = new List<UniFiClientPayload>();
        var wired = 0;
        var guests = 0;

        foreach (var item in EnumerateData(root))
        {
            var isWired = TryGetBool(item, "is_wired")
                || (!HasString(item, "essid") && (HasProperty(item, "sw_port") || HasProperty(item, "wired-tx_bytes")));
            var isGuest = TryGetBool(item, "is_guest");
            wired += isWired ? 1 : 0;
            guests += isGuest ? 1 : 0;

            var totalBytes = Math.Max(0, TryGetLong(item, "rx_bytes") ?? 0)
                + Math.Max(0, TryGetLong(item, "tx_bytes") ?? 0);
            var rateMbps = RateToMbps(TryGetDouble(item, "rx_rate") ?? 0)
                + RateToMbps(TryGetDouble(item, "tx_rate") ?? 0);
            var name = FirstString(item, "name", "hostname", "display_name", "oui", "mac");

            clients.Add(new UniFiClientPayload
            {
                Name = string.IsNullOrWhiteSpace(name) ? "Client" : name,
                Ip = FirstString(item, "ip", "fixed_ip"),
                Mac = FirstString(item, "mac"),
                Connection = isWired ? "Wired" : "Wi-Fi",
                Usage = totalBytes > 0 ? FormatBytes(totalBytes) : "--",
                Rate = rateMbps > 0 ? FormatMbps(rateMbps) : "--",
                Bytes = totalBytes
            });
        }

        var total = clients.Count;
        return new UniFiClientSummary(
            new UniFiClientsPayload
            {
                Total = total,
                Wifi = Math.Max(0, total - wired),
                Wired = wired,
                Guests = guests
            },
            clients
                .OrderByDescending(client => client.Bytes)
                .ThenBy(client => client.Name, StringComparer.OrdinalIgnoreCase)
                .Take(6)
                .ToList());
    }

    private static List<UniFiApPayload> NormalizeAps(JsonElement root)
    {
        var aps = new List<UniFiApPayload>();
        foreach (var item in EnumerateData(root))
        {
            var type = FirstString(item, "type", "model", "displayable_version");
            var looksLikeAp = string.Equals(type, "uap", StringComparison.OrdinalIgnoreCase)
                || type.Contains("uap", StringComparison.OrdinalIgnoreCase)
                || HasProperty(item, "radio_table");
            if (!looksLikeAp)
            {
                continue;
            }

            var state = TryGetInt(item, "state");
            var clients = TryGetInt(item, "num_sta")
                ?? TryGetInt(item, "user-num_sta")
                ?? TryGetInt(item, "guest-num_sta")
                ?? 0;
            var throughput = RateToMbps(TryGetDouble(item, "rx_bytes-r") ?? 0)
                + RateToMbps(TryGetDouble(item, "tx_bytes-r") ?? 0);

            aps.Add(new UniFiApPayload
            {
                Name = FirstString(item, "name", "hostname", "model", "mac"),
                Status = state == 1 || TryGetBool(item, "adopted") ? "online" : "offline",
                Clients = Math.Max(0, clients),
                Channel = ReadApChannel(item),
                Uplink = FirstString(item, "ip", "uplink_device_name", "mac"),
                ThroughputMbps = throughput > 0 ? Math.Round(throughput, 1) : null
            });
        }

        return aps
            .OrderBy(ap => ap.Name, StringComparer.OrdinalIgnoreCase)
            .Take(8)
            .ToList();
    }

    private static List<UniFiHealthPayload> NormalizeHealth(JsonElement root, List<UniFiHealthPayload> fallback)
    {
        var health = new List<UniFiHealthPayload>();
        foreach (var item in EnumerateData(root))
        {
            var label = FirstString(item, "subsystem", "name", "status");
            if (string.IsNullOrWhiteSpace(label))
            {
                continue;
            }

            var status = FirstString(item, "status", "state");
            var value = status.Contains("ok", StringComparison.OrdinalIgnoreCase) || status.Contains("good", StringComparison.OrdinalIgnoreCase)
                ? 100
                : status.Contains("error", StringComparison.OrdinalIgnoreCase) || status.Contains("fail", StringComparison.OrdinalIgnoreCase)
                    ? 35
                    : 75;
            health.Add(new UniFiHealthPayload { Label = CultureInfo.InvariantCulture.TextInfo.ToTitleCase(label.Replace('_', ' ')), Value = value });
        }

        return health.Count > 0 ? health.Take(6).ToList() : fallback;
    }

    private static long? ReadHealthLatency(JsonElement root)
    {
        foreach (var item in EnumerateData(root))
        {
            var latency = TryGetLong(item, "latency") ?? TryGetLong(item, "wan_latency");
            if (latency.HasValue)
            {
                return latency;
            }
        }

        return null;
    }

    private static IEnumerable<JsonElement> EnumerateData(JsonElement root)
    {
        if (root.ValueKind == JsonValueKind.Object && root.TryGetProperty("data", out var data) && data.ValueKind == JsonValueKind.Array)
        {
            foreach (var item in data.EnumerateArray())
            {
                yield return item;
            }
        }
        else if (root.ValueKind == JsonValueKind.Array)
        {
            foreach (var item in root.EnumerateArray())
            {
                yield return item;
            }
        }
    }

    private static string ReadApChannel(JsonElement item)
    {
        if (item.TryGetProperty("radio_table", out var radios) && radios.ValueKind == JsonValueKind.Array)
        {
            foreach (var radio in radios.EnumerateArray())
            {
                var channel = FirstString(radio, "channel", "radio");
                if (!string.IsNullOrWhiteSpace(channel))
                {
                    return channel;
                }
            }
        }

        return FirstString(item, "version", "model");
    }

    private static UniFiDiscovery CreateDetected(string host, string url, string title)
    {
        var name = title.Contains("UniFi", StringComparison.OrdinalIgnoreCase) ? title : "UniFi OS";
        return new UniFiDiscovery
        {
            Detected = true,
            Name = string.IsNullOrWhiteSpace(name) ? "UniFi OS" : name,
            Provider = "UniFi OS",
            Url = url.TrimEnd('/'),
            Host = host
        };
    }

    private static UniFiDiscovery CreateMissingDiscovery()
    {
        return new UniFiDiscovery
        {
            Detected = false,
            Name = "UniFi Network",
            Provider = "UniFi",
            Url = "",
            Host = ""
        };
    }

    private void Cache(UniFiDiscovery discovery)
    {
        lock (_sync)
        {
            _cachedDiscovery = discovery;
            _cachedAt = DateTimeOffset.UtcNow;
        }
    }

    private static IEnumerable<string> GetCandidateHosts(string configuredHost)
    {
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        if (!string.IsNullOrWhiteSpace(configuredHost) && seen.Add(configuredHost))
        {
            yield return configuredHost;
        }

        foreach (var gateway in GetGatewayHosts())
        {
            if (seen.Add(gateway))
            {
                yield return gateway;
            }
        }

        foreach (var fallback in new[] { "192.168.0.1", "192.168.1.1", "unifi" })
        {
            if (seen.Add(fallback))
            {
                yield return fallback;
            }
        }
    }

    private static IEnumerable<string> GetGatewayHosts()
    {
        foreach (var network in NetworkInterface.GetAllNetworkInterfaces())
        {
            if (network.OperationalStatus != OperationalStatus.Up
                || network.NetworkInterfaceType == NetworkInterfaceType.Loopback
                || network.NetworkInterfaceType == NetworkInterfaceType.Tunnel)
            {
                continue;
            }

            IPInterfaceProperties properties;
            try
            {
                properties = network.GetIPProperties();
            }
            catch
            {
                continue;
            }

            foreach (var gateway in properties.GatewayAddresses)
            {
                var address = gateway.Address;
                if (address.AddressFamily == AddressFamily.InterNetwork && !Equals(address, IPAddress.Any))
                {
                    yield return address.ToString();
                }
            }
        }
    }

    private static UniFiConfigSnapshot GetConfigSnapshot(AppConfig config)
    {
        var host = NormalizeHost(config.UniFi.Host) ?? "";
        var username = config.UniFi.Username?.Trim() ?? "";
        var password = config.UniFi.Password?.Trim() ?? "";
        return new UniFiConfigSnapshot(host, username, password, NormalizeSite(config.UniFi.Site));
    }

    private static string? NormalizeHost(string? input)
    {
        if (string.IsNullOrWhiteSpace(input))
        {
            return null;
        }

        var trimmed = input.Trim();
        try
        {
            var uri = trimmed.Contains("://", StringComparison.Ordinal)
                ? new Uri(trimmed)
                : new Uri($"https://{trimmed}");
            return uri.Host;
        }
        catch
        {
            var slashIndex = trimmed.IndexOf('/');
            return slashIndex >= 0 ? trimmed[..slashIndex] : trimmed;
        }
    }

    private static string NormalizeSite(string? input)
    {
        var trimmed = input?.Trim() ?? "";
        return string.IsNullOrWhiteSpace(trimmed) ? "default" : trimmed;
    }

    private static string ReadTitle(string html)
    {
        if (string.IsNullOrWhiteSpace(html))
        {
            return "";
        }

        var match = Regex.Match(html, "<title>\\s*(.*?)\\s*</title>", RegexOptions.IgnoreCase | RegexOptions.Singleline);
        return match.Success
            ? WebUtility.HtmlDecode(match.Groups[1].Value).Trim()
            : "";
    }

    private static string? ExtractError(string raw)
    {
        if (string.IsNullOrWhiteSpace(raw))
        {
            return null;
        }

        try
        {
            using var document = JsonDocument.Parse(raw);
            var root = document.RootElement;
            if (root.ValueKind == JsonValueKind.Object)
            {
                return FirstString(root, "meta.msg", "msg", "message", "error");
            }
        }
        catch
        {
        }

        return raw.Length > 180 ? raw[..180] : raw;
    }

    private static string FirstString(JsonElement element, params string[] names)
    {
        foreach (var name in names)
        {
            if (TryReadNested(element, name, out var node))
            {
                if (node.ValueKind == JsonValueKind.String)
                {
                    var value = node.GetString();
                    if (!string.IsNullOrWhiteSpace(value))
                    {
                        return value.Trim();
                    }
                }

                if (node.ValueKind == JsonValueKind.Number || node.ValueKind == JsonValueKind.True || node.ValueKind == JsonValueKind.False)
                {
                    return node.ToString();
                }
            }
        }

        return "";
    }

    private static bool HasString(JsonElement element, string name)
    {
        return TryReadNested(element, name, out var node)
            && node.ValueKind == JsonValueKind.String
            && !string.IsNullOrWhiteSpace(node.GetString());
    }

    private static bool HasProperty(JsonElement element, string name)
    {
        return TryReadNested(element, name, out _);
    }

    private static bool TryGetBool(JsonElement element, string name)
    {
        if (!TryReadNested(element, name, out var node))
        {
            return false;
        }

        return node.ValueKind switch
        {
            JsonValueKind.True => true,
            JsonValueKind.False => false,
            JsonValueKind.Number => node.TryGetInt32(out var value) && value != 0,
            JsonValueKind.String => bool.TryParse(node.GetString(), out var value) && value,
            _ => false
        };
    }

    private static int? TryGetInt(JsonElement element, string name)
    {
        if (!TryReadNested(element, name, out var node))
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

        return node.ValueKind == JsonValueKind.String && int.TryParse(node.GetString(), out var parsed) ? parsed : null;
    }

    private static long? TryGetLong(JsonElement element, string name)
    {
        if (!TryReadNested(element, name, out var node))
        {
            return null;
        }

        if (node.ValueKind == JsonValueKind.Number && node.TryGetInt64(out var longValue))
        {
            return longValue;
        }

        return node.ValueKind == JsonValueKind.String && long.TryParse(node.GetString(), NumberStyles.Any, CultureInfo.InvariantCulture, out var parsed) ? parsed : null;
    }

    private static double? TryGetDouble(JsonElement element, string name)
    {
        if (!TryReadNested(element, name, out var node))
        {
            return null;
        }

        if (node.ValueKind == JsonValueKind.Number && node.TryGetDouble(out var doubleValue))
        {
            return doubleValue;
        }

        return node.ValueKind == JsonValueKind.String && double.TryParse(node.GetString(), NumberStyles.Any, CultureInfo.InvariantCulture, out var parsed) ? parsed : null;
    }

    private static bool TryReadNested(JsonElement element, string path, out JsonElement node)
    {
        node = element;
        foreach (var segment in path.Split('.', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
        {
            if (node.ValueKind != JsonValueKind.Object || !node.TryGetProperty(segment, out node))
            {
                return false;
            }
        }

        return true;
    }

    private static double RateToMbps(double value)
    {
        if (value <= 0)
        {
            return 0;
        }

        return value > 100000
            ? value * 8d / 1024d / 1024d
            : value / 1000d;
    }

    private static string FormatMbps(double value)
    {
        return value >= 10 ? $"{Math.Round(value)} Mbps" : $"{Math.Round(value, 1)} Mbps";
    }

    private static string FormatBytes(long bytes)
    {
        string[] units = ["B", "KB", "MB", "GB", "TB"];
        var value = Math.Max(0, bytes);
        var unit = 0;
        var display = (double)value;
        while (display >= 1024 && unit < units.Length - 1)
        {
            display /= 1024;
            unit++;
        }

        return $"{display.ToString(display >= 10 || unit == 0 ? "0" : "0.0", CultureInfo.InvariantCulture)} {units[unit]}";
    }

    private static UniFiNetworkPayload ClonePayload(UniFiNetworkPayload payload)
    {
        return JsonSerializer.Deserialize<UniFiNetworkPayload>(JsonSerializer.Serialize(payload, JsonOptions), JsonOptions) ?? new UniFiNetworkPayload();
    }

    private sealed record UniFiConfigSnapshot(string Host, string Username, string Password, string Site)
    {
        public bool Configured => !string.IsNullOrWhiteSpace(Host) && !string.IsNullOrWhiteSpace(Username);

        public string CacheKey => $"{Host}|{Username}|{Site}";
    }

    private sealed record UniFiSession(HttpClient Client, Uri BaseUri) : IDisposable
    {
        public void Dispose()
        {
            Client.Dispose();
        }
    }

    private sealed record UniFiApiMode(string Label, string LoginPath, string NetworkPrefix);

    private sealed record UniFiClientSummary(UniFiClientsPayload Clients, List<UniFiClientPayload> TopClients);

    private sealed class UniFiDiscovery
    {
        public bool Detected { get; set; }

        public string Name { get; set; } = "UniFi OS";

        public string Provider { get; set; } = "UniFi";

        public string Url { get; set; } = "";

        public string Host { get; set; } = "";
    }
}

public sealed class UniFiNetworkPayload
{
    public bool Supported { get; set; } = true;

    public bool Configured { get; set; }

    public bool Linked { get; set; }

    public bool Detected { get; set; }

    public string Status { get; set; } = "setup";

    public string Message { get; set; } = "";

    public string Gateway { get; set; } = "UniFi Network";

    public string GatewayCopy { get; set; } = "";

    public string Source { get; set; } = "Xenon UniFi detector";

    public string Provider { get; set; } = "UniFi";

    public string GatewayIp { get; set; } = "";

    public string Site { get; set; } = "default";

    public UniFiWanPayload Wan { get; set; } = new();

    public UniFiClientsPayload Clients { get; set; } = new();

    public long? LatencyMs { get; set; }

    public double? PacketLoss { get; set; }

    public List<UniFiApPayload> Aps { get; set; } = [];

    public List<UniFiClientPayload> TopClients { get; set; } = [];

    public List<UniFiAppPayload> TopApps { get; set; } = [];

    public List<object> CommonDevices { get; set; } = [];

    public List<UniFiHealthPayload> RadioRetries { get; set; } = [];

    public List<UniFiHealthPayload> Connectivity { get; set; } = [];
}

public sealed class UniFiWanPayload
{
    public string Name { get; set; } = "Local WAN sample";

    public double? DownloadMbps { get; set; }

    public double? UploadMbps { get; set; }

    public double CapacityDownMbps { get; set; } = 1000;

    public double CapacityUpMbps { get; set; } = 100;
}

public sealed class UniFiClientsPayload
{
    public int Total { get; set; }

    public int Wifi { get; set; }

    public int Wired { get; set; }

    public int Guests { get; set; }
}

public sealed class UniFiClientPayload
{
    public string Name { get; set; } = "Client";

    public string Ip { get; set; } = "";

    public string Mac { get; set; } = "";

    public string Connection { get; set; } = "";

    public string Usage { get; set; } = "--";

    public string Rate { get; set; } = "--";

    public long Bytes { get; set; }
}

public sealed class UniFiAppPayload
{
    public string Name { get; set; } = "Application";

    public string Category { get; set; } = "";

    public string Usage { get; set; } = "--";
}

public sealed class UniFiApPayload
{
    public string Name { get; set; } = "UniFi OS";

    public string Status { get; set; } = "detected";

    public int Clients { get; set; }

    public string Channel { get; set; } = "";

    public string Uplink { get; set; } = "";

    public double? ThroughputMbps { get; set; }
}

public sealed class UniFiHealthPayload
{
    public string Label { get; set; } = "";

    public double Value { get; set; }
}
