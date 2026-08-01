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
            ThemeVariant = "standard",
            LastActivationReason = "Default mode",
            Profiles =
            [
                BuiltIn("scene-work", "Work", "briefcase", "focus", "standard", "comfortable", 72, 18, "balanced",
                    ["home", "calendar", "system", "audio", "quick-actions"],
                    ["dark-mode", "settings", "task-manager"]),
                BuiltIn("scene-gaming", "Gaming", "gamepad", "gaming", "standard", "compact", 82, 60, "game",
                    ["home", "game-mode", "system", "network", "audio"],
                    ["night-light", "task-manager"]),
                BuiltIn("scene-media", "Media", "play", "warm", "standard", "comfortable", 65, 48, "balanced",
                    ["home", "audio", "hue", "weather"],
                    ["dark-mode", "night-light"]),
                BuiltIn("scene-night", "Night", "moon", "focus", "night", "spacious", 28, 0, "battery",
                    ["home", "audio", "weather", "calendar", "hue"],
                    ["night-light", "dark-mode"]),
                BuiltIn("scene-home", "Home", "home", "focus", "standard", "comfortable", 58, 25, "balanced",
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
        source.DefaultSceneId = FindBaseSceneId(source.Profiles, source.DefaultSceneId) ?? "scene-work";
        source.DisplayAssignments = (source.DisplayAssignments ?? [])
            .Where(assignment => !string.IsNullOrWhiteSpace(assignment.DisplayId))
            .Select(assignment => new DisplaySceneAssignment
            {
                DisplayId = assignment.DisplayId.Trim(),
                SceneId = FindBaseSceneId(source.Profiles, assignment.SceneId) ?? source.DefaultSceneId
            })
            .GroupBy(assignment => assignment.DisplayId, StringComparer.OrdinalIgnoreCase)
            .Select(group => group.First())
            .Take(8)
            .ToList();
        var requestedActive = source.Profiles.FirstOrDefault(scene => string.Equals(scene.Id, source.ActiveSceneId, StringComparison.OrdinalIgnoreCase));
        if (requestedActive is not null && string.Equals(requestedActive.ThemeVariant, "night", StringComparison.OrdinalIgnoreCase))
        {
            source.ActiveSceneId = source.DefaultSceneId;
            source.ThemeVariant = "night";
            if (string.IsNullOrWhiteSpace(source.VariantOverrideUntil) && !string.IsNullOrWhiteSpace(source.ManualOverrideUntil))
            {
                source.VariantOverrideUntil = source.ManualOverrideUntil;
                source.ManualOverrideUntil = "";
            }
        }
        else
        {
            source.ActiveSceneId = FindBaseSceneId(source.Profiles, source.ActiveSceneId) ?? source.DefaultSceneId;
            source.ThemeVariant = NormalizeThemeVariant(source.ThemeVariant);
        }
        source.ManualOverrideUntil = source.ManualOverrideUntil?.Trim() ?? "";
        source.VariantOverrideUntil = source.VariantOverrideUntil?.Trim() ?? "";
        source.LastActivationReason = string.IsNullOrWhiteSpace(source.LastActivationReason) ? "Default mode" : source.LastActivationReason.Trim();
        if (string.Equals(source.LastActivationReason, "Default scene", StringComparison.OrdinalIgnoreCase))
        {
            source.LastActivationReason = "Default mode";
        }
        return source;
    }

    public static SceneProfile NormalizeProfile(SceneProfile scene)
    {
        scene.Id = NormalizeId(scene.Id);
        scene.Name = string.IsNullOrWhiteSpace(scene.Name) ? "Custom Mode" : scene.Name.Trim()[..Math.Min(scene.Name.Trim().Length, 40)];
        scene.Icon = NormalizeToken(scene.Icon, "spark");
        scene.ThemeId = BuiltInThemeId(scene.Id) ?? NormalizeThemeId(scene.ThemeId);
        scene.ThemeVariant = string.Equals(scene.Id, "scene-night", StringComparison.OrdinalIgnoreCase)
            ? "night"
            : NormalizeThemeVariant(scene.ThemeVariant);
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

    public static string NormalizeThemeId(string? value)
    {
        return (value?.Trim().ToLowerInvariant() ?? "") switch
        {
            "focus" or "edge" or "verdant" => "focus",
            "gaming" or "deepcore" => "gaming",
            "warm" or "afterburn" => "warm",
            _ => "focus"
        };
    }

    public static string NormalizeThemeVariant(string? value)
    {
        return string.Equals(value?.Trim(), "night", StringComparison.OrdinalIgnoreCase)
            ? "night"
            : "standard";
    }

    public static string NormalizeAccentColor(string? value) => NormalizeColor(value);

    private static string? BuiltInThemeId(string id) => id switch
    {
        "scene-work" => "focus",
        "scene-gaming" => "gaming",
        "scene-media" => "warm",
        "scene-night" => "focus",
        "scene-home" => "focus",
        _ => null
    };

    private static SceneProfile BuiltIn(string id, string name, string icon, string theme, string themeVariant, string density, int brightness, int animation, string budget, List<string> widgets, List<string> actions)
    {
        return new SceneProfile
        {
            Id = id,
            Name = name,
            Icon = icon,
            ThemeId = theme,
            ThemeVariant = themeVariant,
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

    private static string? FindBaseSceneId(IEnumerable<SceneProfile> scenes, string? requested) => scenes
        .FirstOrDefault(scene => string.Equals(scene.Id, requested, StringComparison.OrdinalIgnoreCase)
            && !string.Equals(scene.ThemeVariant, "night", StringComparison.OrdinalIgnoreCase))?.Id;
}
