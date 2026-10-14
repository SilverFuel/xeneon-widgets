using NUnit.Framework;

namespace XenonEdgeHost.Tests;

public sealed class SceneServiceTests
{
    private string _tempDirectory = "";
    private HostLogger? _logger;

    [SetUp]
    public void SetUp()
    {
        _tempDirectory = Path.Combine(Path.GetTempPath(), $"auxora-scene-tests-{Guid.NewGuid():N}");
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

    [Test]
    public void Evaluate_ManualOverrideWinsUntilAutomationResumes()
    {
        var service = CreateService();
        service.Activate(new SceneActivationRequest { SceneId = "scene-gaming", ManualOverrideMinutes = -1 });

        var overridden = Snapshot(service.Evaluate(new SceneEvaluationRequest { SampledAt = "2026-07-12T23:30:00-04:00" }));
        Assert.That(overridden.ActiveSceneId, Is.EqualTo("scene-gaming"));

        service.ResumeAutomation();
        var automatic = Snapshot(service.Evaluate(new SceneEvaluationRequest { SampledAt = "2026-07-12T23:30:00-04:00" }));
        Assert.That(automatic.ActiveSceneId, Is.EqualTo("scene-work"));
        Assert.That(automatic.ThemeVariant, Is.EqualTo("night"));
    }

    [Test]
    public void ResumeAutomation_PreservesIndependentNightState()
    {
        var service = CreateService();
        service.Activate(new SceneActivationRequest { SceneId = "scene-night", ManualOverrideMinutes = -1 });
        service.Activate(new SceneActivationRequest { SceneId = "scene-gaming", ManualOverrideMinutes = -1 });

        var resumed = Snapshot(service.ResumeAutomation());

        Assert.That(resumed.ThemeVariant, Is.EqualTo("night"));
        Assert.That(resumed.ManualOverrideActive, Is.False);
        Assert.That(resumed.AutomaticSwitchingActive, Is.True);
    }

    [Test]
    public void GetSnapshot_HidesLegacyNightCarrierAndReportsAutomationState()
    {
        var service = CreateService();

        var snapshot = Snapshot(service.GetSnapshot());

        Assert.That(snapshot.Profiles.Select(scene => scene.Id), Does.Not.Contain("scene-night"));
        Assert.That(snapshot.Profiles, Has.Count.EqualTo(4));
        Assert.That(snapshot.ManualOverrideActive, Is.False);
        Assert.That(snapshot.AutomaticSwitchingActive, Is.True);
    }

    [Test]
    public void SetDisplayAssignment_AssignsReassignsAndUnassignsBehavioralMode()
    {
        var scenes = SceneDefaults.Create();

        SceneService.SetDisplayAssignment(scenes, "DISPLAY2", "scene-gaming");
        Assert.That(scenes.DisplayAssignments, Has.Count.EqualTo(1));
        Assert.That(scenes.DisplayAssignments.Single().SceneId, Is.EqualTo("scene-gaming"));

        SceneService.SetDisplayAssignment(scenes, "display2", "scene-home");
        Assert.That(scenes.DisplayAssignments, Has.Count.EqualTo(1));
        Assert.That(scenes.DisplayAssignments.Single().SceneId, Is.EqualTo("scene-home"));

        Assert.Throws<InvalidOperationException>((Action)(() =>
            SceneService.SetDisplayAssignment(scenes, "DISPLAY2", "scene-night")));
        Assert.That(scenes.DisplayAssignments.Single().SceneId, Is.EqualTo("scene-home"));

        SceneService.SetDisplayAssignment(scenes, "DISPLAY2", "");
        Assert.That(scenes.DisplayAssignments, Is.Empty);
    }

    [Test]
    public void Evaluate_GameRuleBeatsMediaAndScheduleRules()
    {
        var service = CreateService();

        var snapshot = Snapshot(service.Evaluate(new SceneEvaluationRequest
        {
            ActiveGame = "Example Game",
            MediaPlaying = true,
            SampledAt = "2026-07-12T23:30:00-04:00"
        }));

        Assert.That(snapshot.ActiveSceneId, Is.EqualTo("scene-gaming"));
        Assert.That(snapshot.LastActivationReason, Does.Contain("game"));
    }

    [Test]
    public void Defaults_ContainFiveDistinctBuiltInScenes()
    {
        var scenes = SceneDefaults.Create();

        Assert.That(scenes.Profiles, Has.Count.EqualTo(5));
        Assert.That(scenes.Profiles.Select(scene => scene.Id), Is.Unique);
        Assert.That(scenes.Profiles, Has.All.Property(nameof(SceneProfile.IsBuiltIn)).True);
    }

    [Test]
    public void Normalize_MigratesLegacySceneLabelToModeLabel()
    {
        var scenes = SceneDefaults.Create();
        scenes.LastActivationReason = "Default scene";

        var normalized = SceneDefaults.Normalize(scenes);

        Assert.That(normalized.LastActivationReason, Is.EqualTo("Default mode"));
    }

    [Test]
    public void CustomMode_CanBeDuplicatedEditedAndDeletedWithoutLeavingAnInvalidActiveMode()
    {
        var service = CreateService();

        var duplicated = Snapshot(service.Duplicate(new SceneDuplicateRequest { SceneId = "scene-work" }));
        var custom = duplicated.Profiles.Single(scene => !scene.IsBuiltIn);
        custom.Name = "Work Touch";
        custom.ThemeId = "warm";
        custom.Density = "compact";
        custom.AnimationIntensity = 47;
        custom.PerformanceBudget = "game";

        var saved = Snapshot(service.Save(new SceneSaveRequest { Scene = custom }));
        var savedCustom = saved.Profiles.Single(scene => !scene.IsBuiltIn);
        Assert.Multiple((Action)(() =>
        {
            Assert.That(saved.ActiveSceneId, Is.EqualTo(custom.Id));
            Assert.That(savedCustom.Name, Is.EqualTo("Work Touch"));
            Assert.That(savedCustom.ThemeId, Is.EqualTo("warm"));
            Assert.That(savedCustom.Density, Is.EqualTo("compact"));
            Assert.That(savedCustom.AnimationIntensity, Is.EqualTo(47));
            Assert.That(savedCustom.PerformanceBudget, Is.EqualTo("game"));
        }));

        var deleted = Snapshot(service.Delete(new SceneDeleteRequest { SceneId = custom.Id }));
        Assert.That(deleted.ActiveSceneId, Is.EqualTo("scene-work"));
        Assert.That(deleted.Profiles, Has.None.Property(nameof(SceneProfile.IsBuiltIn)).False);
    }

    private SceneService CreateService()
    {
        return new SceneService(new ConfigStore(_logger!, Path.Combine(_tempDirectory, "config")));
    }

    private static SceneSnapshot Snapshot(object payload)
    {
        var json = System.Text.Json.JsonSerializer.Serialize(payload);
        return System.Text.Json.JsonSerializer.Deserialize<SceneSnapshot>(json, new System.Text.Json.JsonSerializerOptions
        {
            PropertyNameCaseInsensitive = true
        })!;
    }

    private sealed class SceneSnapshot
    {
        public string ActiveSceneId { get; set; } = "";

        public string LastActivationReason { get; set; } = "";

        public string ThemeVariant { get; set; } = "";

        public bool ManualOverrideActive { get; set; }

        public bool AutomaticSwitchingActive { get; set; }

        public List<SceneProfile> Profiles { get; set; } = [];
    }
}
