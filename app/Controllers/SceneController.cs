namespace XenonEdgeHost;

public sealed class SceneController
{
    private readonly SceneService _sceneService;

    public SceneController(SceneService sceneService)
    {
        _sceneService = sceneService;
    }

    public object Get() => _sceneService.GetSnapshot();

    public object Activate(SceneActivationRequest request) => _sceneService.Activate(request);

    public object Resume() => _sceneService.ResumeAutomation();

    public object Save(SceneSaveRequest request) => _sceneService.Save(request);

    public object Duplicate(SceneDuplicateRequest request) => _sceneService.Duplicate(request);

    public object Delete(SceneDeleteRequest request) => _sceneService.Delete(request);

    public object Evaluate(SceneEvaluationRequest request) => _sceneService.Evaluate(request);

    public object AssignDisplay(DisplaySceneAssignmentRequest request) => _sceneService.AssignDisplay(request);
}
