namespace XenonEdgeHost;

public sealed class SceneService
{
    private readonly ConfigStore _configStore;

    public SceneService(ConfigStore configStore)
    {
        _configStore = configStore;
    }

    public object GetSnapshot()
    {
        var scenes = _configStore.Snapshot().Scenes;
        return BuildSnapshot(scenes);
    }

    public object Activate(SceneActivationRequest request)
    {
        var requestedId = request.SceneId?.Trim() ?? "";
        _configStore.Update(config =>
        {
            var scene = config.Scenes.Profiles.FirstOrDefault(item => string.Equals(item.Id, requestedId, StringComparison.OrdinalIgnoreCase))
                ?? throw new InvalidOperationException("Scene not found.");
            config.Scenes.ActiveSceneId = scene.Id;
            config.Scenes.ManualOverrideUntil = request.ManualOverrideMinutes switch
            {
                < 0 => "indefinite",
                0 => "",
                _ => DateTimeOffset.UtcNow.AddMinutes(Math.Clamp(request.ManualOverrideMinutes ?? 120, 5, 1440)).ToString("O")
            };
            config.Scenes.LastActivationReason = "Manual selection";
            return config;
        });
        return GetSnapshot();
    }

    public object ResumeAutomation()
    {
        _configStore.Update(config =>
        {
            config.Scenes.ManualOverrideUntil = "";
            config.Scenes.AutomationEnabled = true;
            config.Scenes.LastActivationReason = "Automatic switching resumed";
            return config;
        });
        return GetSnapshot();
    }

    public object Save(SceneSaveRequest request)
    {
        var incoming = request.Scene ?? throw new InvalidOperationException("Scene payload is required.");
        incoming.IsBuiltIn = false;
        var normalized = SceneDefaults.NormalizeProfile(incoming);
        _configStore.Update(config =>
        {
            var existingIndex = config.Scenes.Profiles.FindIndex(scene => string.Equals(scene.Id, normalized.Id, StringComparison.OrdinalIgnoreCase));
            if (existingIndex >= 0 && config.Scenes.Profiles[existingIndex].IsBuiltIn)
            {
                throw new InvalidOperationException("Built-in Scenes must be duplicated before editing.");
            }

            if (existingIndex >= 0)
            {
                config.Scenes.Profiles[existingIndex] = normalized;
            }
            else
            {
                config.Scenes.Profiles.Add(normalized);
            }
            return config;
        });
        return GetSnapshot();
    }

    public object Duplicate(SceneDuplicateRequest request)
    {
        var requestedId = request.SceneId?.Trim() ?? "";
        _configStore.Update(config =>
        {
            var source = config.Scenes.Profiles.FirstOrDefault(scene => string.Equals(scene.Id, requestedId, StringComparison.OrdinalIgnoreCase))
                ?? throw new InvalidOperationException("Scene not found.");
            var copy = SceneDefaults.NormalizeProfile(new SceneProfile
            {
                Id = $"scene-{Guid.NewGuid():N}",
                Name = string.IsNullOrWhiteSpace(request.Name) ? $"{source.Name} Copy" : request.Name.Trim(),
                Icon = source.Icon,
                ThemeId = source.ThemeId,
                AccentColor = source.AccentColor,
                Density = source.Density,
                Brightness = source.Brightness,
                AnimationIntensity = source.AnimationIntensity,
                PerformanceBudget = source.PerformanceBudget,
                Widgets = [.. source.Widgets],
                QuickActions = [.. source.QuickActions],
                Layout = source.Layout,
                Rules = source.Rules.Select(rule => new SceneRule
                {
                    Id = $"rule-{Guid.NewGuid():N}", Type = rule.Type, Value = rule.Value, StartTime = rule.StartTime,
                    EndTime = rule.EndTime, Priority = rule.Priority, Enabled = rule.Enabled
                }).ToList()
            });
            config.Scenes.Profiles.Add(copy);
            config.Scenes.ActiveSceneId = copy.Id;
            config.Scenes.ManualOverrideUntil = "indefinite";
            config.Scenes.LastActivationReason = "Scene duplicated";
            return config;
        });
        return GetSnapshot();
    }

    public object Delete(SceneDeleteRequest request)
    {
        var requestedId = request.SceneId?.Trim() ?? "";
        _configStore.Update(config =>
        {
            var scene = config.Scenes.Profiles.FirstOrDefault(item => string.Equals(item.Id, requestedId, StringComparison.OrdinalIgnoreCase))
                ?? throw new InvalidOperationException("Scene not found.");
            if (scene.IsBuiltIn)
            {
                throw new InvalidOperationException("Built-in Scenes cannot be deleted.");
            }
            config.Scenes.Profiles.Remove(scene);
            if (string.Equals(config.Scenes.ActiveSceneId, scene.Id, StringComparison.OrdinalIgnoreCase))
            {
                config.Scenes.ActiveSceneId = config.Scenes.DefaultSceneId;
            }
            return config;
        });
        return GetSnapshot();
    }

