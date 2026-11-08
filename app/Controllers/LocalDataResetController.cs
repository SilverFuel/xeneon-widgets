namespace XenonEdgeHost;

public sealed class LocalDataResetController
{
    private readonly LocalDataResetService _service;

    public LocalDataResetController(LocalDataResetService service)
    {
        _service = service;
    }

    public Task<LocalDataResetReceipt> ResetAllAsync(CancellationToken cancellationToken)
    {
        return _service.ResetAllAsync(cancellationToken);
    }
}
