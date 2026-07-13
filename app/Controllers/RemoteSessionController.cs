namespace XenonEdgeHost;

public sealed class RemoteSessionController
{
    private readonly RemoteSessionService _service;
    public RemoteSessionController(RemoteSessionService service) { _service = service; }
    public object Get() => _service.GetSnapshot();
    public object Start() => _service.Start();
    public object Stop() => _service.Stop();
}
