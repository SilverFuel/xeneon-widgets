namespace XenonEdgeHost;

public sealed class ExtensionController
{
    private readonly ExtensionManifestService _service;

    public ExtensionController(ExtensionManifestService service) { _service = service; }

    public object Get() => _service.GetSnapshot();
}
