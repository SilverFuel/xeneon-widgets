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
        Assert.That(automatic.ActiveSceneId, Is.EqualTo("scene-night"));
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
    }
}
