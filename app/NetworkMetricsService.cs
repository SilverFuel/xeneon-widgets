using System.Net.NetworkInformation;

namespace XenonEdgeHost;

public sealed class NetworkMetricsService : IDisposable
{
    private readonly HostLogger _logger;
    private readonly object _sync = new();
    private System.Threading.Timer? _throughputTimer;
    private System.Threading.Timer? _pingTimer;
    private NetworkSnapshot _snapshot = new();
    private long _lastBytesReceived;
    private long _lastBytesSent;
    private DateTimeOffset _lastSampleTime = DateTimeOffset.MinValue;
    private bool _started;

    public NetworkMetricsService(HostLogger logger)
    {
        _logger = logger;
    }

    public void Start()
    {
        if (_started)
        {
            return;
        }

        _started = true;
        SampleThroughput();
        SamplePing();
        _throughputTimer = new System.Threading.Timer(_ => SampleThroughput(), null, TimeSpan.FromSeconds(2), TimeSpan.FromSeconds(2));
        _pingTimer = new System.Threading.Timer(_ => SamplePing(), null, TimeSpan.FromSeconds(5), TimeSpan.FromSeconds(5));
        _logger.Info("Native network metrics service started.");
    }

    public NetworkSnapshot GetSnapshot()
    {
        lock (_sync)
        {
            var snapshot = _snapshot.Clone();
            var sampledAt = snapshot.SampledAt;
            snapshot.Stale = !sampledAt.HasValue || DateTimeOffset.UtcNow - sampledAt.Value > TimeSpan.FromSeconds(12);
            if (!snapshot.Supported)
            {
                snapshot.Status = "unsupported";
            }
            else if (snapshot.Stale)
            {
                snapshot.Status = sampledAt.HasValue ? "stale" : "starting";
            }
            else if (string.IsNullOrWhiteSpace(snapshot.Status) || snapshot.Status == "starting")
            {
                snapshot.Status = "live";
            }
            return snapshot;
        }
    }

    public void Dispose()
    {
        _throughputTimer?.Dispose();
        _pingTimer?.Dispose();
    }

    private void SampleThroughput()
    {
        try
        {
            var interfaces = NetworkInterface
                .GetAllNetworkInterfaces()
                .Where(network => network.OperationalStatus == OperationalStatus.Up
                                  && network.NetworkInterfaceType != NetworkInterfaceType.Loopback
                                  && network.NetworkInterfaceType != NetworkInterfaceType.Tunnel)
                .ToList();

            var totalBytesReceived = 0L;
            var totalBytesSent = 0L;

            foreach (var network in interfaces)
            {
                try
                {
                    var statistics = network.GetIPv4Statistics();
                    totalBytesReceived += statistics.BytesReceived;
                    totalBytesSent += statistics.BytesSent;
                }
                catch
                {
                }
            }

            var now = DateTimeOffset.UtcNow;
            var elapsedSeconds = _lastSampleTime == DateTimeOffset.MinValue
                ? 0
                : Math.Max(0.001, (now - _lastSampleTime).TotalSeconds);
            var deltaReceived = _lastSampleTime == DateTimeOffset.MinValue
                ? 0
                : Math.Max(0, totalBytesReceived - _lastBytesReceived);
            var deltaSent = _lastSampleTime == DateTimeOffset.MinValue
                ? 0
                : Math.Max(0, totalBytesSent - _lastBytesSent);

            _lastBytesReceived = totalBytesReceived;
            _lastBytesSent = totalBytesSent;
            _lastSampleTime = now;

            var primaryInterface = interfaces
                .OrderByDescending(network => network.Speed)
                .FirstOrDefault();
            var type = MapNetworkType(primaryInterface);

            lock (_sync)
            {
                var sampledAt = DateTimeOffset.UtcNow;
                _snapshot.Download = RoundMbps(deltaReceived, elapsedSeconds);
                _snapshot.Upload = RoundMbps(deltaSent, elapsedSeconds);
                _snapshot.Type = type;
                _snapshot.Supported = true;
                _snapshot.Status = "live";
                _snapshot.SampledAt = sampledAt;
                _snapshot.Stale = false;
                _snapshot.Source = "native host";
                _snapshot.Message = "";
            }
        }
        catch (Exception error)
        {
            _logger.Error("Failed to sample native network throughput.", error);
        }
    }

    private void SamplePing()
    {
        _ = Task.Run(async () =>
        {
            try
            {
                using var ping = new Ping();
                var reply = await ping.SendPingAsync("1.1.1.1", 1000);
                lock (_sync)
                {
                    _snapshot.Ping = reply.Status == IPStatus.Success ? reply.RoundtripTime : null;
                    _snapshot.SampledAt = DateTimeOffset.UtcNow;
                    _snapshot.Stale = false;
                }
            }
            catch (Exception error)
            {
                _logger.Warn($"Ping sample failed: {error.Message}");
                lock (_sync)
                {
                    _snapshot.Ping = null;
                }
            }
        });
    }

    private static string MapNetworkType(NetworkInterface? networkInterface)
    {
        if (networkInterface is null)
        {
            return "unknown";
        }

        return networkInterface.NetworkInterfaceType switch
        {
            NetworkInterfaceType.Wireless80211 => "wifi",
            NetworkInterfaceType.Ethernet => "ethernet",
            NetworkInterfaceType.GigabitEthernet => "ethernet",
            _ => "ethernet"
        };
    }

    private static double RoundMbps(long deltaBytes, double elapsedSeconds)
    {
        if (elapsedSeconds <= 0)
        {
            return 0;
        }

        var bitsPerSecond = (deltaBytes * 8d) / elapsedSeconds;
        return Math.Round(bitsPerSecond / 1024d / 1024d, 2);
    }
}

public sealed class NetworkSnapshot
{
    public bool Supported { get; set; } = true;

    public string Status { get; set; } = "starting";

    public DateTimeOffset? SampledAt { get; set; }

    public bool Stale { get; set; }

    public string Message { get; set; } = "";

    public double? Download { get; set; }

    public double? Upload { get; set; }

    public long? Ping { get; set; }

    public string Type { get; set; } = "unknown";

    public string Source { get; set; } = "native host";

    public NetworkSnapshot Clone()
    {
        return new NetworkSnapshot
        {
            Supported = Supported,
            Status = Status,
            SampledAt = SampledAt,
            Stale = Stale,
            Message = Message,
            Download = Download,
            Upload = Upload,
            Ping = Ping,
            Type = Type,
            Source = Source
        };
    }
}
