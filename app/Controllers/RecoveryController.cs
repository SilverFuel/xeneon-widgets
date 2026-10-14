namespace XenonEdgeHost;

public sealed class RecoveryController
{
    private readonly RecoveryService _service;

    public RecoveryController(RecoveryService service)
    {
        _service = service;
    }

    public RecoverySnapshot Get() => _service.GetSnapshot();

    public RecoveryActionResult Execute(RecoveryActionRequest request) => _service.Execute(request.Action);
}
