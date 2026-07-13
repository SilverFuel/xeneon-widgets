namespace XenonEdgeHost;

public static class SceneDefaults
{
    public static SceneCollectionConfig Create()
    {
        return new SceneCollectionConfig
        {
            ActiveSceneId = "scene-work",
            DefaultSceneId = "scene-work",
            AutomationEnabled = true,
            LastActivationReason = "Default scene",
            Profiles =
            [
                BuiltIn("scene-work", "Work", "briefcase", "edge", "comfortable", 72, 18, "balanced",
                    ["home", "calendar", "system", "audio", "quick-actions"],
                    ["dark-mode", "settings", "task-manager"]),
                BuiltIn("scene-gaming", "Gaming", "gamepad", "deepcore", "compact", 82, 60, "game",
                    ["home", "game-mode", "system", "network", "audio"],
                    ["night-light", "task-manager"]),
                BuiltIn("scene-media", "Media", "play", "afterburn", "comfortable", 65, 48, "balanced",
                    ["home", "audio", "hue", "weather"],
                    ["dark-mode", "night-light"]),
                BuiltIn("scene-night", "Night", "moon", "afterburn", "spacious", 28, 0, "battery",
                    ["home", "audio", "weather", "calendar", "hue"],
                    ["night-light", "dark-mode"]),
                BuiltIn("scene-home", "Home", "home", "verdant", "comfortable", 58, 25, "balanced",
                    ["home", "hue", "network", "weather", "calendar"],
                    ["night-light", "settings"])
            ]
        };
    }

    public static SceneCollectionConfig Normalize(SceneCollectionConfig? input)
    {
        var defaults = Create();
        var source = input ?? defaults;
        source.Profiles ??= [];
        foreach (var builtIn in defaults.Profiles)
        {
            if (!source.Profiles.Any(scene => string.Equals(scene.Id, builtIn.Id, StringComparison.OrdinalIgnoreCase)))
            {
                source.Profiles.Add(builtIn);
            }
        }

        source.Profiles = source.Profiles
            .Where(scene => scene is not null)
            .Take(24)
            .Select(NormalizeProfile)
            .GroupBy(scene => scene.Id, StringComparer.OrdinalIgnoreCase)
            .Select(group => group.First())
            .ToList();
        source.DisplayAssignments = (source.DisplayAssignments ?? [])
            .Where(assignment => !string.IsNullOrWhiteSpace(assignment.DisplayId))
            .Select(assignment => new DisplaySceneAssignment
            {
                DisplayId = assignment.DisplayId.Trim(),
                SceneId = FindSceneId(source.Profiles, assignment.SceneId) ?? source.DefaultSceneId
            })
            .GroupBy(assignment => assignment.DisplayId, StringComparer.OrdinalIgnoreCase)
            .Select(group => group.First())
            .Take(8)
            .ToList();
        source.DefaultSceneId = FindSceneId(source.Profiles, source.DefaultSceneId) ?? "scene-work";
        source.ActiveSceneId = FindSceneId(source.Profiles, source.ActiveSceneId) ?? source.DefaultSceneId;
        source.ManualOverrideUntil = source.ManualOverrideUntil?.Trim() ?? "";
        source.LastActivationReason = string.IsNullOrWhiteSpace(source.LastActivationReason) ? "Default scene" : source.LastActivationReason.Trim();
        return source;
    }

    public static SceneProfile NormalizeProfile(SceneProfile scene)
    {
        scene.Id = NormalizeId(scene.Id);
        scene.Name = string.IsNullOrWhiteSpace(scene.Name) ? "Custom Scene" : scene.Name.Trim()[..Math.Min(scene.Name.Trim().Length, 40)];
        scene.Icon = NormalizeToken(scene.Icon, "spark");
        scene.ThemeId = NormalizeToken(scene.ThemeId, "edge");
        scene.AccentColor = NormalizeColor(scene.AccentColor);
        scene.Density = NormalizeChoice(scene.Density, "comfortable", "compact", "comfortable", "spacious");
        scene.Brightness = Math.Clamp(scene.Brightness, 10, 100);
        scene.AnimationIntensity = Math.Clamp(scene.AnimationIntensity, 0, 100);
        scene.PerformanceBudget = NormalizeChoice(scene.PerformanceBudget, "balanced", "balanced", "battery", "game", "max");
        scene.Widgets = NormalizeTokens(scene.Widgets, 16);
        scene.QuickActions = NormalizeTokens(scene.QuickActions, 12);
        scene.Layout ??= new DisplayLayoutProfile();
        scene.Layout.NavigationPlacement = NormalizeChoice(scene.Layout.NavigationPlacement, "auto", "auto", "left", "bottom");
        scene.Layout.Orientation = NormalizeChoice(scene.Layout.Orientation, "adaptive", "adaptive", "landscape", "portrait");
        scene.Layout.MaxColumns = Math.Clamp(scene.Layout.MaxColumns, 1, 6);
        scene.Layout.MinimumCardWidth = Math.Clamp(scene.Layout.MinimumCardWidth, 180, 640);
        scene.Rules = (scene.Rules ?? []).Take(16).Select(NormalizeRule).ToList();
        return scene;
    }

