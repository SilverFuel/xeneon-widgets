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
                ?? throw new InvalidOperationException("Mode not found.");
            var overrideUntil = CalculateOverrideUntil(request.ManualOverrideMinutes);
            if (string.Equals(scene.ThemeVariant, "night", StringComparison.OrdinalIgnoreCase))
            {
                config.Scenes.ThemeVariant = string.Equals(config.Scenes.ThemeVariant, "night", StringComparison.OrdinalIgnoreCase)
                    ? "standard"
                    : "night";
                config.Scenes.VariantOverrideUntil = overrideUntil;
                config.Scenes.LastActivationReason = config.Scenes.ThemeVariant == "night"
                    ? "Night variant enabled manually"
                    : "Night variant disabled manually";
            }
            else
            {
                config.Scenes.ActiveSceneId = scene.Id;
                config.Scenes.ManualOverrideUntil = overrideUntil;
                config.Scenes.LastActivationReason = "Manual selection";
            }
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
        var incoming = request.Scene ?? throw new InvalidOperationException("Mode configuration is required.");
        incoming.IsBuiltIn = false;
        var normalized = SceneDefaults.NormalizeProfile(incoming);
        _configStore.Update(config =>
        {
            var existingIndex = config.Scenes.Profiles.FindIndex(scene => string.Equals(scene.Id, normalized.Id, StringComparison.OrdinalIgnoreCase));
            if (existingIndex >= 0 && config.Scenes.Profiles[existingIndex].IsBuiltIn)
            {
                throw new InvalidOperationException("Built-in Modes must be duplicated before editing.");
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
                ?? throw new InvalidOperationException("Mode not found.");
            var copy = SceneDefaults.NormalizeProfile(new SceneProfile
            {
                Id = $"scene-{Guid.NewGuid():N}",
                Name = string.IsNullOrWhiteSpace(request.Name) ? $"{source.Name} Copy" : request.Name.Trim(),
                Icon = source.Icon,
                ThemeId = source.ThemeId,
                ThemeVariant = source.ThemeVariant,
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
            if (string.Equals(copy.ThemeVariant, "night", StringComparison.OrdinalIgnoreCase))
            {
                config.Scenes.ThemeVariant = "night";
                config.Scenes.VariantOverrideUntil = "indefinite";
            }
            else
            {
                config.Scenes.ActiveSceneId = copy.Id;
                config.Scenes.ManualOverrideUntil = "indefinite";
            }
            config.Scenes.LastActivationReason = "Mode duplicated";
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
                ?? throw new InvalidOperationException("Mode not found.");
            if (scene.IsBuiltIn)
            {
                throw new InvalidOperationException("Built-in Modes cannot be deleted.");
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
        var displayId = DisplayManager.ResolveCompanionDisplay(request.DisplayId).StableId;
        var sceneId = request.SceneId?.Trim() ?? "";
        _configStore.Update(config =>
        {
            SetDisplayAssignment(config.Scenes, displayId, sceneId);
            return config;
        });
        return GetSnapshot();
    }

    internal static void SetDisplayAssignment(SceneCollectionConfig scenes, string displayId, string? sceneId)
    {
        ArgumentNullException.ThrowIfNull(scenes);

        var normalizedDisplayId = displayId?.Trim() ?? "";
        if (string.IsNullOrWhiteSpace(normalizedDisplayId))
        {
            throw new InvalidOperationException("Companion display is required.");
        }

        var normalizedSceneId = sceneId?.Trim() ?? "";
        SceneProfile? scene = null;
        if (!string.IsNullOrWhiteSpace(normalizedSceneId))
        {
            scene = scenes.Profiles.FirstOrDefault(item =>
                string.Equals(item.Id, normalizedSceneId, StringComparison.OrdinalIgnoreCase)
                && !string.Equals(item.ThemeVariant, "night", StringComparison.OrdinalIgnoreCase))
                ?? throw new InvalidOperationException("Mode not found.");
        }

        scenes.DisplayAssignments.RemoveAll(item =>
            string.Equals(item.DisplayId, normalizedDisplayId, StringComparison.OrdinalIgnoreCase));
        if (scene is not null)
        {
            scenes.DisplayAssignments.Add(new DisplaySceneAssignment
            {
                DisplayId = normalizedDisplayId,
                SceneId = scene.Id
            });
        }
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
            if (!config.Scenes.AutomationEnabled)
            {
                return config;
            }

            if (!HasOverride(config.Scenes.ManualOverrideUntil, sampledAt))
            {
                var match = config.Scenes.Profiles
                    .Where(scene => !string.Equals(scene.ThemeVariant, "night", StringComparison.OrdinalIgnoreCase))
                    .SelectMany(scene => scene.Rules.Where(rule => rule.Enabled).Select(rule => (Scene: scene, Rule: rule)))
                    .Where(candidate => RuleMatches(candidate.Rule, request, sampledAt))
                    .OrderByDescending(candidate => candidate.Rule.Priority)
                    .ThenBy(candidate => candidate.Scene.Name)
                    .FirstOrDefault();
                var next = match.Scene ?? config.Scenes.Profiles.First(scene =>
                    string.Equals(scene.Id, config.Scenes.DefaultSceneId, StringComparison.OrdinalIgnoreCase)
                    && !string.Equals(scene.ThemeVariant, "night", StringComparison.OrdinalIgnoreCase));
                config.Scenes.ActiveSceneId = next.Id;
                config.Scenes.LastActivationReason = match.Scene is null ? "Default mode" : $"Automatic {match.Rule.Type} rule";
            }

            if (!HasOverride(config.Scenes.VariantOverrideUntil, sampledAt))
            {
                var nightActive = config.Scenes.Profiles
                    .Where(scene => string.Equals(scene.ThemeVariant, "night", StringComparison.OrdinalIgnoreCase))
                    .SelectMany(scene => scene.Rules)
                    .Any(rule => rule.Enabled
                        && string.Equals(rule.Type, "schedule", StringComparison.OrdinalIgnoreCase)
                        && RuleMatches(rule, request, sampledAt));
                config.Scenes.ThemeVariant = nightActive ? "night" : "standard";
            }
            return config;
        });
        return GetSnapshot();
    }

    private static string CalculateOverrideUntil(int? manualOverrideMinutes)
    {
        return manualOverrideMinutes switch
        {
            < 0 => "indefinite",
            0 => "",
            _ => DateTimeOffset.UtcNow.AddMinutes(Math.Clamp(manualOverrideMinutes ?? 120, 5, 1440)).ToString("O")
        };
    }

    private static bool HasOverride(string? overrideUntil, DateTimeOffset now) =>
        string.Equals(overrideUntil, "indefinite", StringComparison.OrdinalIgnoreCase)
        || DateTimeOffset.TryParse(overrideUntil, out var until) && until > now;

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
        var profiles = scenes.Profiles
            .Where(scene => !string.Equals(scene.ThemeVariant, "night", StringComparison.OrdinalIgnoreCase))
            .ToList();
        var profileIds = profiles.Select(scene => scene.Id).ToHashSet(StringComparer.OrdinalIgnoreCase);
        var active = profiles.FirstOrDefault(scene => string.Equals(scene.Id, scenes.ActiveSceneId, StringComparison.OrdinalIgnoreCase));
        var manualOverrideActive = HasOverride(scenes.ManualOverrideUntil, DateTimeOffset.UtcNow);
        return new
        {
            supported = true,
            status = "ready",
            activeSceneId = scenes.ActiveSceneId,
            activeScene = active,
            defaultSceneId = scenes.DefaultSceneId,
            automationEnabled = scenes.AutomationEnabled,
            manualOverrideUntil = scenes.ManualOverrideUntil,
            manualOverrideActive,
            automaticSwitchingActive = scenes.AutomationEnabled && !manualOverrideActive,
            themeVariant = scenes.ThemeVariant,
            variantOverrideUntil = scenes.VariantOverrideUntil,
            lastActivationReason = scenes.LastActivationReason,
            profiles,
            displayAssignments = scenes.DisplayAssignments.Where(assignment => profileIds.Contains(assignment.SceneId)).ToList(),
            message = $"{active?.Name ?? "Work"} Mode is active."
        };
    }
}
