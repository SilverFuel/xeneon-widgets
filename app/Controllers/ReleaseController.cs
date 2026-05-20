namespace XenonEdgeHost;

public sealed class ReleaseController
{
    private readonly ReleaseService _releaseService;
    private readonly ConfigController _configController;
    private readonly SupportController _supportController;

    public ReleaseController(
        ReleaseService releaseService,
        ConfigController configController,
        SupportController supportController)
    {
        _releaseService = releaseService;
        _configController = configController;
        _supportController = supportController;
    }

    public Task<object> GetLatestAsync(string channel, CancellationToken cancellationToken)
    {
        return _releaseService.GetLatestReleaseAsync(_configController.GetReleaseChannel(channel), cancellationToken);
    }

    public RollbackPayload BuildRollbackPayload()
    {
        return _supportController.BuildRollbackPayload();
    }
}