    private static SceneProfile BuiltIn(string id, string name, string icon, string theme, string density, int brightness, int animation, string budget, List<string> widgets, List<string> actions)
    {
        return new SceneProfile
        {
            Id = id,
            Name = name,
            Icon = icon,
            ThemeId = theme,
            Density = density,
            Brightness = brightness,
            AnimationIntensity = animation,
            PerformanceBudget = budget,
            Widgets = widgets,
            QuickActions = actions,
            IsBuiltIn = true,
            Rules = id switch
            {
                "scene-gaming" => [new SceneRule { Id = "rule-game", Type = "game", Priority = 100 }],
                "scene-media" => [new SceneRule { Id = "rule-media", Type = "media", Priority = 70 }],
                "scene-night" => [new SceneRule { Id = "rule-night", Type = "schedule", StartTime = "22:00", EndTime = "06:30", Priority = 60 }],
                _ => []
            }
        };
    }

    private static SceneRule NormalizeRule(SceneRule rule)
    {
        rule.Id = NormalizeId(rule.Id);
        rule.Type = NormalizeChoice(rule.Type, "application", "application", "game", "media", "schedule");
        rule.Value = (rule.Value ?? "").Trim()[..Math.Min((rule.Value ?? "").Trim().Length, 160)];
        rule.StartTime = NormalizeClock(rule.StartTime);
        rule.EndTime = NormalizeClock(rule.EndTime);
        rule.Priority = Math.Clamp(rule.Priority, 0, 1000);
        return rule;
    }

    private static string NormalizeId(string? value)
    {
        var cleaned = new string((value ?? "").Trim().ToLowerInvariant().Where(ch => char.IsLetterOrDigit(ch) || ch is '-' or '_').ToArray());
        return string.IsNullOrWhiteSpace(cleaned) ? $"scene-{Guid.NewGuid():N}" : cleaned[..Math.Min(cleaned.Length, 64)];
    }

    private static string NormalizeToken(string? value, string fallback)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return fallback;
        }
        var normalized = new string(value.Trim().ToLowerInvariant().Where(ch => char.IsLetterOrDigit(ch) || ch is '-' or '_').ToArray());
        return string.IsNullOrWhiteSpace(normalized) ? fallback : normalized[..Math.Min(normalized.Length, 64)];
    }

    private static List<string> NormalizeTokens(IEnumerable<string>? values, int limit) => (values ?? [])
        .Select(value => NormalizeToken(value, ""))
        .Where(value => !string.IsNullOrWhiteSpace(value))
        .Distinct(StringComparer.OrdinalIgnoreCase)
        .Take(limit)
        .ToList();

    private static string NormalizeColor(string? value)
    {
        var normalized = value?.Trim() ?? "";
        return normalized.Length == 7 && normalized[0] == '#' && normalized[1..].All(Uri.IsHexDigit) ? normalized.ToUpperInvariant() : "";
    }

    private static string NormalizeChoice(string? value, string fallback, params string[] allowed)
    {
        var normalized = value?.Trim().ToLowerInvariant() ?? "";
        return allowed.Contains(normalized, StringComparer.OrdinalIgnoreCase) ? normalized : fallback;
    }

    private static string NormalizeClock(string? value) => TimeOnly.TryParse(value, out var time) ? time.ToString("HH:mm") : "";

    private static string? FindSceneId(IEnumerable<SceneProfile> scenes, string? requested) => scenes
        .FirstOrDefault(scene => string.Equals(scene.Id, requested, StringComparison.OrdinalIgnoreCase))?.Id;
}
