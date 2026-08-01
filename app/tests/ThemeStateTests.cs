using System.Text.Json;
using NUnit.Framework;

namespace XenonEdgeHost.Tests;

public sealed class ThemeStateTests
{
    private static readonly JsonSerializerOptions BackupSerializerOptions = new()
    {
        PropertyNameCaseInsensitive = true
    };

    private string _tempDirectory = "";
    private HostLogger? _logger;

    [SetUp]
    public void SetUp()
    {
        _tempDirectory = Path.Combine(Path.GetTempPath(), $"auxora-theme-state-tests-{Guid.NewGuid():N}");
        Directory.CreateDirectory(_tempDirectory);
        _logger = new HostLogger(Path.Combine(_tempDirectory, "logs"));
    }

    [TearDown]
    public void TearDown()
    {
        _logger?.Dispose();
        try
        {
            Directory.Delete(_tempDirectory, recursive: true);
        }
        catch
        {
        }
    }

    [TestCase("edge", "focus")]
    [TestCase("verdant", "focus")]
    [TestCase("deepcore", "gaming")]
    [TestCase("afterburn", "warm")]
    [TestCase(" FOCUS ", "focus")]
    [TestCase("GAMING", "gaming")]
    [TestCase("Warm", "warm")]
    public void NormalizeThemeId_MigratesLegacyAndPreservesCanonicalIds(string input, string expected)
    {
        Assert.That(SceneDefaults.NormalizeThemeId(input), Is.EqualTo(expected));
    }

    [TestCase(null)]
    [TestCase("")]
    [TestCase("   ")]
    [TestCase("unknown-theme")]
    [TestCase("focus-night")]
    public void NormalizeThemeId_UnknownOrMissingValueFallsBackToFocus(string? input)
    {
        Assert.That(SceneDefaults.NormalizeThemeId(input), Is.EqualTo("focus"));
    }

    [Test]
    public void Defaults_UseOnlyCanonicalThemeIds()
    {
        var profiles = SceneDefaults.Create().Profiles.ToDictionary(profile => profile.Id);

        Assert.That(profiles["scene-work"].ThemeId, Is.EqualTo("focus"));
        Assert.That(profiles["scene-gaming"].ThemeId, Is.EqualTo("gaming"));
        Assert.That(profiles["scene-media"].ThemeId, Is.EqualTo("warm"));
        Assert.That(profiles["scene-night"].ThemeId, Is.EqualTo("focus"));
        Assert.That(profiles["scene-home"].ThemeId, Is.EqualTo("focus"));
        Assert.That(
            profiles.Values.Select(profile => profile.ThemeId),
            Is.All.Matches<string>(themeId => themeId is "focus" or "gaming" or "warm"));
    }

    [TestCase("focus")]
    [TestCase("gaming")]
    [TestCase("warm")]
    public void NormalizeProfile_NightVariantDoesNotReplaceBaseTheme(string themeId)
    {
        var profile = SceneDefaults.NormalizeProfile(new SceneProfile
        {
            Id = $"custom-{themeId}",
            Name = themeId,
            ThemeId = themeId,
            ThemeVariant = "night"
        });

        Assert.That(profile.ThemeId, Is.EqualTo(themeId));
        Assert.That(profile.ThemeVariant, Is.EqualTo("night"));
    }

    [Test]
    public void Normalize_LegacyNightSceneBecomesVariantOfSelectedBaseMode()
    {
        var scenes = SceneDefaults.Create();
        scenes.DefaultSceneId = "scene-gaming";
        scenes.ActiveSceneId = "scene-night";
        scenes.ManualOverrideUntil = "2026-07-19T06:30:00-04:00";

        var normalized = SceneDefaults.Normalize(scenes);

        Assert.That(normalized.ActiveSceneId, Is.EqualTo("scene-gaming"));
        Assert.That(normalized.ThemeVariant, Is.EqualTo("night"));
        Assert.That(normalized.VariantOverrideUntil, Is.EqualTo("2026-07-19T06:30:00-04:00"));
        Assert.That(normalized.ManualOverrideUntil, Is.Empty);
        Assert.That(normalized.Profiles.Single(profile => profile.Id == "scene-gaming").ThemeId, Is.EqualTo("gaming"));
    }

