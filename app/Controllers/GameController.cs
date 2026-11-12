namespace XenonEdgeHost;

public sealed class GameController
{
    private readonly SteamService _steamService;
    private readonly GameActivityService _gameActivityService;
    private readonly GamePerformanceService _gamePerformanceService;
    private readonly GameModeSessionService _gameModeSessionService;
    private readonly WowCompanionService _wowCompanionService;

    public GameController(
        SteamService steamService,
        GameActivityService gameActivityService,
        GamePerformanceService gamePerformanceService,
        GameModeSessionService gameModeSessionService,
        WowCompanionService wowCompanionService)
    {
        _steamService = steamService;
        _gameActivityService = gameActivityService;
        _gamePerformanceService = gamePerformanceService;
        _gameModeSessionService = gameModeSessionService;
        _wowCompanionService = wowCompanionService;
    }

    public SteamGamesSnapshot GetSteamGames(bool refresh)
    {
        return _steamService.GetSnapshot(refresh);
    }

    public SteamLaunchResult LaunchSteamGame(SteamGameLaunchRequest request)
    {
        return _steamService.Launch(request.AppId);
    }

    public bool TryGetSteamArtwork(string? appId, out LauncherIconAsset asset)
    {
        return _steamService.TryGetArtwork(appId, out asset);
    }

    public GameActivitySnapshot GetActivity(bool refresh = false)
    {
        return _gameActivityService.GetSnapshot(refresh);
    }

    public GamePerformanceSnapshot GetPerformance()
    {
        return _gamePerformanceService.GetSnapshot(_gameActivityService.GetSnapshot());
    }

    public GamePerformanceSnapshot EnsurePerformanceSession()
    {
        return _gamePerformanceService.EnsureSession(_gameActivityService.GetSnapshot());
    }

    public Task<GameModeSessionSnapshot> GetSessionAsync(GameModeSessionRequest request, CancellationToken cancellationToken)
    {
        return _gameModeSessionService.GetSnapshotAsync(request, cancellationToken);
    }

    // The running game's location stays here; the snapshot carries no path.
    public WowCompanionSnapshot GetWowCompanion()
    {
        var activity = _gameActivityService.GetSnapshot();
        return _wowCompanionService.GetSnapshot(activity.ActiveGame?.ExecutablePath ?? activity.LastGame?.ExecutablePath);
    }

    public GameActivityPinResult PinCandidate(GameActivityPinRequest request)
    {
        return _gameActivityService.PinCandidate(request);
    }
}
