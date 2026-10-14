namespace XenonEdgeHost;

public sealed class ActionChainService
{
    private readonly SceneService _sceneService;
    private readonly SystemActionsService _systemActions;

    public ActionChainService(SceneService sceneService, SystemActionsService systemActions)
    {
        _sceneService = sceneService;
        _systemActions = systemActions;
    }

    public object GetSnapshot()
    {
        return new
        {
            supported = true,
            status = "ready",
            chains = new[]
            {
                Chain("gaming-night", "Gaming Night", "Gaming Mode, dark mode, and quiet notifications", "scene-gaming"),
                Chain("focus", "Focus", "Work Mode and quiet notifications", "scene-work"),
                Chain("movie", "Movie Time", "Media Mode, dark mode, and quiet notifications", "scene-media"),
                Chain("morning", "Morning Reset", "Home Mode, light mode, and notification banners", "scene-home")
            },
            message = "Safe built-in action chains are ready."
        };
    }

    public object Execute(ActionChainExecuteRequest request)
    {
        var chainId = request.ChainId?.Trim().ToLowerInvariant() ?? "";
        var steps = new List<string>();
        switch (chainId)
        {
            case "gaming-night":
                Activate("scene-gaming", steps);
                _systemActions.SetDarkModeEnabled(true);
                _systemActions.SetDoNotDisturbEnabled(true);
                steps.Add("Dark mode enabled");
                steps.Add("Notification banners muted");
                break;
            case "focus":
                Activate("scene-work", steps);
                _systemActions.SetDoNotDisturbEnabled(true);
                steps.Add("Notification banners muted");
                break;
            case "movie":
                Activate("scene-media", steps);
                _systemActions.SetDarkModeEnabled(true);
                _systemActions.SetDoNotDisturbEnabled(true);
                steps.Add("Dark mode enabled");
                steps.Add("Notification banners muted");
                break;
            case "morning":
                Activate("scene-home", steps);
                _systemActions.SetDarkModeEnabled(false);
                _systemActions.SetDoNotDisturbEnabled(false);
                steps.Add("Light mode enabled");
                steps.Add("Notification banners enabled");
                break;
            default:
                throw new InvalidOperationException("Unknown action chain.");
        }

        return new
        {
            supported = true,
            status = "complete",
            chainId,
            steps,
            scene = _sceneService.GetSnapshot(),
            message = $"{steps.Count} action-chain steps completed."
        };
    }

    private void Activate(string sceneId, ICollection<string> steps)
    {
        _sceneService.Activate(new SceneActivationRequest { SceneId = sceneId, ManualOverrideMinutes = 120 });
        steps.Add($"{sceneId.Replace("scene-", "", StringComparison.OrdinalIgnoreCase)} Mode activated");
    }

    private static object Chain(string id, string name, string description, string sceneId) => new { id, name, description, sceneId };
}
