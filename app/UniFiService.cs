using System.Net;
using System.Net.NetworkInformation;
using System.Net.Sockets;
using System.Text.RegularExpressions;

namespace XenonEdgeHost;

public sealed class UniFiService : IDisposable
{
    private static readonly TimeSpan DiscoveryCacheTtl = TimeSpan.FromMinutes(2);

    private readonly HostLogger _logger;
    private readonly HttpClient _httpClient;
    private readonly object _sync = new();
    private readonly CancellationTokenSource _disposeCancellation = new();
    private UniFiDiscovery? _cachedDiscovery;
    private DateTimeOffset _cachedAt = DateTimeOffset.MinValue;
    private Task? _refreshTask;

    public UniFiService(HostLogger logger)
    {
        _logger = logger;
        var handler = new HttpClientHandler
        {
            ServerCertificateCustomValidationCallback = HttpClientHandler.DangerousAcceptAnyServerCertificateValidator
        };
        _httpClient = new HttpClient(handler)
        {
            Timeout = TimeSpan.FromSeconds(2)
        };
    }

    public async Task<UniFiNetworkPayload> GetNetworkPayloadAsync(NetworkSnapshot network, CancellationToken cancellationToken)
    {
        var discovery = await DiscoverAsync(cancellationToken);
        return BuildPayload(network, discovery, false);
    }

    public UniFiNetworkPayload GetCachedNetworkPayload(NetworkSnapshot network)
    {
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

        return BuildPayload(network, discovery ?? CreateMissingDiscovery(), discovery is null);
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
        _httpClient.Dispose();
        _disposeCancellation.Dispose();
    }

    private static UniFiNetworkPayload BuildPayload(NetworkSnapshot network, UniFiDiscovery discovery, bool checking)
    {
        var download = network.Download;
        var upload = network.Upload;

        if (!discovery.Detected)
        {
            return new UniFiNetworkPayload
            {
                Supported = true,
                Configured = false,
                Detected = false,
                Status = checking ? "checking" : "setup",
                Message = checking
                    ? "Xenon is checking your local network for UniFi in the background."
                    : "Xenon could not find a local UniFi console yet.",
                Gateway = "UniFi Network",
                GatewayCopy = checking ? "Discovery is running in the background." : "Open UniFi locally once, then refresh Xenon.",
                Source = "Xenon UniFi detector",
                Provider = "UniFi",
                Wan = new UniFiWanPayload
                {
                    Name = "Local connection",
                    DownloadMbps = download,
                    UploadMbps = upload,
                    CapacityDownMbps = 1000,
                    CapacityUpMbps = 100
                },
                LatencyMs = network.Ping,
                Clients = new UniFiClientsPayload()
            };
        }

        return new UniFiNetworkPayload
        {
            Supported = true,
            Configured = false,
            Detected = true,
            Status = "detected",
            Message = "UniFi detected. Full client and AP stats can be added later.",
            Gateway = discovery.Name,
            GatewayCopy = $"Detected locally at {discovery.Url}.",
            Source = "Xenon UniFi detector",
            Provider = discovery.Provider,
            GatewayIp = discovery.Host,
            Wan = new UniFiWanPayload
            {
                Name = "Local WAN sample",
                DownloadMbps = download,
                UploadMbps = upload,
                CapacityDownMbps = 1000,
                CapacityUpMbps = 100
            },
            LatencyMs = network.Ping,
            PacketLoss = 0,
            Clients = new UniFiClientsPayload(),
            Aps =
            [
                new UniFiApPayload
                {
                    Name = discovery.Name,
                    Status = "detected",
                    Clients = 0,
                    Channel = "UniFi OS",
                    Uplink = discovery.Host
                }
            ],
            Connectivity =
            [
                new UniFiHealthPayload { Label = "Local console", Value = 100 },
                new UniFiHealthPayload { Label = "Xenon bridge", Value = network.Status == "live" ? 100 : 65 }
            ]
        };
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

        foreach (var host in GetCandidateHosts())
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
            using var response = await _httpClient.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, cancellationToken);
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

    private static IEnumerable<string> GetCandidateHosts()
    {
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

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

    public bool Detected { get; set; }

    public string Status { get; set; } = "setup";

    public string Message { get; set; } = "";

    public string Gateway { get; set; } = "UniFi Network";

    public string GatewayCopy { get; set; } = "";

    public string Source { get; set; } = "Xenon UniFi detector";

    public string Provider { get; set; } = "UniFi";

    public string GatewayIp { get; set; } = "";

    public UniFiWanPayload Wan { get; set; } = new();

    public UniFiClientsPayload Clients { get; set; } = new();

    public long? LatencyMs { get; set; }

    public double? PacketLoss { get; set; }

    public List<UniFiApPayload> Aps { get; set; } = [];

    public List<object> TopClients { get; set; } = [];

    public List<object> TopApps { get; set; } = [];

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