    [Test]
    public void Normalize_LegacyNightDisplayAssignmentUsesDefaultBehavioralMode()
    {
        var scenes = SceneDefaults.Create();
        scenes.DefaultSceneId = "scene-gaming";
        scenes.DisplayAssignments =
        [
            new DisplaySceneAssignment { DisplayId = "DISPLAY2", SceneId = "scene-night" }
        ];

        var normalized = SceneDefaults.Normalize(scenes);

        Assert.That(normalized.DisplayAssignments, Has.Count.EqualTo(1));
        Assert.That(normalized.DisplayAssignments.Single().SceneId, Is.EqualTo("scene-gaming"));
        Assert.That(normalized.Profiles.Select(profile => profile.Id), Does.Contain("scene-night"));
    }

    [TestCase(" #a1b2c3 ", "#A1B2C3")]
    [TestCase("#FFFFFF", "#FFFFFF")]
    [TestCase("#123abC", "#123ABC")]
    [TestCase("", "")]
    [TestCase("#123", "")]
    [TestCase("123456", "")]
    [TestCase("#GGGGGG", "")]
    [TestCase("#12345678", "")]
    public void NormalizeAccentColor_AcceptsOnlyCanonicalRgbHex(string input, string expected)
    {
        Assert.That(SceneDefaults.NormalizeAccentColor(input), Is.EqualTo(expected));
    }

    [Test]
    public void ConfigStore_CustomAccentRequiresExplicitCustomMode()
    {
        var store = CreateStore("accent-config");

        var custom = store.Update(config =>
        {
            config.Dashboard.AccentMode = "custom";
            config.Dashboard.CustomAccentColor = " #a1b2c3 ";
            return config;
        });

        Assert.That(custom.Dashboard.AccentMode, Is.EqualTo("custom"));
        Assert.That(custom.Dashboard.CustomAccentColor, Is.EqualTo("#A1B2C3"));

        var preset = store.Update(config =>
        {
            config.Dashboard.AccentMode = "preset";
            config.Dashboard.CustomAccentColor = "#A1B2C3";
            return config;
        });

        Assert.That(preset.Dashboard.AccentMode, Is.EqualTo("preset"));
        Assert.That(preset.Dashboard.CustomAccentColor, Is.Empty);
    }

    [Test]
    public void RestorePortableBackup_SchemaOneMigratesLegacySceneThemes()
    {
        var store = CreateStore("schema-one");
        var controller = CreateController(store);
        var backup = new PortableBackupRequest
        {
            SchemaVersion = 1,
            Scenes = new SceneCollectionConfig
            {
                ActiveSceneId = "legacy-edge",
                DefaultSceneId = "legacy-edge",
                Profiles =
                [
                    new SceneProfile { Id = "legacy-edge", Name = "Edge", ThemeId = "edge" },
                    new SceneProfile { Id = "legacy-core", Name = "Core", ThemeId = "deepcore" },
                    new SceneProfile { Id = "legacy-burn", Name = "Burn", ThemeId = "afterburn" },
                    new SceneProfile { Id = "legacy-green", Name = "Green", ThemeId = "verdant" }
                ]
            }
        };

        controller.RestorePortableBackup(backup);
        var restored = store.Snapshot().Scenes.Profiles.ToDictionary(profile => profile.Id);

        Assert.That(restored["legacy-edge"].ThemeId, Is.EqualTo("focus"));
        Assert.That(restored["legacy-core"].ThemeId, Is.EqualTo("gaming"));
        Assert.That(restored["legacy-burn"].ThemeId, Is.EqualTo("warm"));
        Assert.That(restored["legacy-green"].ThemeId, Is.EqualTo("focus"));
    }

