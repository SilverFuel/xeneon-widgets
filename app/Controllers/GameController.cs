namespace XenonEdgeHost;

public sealed class GameController
{
    private readonly SteamService _steamService;
    private readonly GameActivityService _gameActivityService;
    private readonly GamePerformanceService _gamePerformanceService;
    private readonly GameModeSessionService _gameModeSessionService;

    public GameController(
        SteamService steamService,
        GameActivityService gameActivityService,
        GamePerformanceService gamePerformanceService,
        GameModeSessionService gameModeSessionService)
    {
        _steamService = steamService;
        _gameActivityService = gameActivityService;
        _gamePerformanceService = gamePerformanceService;
        _gameModeSessionService = gameModeSessionService;
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

    public GameActivityPinResult PinCandidate(GameActivityPinRequest request)
    {
        return _gameActivityService.PinCandidate(request);
    }
}