    public object AssignDisplay(DisplaySceneAssignmentRequest request)
    {
        var displayId = request.DisplayId?.Trim() ?? "";
        var sceneId = request.SceneId?.Trim() ?? "";
        if (string.IsNullOrWhiteSpace(displayId))
        {
            throw new InvalidOperationException("Display ID is required.");
        }
        _configStore.Update(config =>
        {
            var scene = config.Scenes.Profiles.FirstOrDefault(item => string.Equals(item.Id, sceneId, StringComparison.OrdinalIgnoreCase))
                ?? throw new InvalidOperationException("Scene not found.");
            config.Scenes.DisplayAssignments.RemoveAll(item => string.Equals(item.DisplayId, displayId, StringComparison.OrdinalIgnoreCase));
            config.Scenes.DisplayAssignments.Add(new DisplaySceneAssignment { DisplayId = displayId, SceneId = scene.Id });
            return config;
        });
        return GetSnapshot();
    }

    public void ActivateAssignedDisplayScene(string displayId)
    {
        var config = _configStore.Snapshot();
        var assignment = config.Scenes.DisplayAssignments.FirstOrDefault(item => string.Equals(item.DisplayId, displayId, StringComparison.OrdinalIgnoreCase));
        if (assignment is not null)
        {
            Activate(new SceneActivationRequest { SceneId = assignment.SceneId, ManualOverrideMinutes = 0 });
        }
    }

    public object Evaluate(SceneEvaluationRequest request)
    {
        var sampledAt = DateTimeOffset.TryParse(request.SampledAt, out var parsed) ? parsed : DateTimeOffset.Now;
        _configStore.Update(config =>
        {
            if (!config.Scenes.AutomationEnabled || HasManualOverride(config.Scenes, sampledAt))
            {
                return config;
            }

            var match = config.Scenes.Profiles
                .SelectMany(scene => scene.Rules.Where(rule => rule.Enabled).Select(rule => (Scene: scene, Rule: rule)))
                .Where(candidate => RuleMatches(candidate.Rule, request, sampledAt))
                .OrderByDescending(candidate => candidate.Rule.Priority)
                .ThenBy(candidate => candidate.Scene.Name)
                .FirstOrDefault();
            var next = match.Scene ?? config.Scenes.Profiles.First(scene => string.Equals(scene.Id, config.Scenes.DefaultSceneId, StringComparison.OrdinalIgnoreCase));
            config.Scenes.ActiveSceneId = next.Id;
            config.Scenes.LastActivationReason = match.Scene is null ? "Default scene" : $"Automatic {match.Rule.Type} rule";
            return config;
        });
        return GetSnapshot();
    }

    private static bool HasManualOverride(SceneCollectionConfig scenes, DateTimeOffset now)
    {
        if (string.Equals(scenes.ManualOverrideUntil, "indefinite", StringComparison.OrdinalIgnoreCase))
        {
            return true;
        }
        return DateTimeOffset.TryParse(scenes.ManualOverrideUntil, out var until) && until > now;
    }

    private static bool RuleMatches(SceneRule rule, SceneEvaluationRequest context, DateTimeOffset sampledAt)
    {
        return rule.Type switch
        {
            "game" => !string.IsNullOrWhiteSpace(context.ActiveGame)
                && (string.IsNullOrWhiteSpace(rule.Value) || context.ActiveGame.Contains(rule.Value, StringComparison.OrdinalIgnoreCase)),
            "application" => !string.IsNullOrWhiteSpace(context.ForegroundProcess)
                && !string.IsNullOrWhiteSpace(rule.Value)
                && context.ForegroundProcess.Contains(rule.Value, StringComparison.OrdinalIgnoreCase),
            "media" => context.MediaPlaying,
            "schedule" => IsWithinSchedule(rule, TimeOnly.FromDateTime(sampledAt.LocalDateTime)),
            _ => false
        };
    }

    private static bool IsWithinSchedule(SceneRule rule, TimeOnly now)
    {
        if (!TimeOnly.TryParse(rule.StartTime, out var start) || !TimeOnly.TryParse(rule.EndTime, out var end))
        {
            return false;
        }
        return start <= end ? now >= start && now < end : now >= start || now < end;
    }

    private static object BuildSnapshot(SceneCollectionConfig scenes)
    {
        var active = scenes.Profiles.FirstOrDefault(scene => string.Equals(scene.Id, scenes.ActiveSceneId, StringComparison.OrdinalIgnoreCase));
        return new
        {
            supported = true,
            status = "ready",
            activeSceneId = scenes.ActiveSceneId,
            activeScene = active,
            defaultSceneId = scenes.DefaultSceneId,
            automationEnabled = scenes.AutomationEnabled,
            manualOverrideUntil = scenes.ManualOverrideUntil,
            lastActivationReason = scenes.LastActivationReason,
            profiles = scenes.Profiles,
            displayAssignments = scenes.DisplayAssignments,
            message = $"{active?.Name ?? "Work"} Scene is active."
        };
    }
}
