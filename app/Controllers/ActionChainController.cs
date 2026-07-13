namespace XenonEdgeHost;

public sealed class ActionChainController
{
    private readonly ActionChainService _service;

    public ActionChainController(ActionChainService service)
    {
        _service = service;
    }

    public object Get() => _service.GetSnapshot();

    public object Execute(ActionChainExecuteRequest request) => _service.Execute(request);
}
