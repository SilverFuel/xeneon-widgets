namespace XenonEdgeHost;

public sealed class MonitorControlController
{
    private readonly MonitorControlService _service;

    public MonitorControlController(MonitorControlService service)
    {
        _service = service;
    }

    public object Get() => _service.GetSnapshot();

    public object Set(MonitorControlRequest request) => _service.Set(request);
}
