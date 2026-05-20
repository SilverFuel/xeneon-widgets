using System.Diagnostics;

namespace XenonEdgeHost;

public sealed class GameModeSessionService
{
    private readonly SystemMetricsService _systemMetrics;
    private readonly NetworkMetricsService _networkMetrics;
    private readonly AudioService _audioService;
    private readonly UniFiService _uniFiService;
    private readonly SteamService _steamService;
    private readonly GameActivityService _gameActivityService;
    private readonly GamePerformanceService _gamePerformanceService;
    private readonly HostLogger _logger;

    public GameModeSessionService(
        SystemMetricsService systemMetrics,
        NetworkMetricsService networkMetrics,
        AudioService audioService,
        UniFiService uniFiService,
        SteamService steamService,
        GameActivityService gameActivityService,
        GamePerformanceService gamePerformanceService,
        HostLogger logger)
    {
        _systemMetrics = systemMetrics;
        _networkMetrics = networkMetrics;
        _audioService = audioService;
        _uniFiService = uniFiService;
        _steamService = steamService;
        _gameActivityService = gameActivityService;
        _gamePerformanceService = gamePerformanceService;
        _logger = logger;
    }

    public async Task<GameModeSessionSnapshot> GetSnapshotAsync(GameModeSessionRequest request, CancellationToken cancellationToken)
    {
        request ??= new GameModeSessionRequest();
        var timings = new List<CollectorTimingPayload>();
        var sampledAt = DateTimeOffset.UtcNow;
        var system = Capture("system", 80, timings, () => _systemMetrics.GetSnapshot(), new SystemSnapshot());
        var network = Capture("network", 80, timings, () => _networkMetrics.GetSnapshot(), new NetworkSnapshot());
        var uniFi = Capture("unifi-cache", 50, timings, () => _uniFiService.GetCachedNetworkPayload(network), new UniFiNetworkPayload());
        var audio = await CaptureAsync(
            "audio",
            250,
            timings,
            token => _audioService.GetSnapshotAsync(token),
            AudioSnapshotPayload.CreateError("Audio snapshot failed."),
            cancellationToken);
        var steam = Capture(
            "steam",
            request.Refresh || request.SteamRefresh ? 750 : 220,
            timings,
            () => _steamService.GetSnapshot(request.Refresh || request.SteamRefresh),
            new SteamGamesSnapshot
            {
                Supported = false,
                Status = "error",
                Message = "Steam snapshot failed.",
                SampledAt = DateTimeOffset.UtcNow
            });
        var activity = Capture(
            "activity",
            request.Refresh || request.ActivityRefresh ? 750 : 450,
            timings,
            () => _gameActivityService.GetSnapshot(request.Refresh || request.ActivityRefresh),
            new GameActivitySnapshot
            {
                Supported = true,
                Status = "error",
                Mode = "idle",
                StateLabel = "Unavailable",
                Message = "Game activity snapshot failed.",
                SampledAt = DateTimeOffset.UtcNow
            });
        var performance = Capture(
            "performance",
            140,
            timings,
            () => request.PerformanceSession
                ? _gamePerformanceService.EnsureSession(activity)
                : _gamePerformanceService.GetSnapshot(activity),
            GamePerformanceSnapshot.Idle(activity.ActiveGame?.Name ?? ""));

        return new GameModeSessionSnapshot
        {
            Supported = true,
            Status = timings.Any(entry => entry.OverBudget) ? "budget-warning" : "live",
            Message = timings.Any(entry => entry.OverBudget)
                ? "Game Mode telemetry is live; one or more collectors exceeded its budget."
                : "Game Mode telemetry is live.",
            SampledAt = sampledAt,
            System = system,
            Network = network,
            UniFi = uniFi,
            Audio = audio,
            Steam = steam,
            Activity = activity,
            Performance = performance,
            CollectorTimings = timings
        };
    }

    private T Capture<T>(string name, int budgetMs, List<CollectorTimingPayload> timings, Func<T> action, T fallback)
    {
        var stopwatch = Stopwatch.StartNew();
        try
        {
            return action();
        }
        catch (Exception error)
        {
            _logger.Warn($"Game Mode {name} collector failed: {error.Message}");
            return fallback;
        }
        finally
        {
            stopwatch.Stop();
            RecordTiming(name, budgetMs, stopwatch.Elapsed, timings);
        }
    }

    private async Task<T> CaptureAsync<T>(
        string name,
        int budgetMs,
        List<CollectorTimingPayload> timings,
        Func<CancellationToken, Task<T>> action,
        T fallback,
        CancellationToken cancellationToken)
    {
        var stopwatch = Stopwatch.StartNew();
        try
        {
            return await action(cancellationToken);
        }
        catch (Exception error) when (error is not OperationCanceledException)
        {
            _logger.Warn($"Game Mode {name} collector failed: {error.Message}");
            return fallback;
        }
        finally
        {
            stopwatch.Stop();
            RecordTiming(name, budgetMs, stopwatch.Elapsed, timings);
        }
    }

    private void RecordTiming(string name, int budgetMs, TimeSpan elapsed, List<CollectorTimingPayload> timings)
    {
        var durationMs = Math.Round(elapsed.TotalMilliseconds, 1);
        var timing = new CollectorTimingPayload
        {
            Name = name,
            DurationMs = durationMs,
            BudgetMs = budgetMs,
            OverBudget = durationMs > budgetMs
        };
        timings.Add(timing);

        if (timing.OverBudget)
        {
            _logger.Warn($"Game Mode {name} collector exceeded budget: {durationMs:0.0}ms > {budgetMs}ms.");
        }
    }
}

public sealed class GameModeSessionSnapshot
{
    public bool Supported { get; set; } = true;

    public string Status { get; set; } = "live";

    public string Message { get; set; } = "";

    public DateTimeOffset SampledAt { get; set; }

    public SystemSnapshot System { get; set; } = new();

    public NetworkSnapshot Network { get; set; } = new();

    public UniFiNetworkPayload UniFi { get; set; } = new();

    public AudioSnapshotPayload Audio { get; set; } = new();

    public SteamGamesSnapshot Steam { get; set; } = new();

    public GameActivitySnapshot Activity { get; set; } = new();

    public GamePerformanceSnapshot Performance { get; set; } = new();

    public List<CollectorTimingPayload> CollectorTimings { get; set; } = [];
}

public sealed class CollectorTimingPayload
{
    public string Name { get; set; } = "";

    public double DurationMs { get; set; }

    public int BudgetMs { get; set; }

    public bool OverBudget { get; set; }
}