    [Test]
    public void PortableBackup_SchemaTwoRoundTripsThemeState()
    {
        var sourceStore = CreateStore("schema-two-source");
        var sourceController = CreateController(sourceStore);
        sourceStore.Update(config =>
        {
            config.Dashboard.ThemeId = "gaming";
            config.Dashboard.AccentMode = "custom";
            config.Dashboard.CustomAccentColor = "#A1B2C3";
            config.Dashboard.ThemeVariant = "night";
            config.Dashboard.AnimationIntensity = 73;
            config.Dashboard.DashboardOpacity = 64;
            config.Scenes.ActiveSceneId = "scene-gaming";
            config.Scenes.DefaultSceneId = "scene-gaming";
            config.Scenes.ThemeVariant = "night";
            config.Scenes.VariantOverrideUntil = "2026-07-19T06:30:00-04:00";
            return config;
        });

        var json = JsonSerializer.Serialize(sourceController.BuildPortableBackup());
        var backup = JsonSerializer.Deserialize<PortableBackupRequest>(json, BackupSerializerOptions);

        Assert.That(backup, Is.Not.Null);
        Assert.That(backup!.SchemaVersion, Is.EqualTo(2));

        var destinationStore = CreateStore("schema-two-destination");
        var destinationController = CreateController(destinationStore);
        destinationController.RestorePortableBackup(backup);

        var restored = destinationStore.Snapshot();
        Assert.That(restored.Dashboard.ThemeId, Is.EqualTo("gaming"));
        Assert.That(restored.Dashboard.AccentMode, Is.EqualTo("custom"));
        Assert.That(restored.Dashboard.CustomAccentColor, Is.EqualTo("#A1B2C3"));
        Assert.That(restored.Dashboard.ThemeVariant, Is.EqualTo("night"));
        Assert.That(restored.Dashboard.AnimationIntensity, Is.EqualTo(73));
        Assert.That(restored.Dashboard.DashboardOpacity, Is.EqualTo(64));
        Assert.That(restored.Scenes.ActiveSceneId, Is.EqualTo("scene-gaming"));
        Assert.That(restored.Scenes.DefaultSceneId, Is.EqualTo("scene-gaming"));
        Assert.That(restored.Scenes.ThemeVariant, Is.EqualTo("night"));
        Assert.That(restored.Scenes.VariantOverrideUntil, Is.EqualTo("2026-07-19T06:30:00-04:00"));
    }

    [Test]
    public void MediaPrivacyControls_DefaultOffAndRoundTripThroughPortableBackup()
    {
        var sourceStore = CreateStore("media-privacy-source");
        var sourceController = CreateController(sourceStore);

        Assert.Multiple((Action)(() =>
        {
            Assert.That(sourceStore.Snapshot().Dashboard.MediaMetadataVisible, Is.False);
            Assert.That(sourceStore.Snapshot().Dashboard.AudioSessionLabelsVisible, Is.False);
        }));

        sourceController.UpdateDashboard(new DashboardConfigRequest
        {
            MediaMetadataVisible = true,
            AudioSessionLabelsVisible = true
        });
        var json = JsonSerializer.Serialize(sourceController.BuildPortableBackup());
        var backup = JsonSerializer.Deserialize<PortableBackupRequest>(json, BackupSerializerOptions);

        Assert.That(backup, Is.Not.Null);
        Assert.Multiple((Action)(() =>
        {
            Assert.That(backup!.Dashboard!.MediaMetadataVisible, Is.True);
            Assert.That(backup.Dashboard.AudioSessionLabelsVisible, Is.True);
        }));

        var destinationStore = CreateStore("media-privacy-destination");
        var destinationController = CreateController(destinationStore);
        destinationController.RestorePortableBackup(backup!);

        Assert.Multiple((Action)(() =>
        {
            Assert.That(destinationStore.Snapshot().Dashboard.MediaMetadataVisible, Is.True);
            Assert.That(destinationStore.Snapshot().Dashboard.AudioSessionLabelsVisible, Is.True);
        }));
    }

    private ConfigStore CreateStore(string name)
    {
        return new ConfigStore(_logger!, Path.Combine(_tempDirectory, name));
    }

    private ConfigController CreateController(ConfigStore store)
    {
        var steam = new SteamService(_logger!);
        var provisioning = new ProvisioningService(store, steam, _logger!);
        return new ConfigController(store, provisioning);
    }
}
