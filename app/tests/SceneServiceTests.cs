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
        Assert.That(snapshot.Profiles, Has.Count.EqualTo(5));
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
    public void Defaults_ContainSixDistinctBuiltInScenes()
    {
        var scenes = SceneDefaults.Create();

        Assert.That(scenes.Profiles, Has.Count.EqualTo(6));
        Assert.That(scenes.Profiles.Select(scene => scene.Id), Is.Unique);
        Assert.That(scenes.Profiles, Has.All.Property(nameof(SceneProfile.IsBuiltIn)).True);
    }

    [Test]
    public void Evaluate_WowForeverGetsItsOwnProfileThemeAndHomePanel()
    {
        var service = CreateService();
        var game = new GameActivityPayload
        {
            Id = "battle.net:1a2b3c",
            Name = "World of Warcraft: Forever",
            ExecutablePath = @"D:\Games\World of Warcraft\_forever_\Wow.exe"
        };

        var snapshot = Snapshot(service.Evaluate(new SceneEvaluationRequest
        {
            ActiveGame = game.Name,
            ActiveGameKey = game.GameKey,
            SampledAt = "2026-07-12T14:00:00-04:00"
        }));
        var active = snapshot.Profiles.Single(scene => scene.Id == snapshot.ActiveSceneId);

        Assert.Multiple((Action)(() =>
        {
            Assert.That(game.GameKey, Is.EqualTo("wow-forever"));
            Assert.That(snapshot.ActiveSceneId, Is.EqualTo("scene-wow-forever"));
            Assert.That(active.ThemeId, Is.EqualTo("horde"));
            Assert.That(active.HomeWidget, Is.EqualTo("wow-forever"));
            Assert.That(snapshot.LastActivationReason, Does.Contain("game"));
        }));
    }

    [Test]
    public void Evaluate_UnknownGameFallsBackToGamingAndItsHud()
    {
        var service = CreateService();
        var game = new GameActivityPayload { Id = "epic:9f8e7d", Name = "Example Game", ExecutablePath = @"D:\Games\Example\Example.exe" };

        var snapshot = Snapshot(service.Evaluate(new SceneEvaluationRequest
        {
            ActiveGame = game.Name,
            ActiveGameKey = game.GameKey,
            SampledAt = "2026-07-12T14:00:00-04:00"
        }));
        var active = snapshot.Profiles.Single(scene => scene.Id == snapshot.ActiveSceneId);

        Assert.Multiple((Action)(() =>
        {
            Assert.That(game.GameKey, Is.EqualTo("game:example-game"));
            Assert.That(snapshot.ActiveSceneId, Is.EqualTo("scene-gaming"));
            Assert.That(active.HomeWidget, Is.EqualTo("game-mode"));
        }));
    }

    [TestCase(@"C:\Games\World of Warcraft\_retail_\Wow.exe", "World of Warcraft")]
    [TestCase(@"C:\Games\World of Warcraft\_classic_\WowClassic.exe", "World of Warcraft")]
    [TestCase(@"C:\Program Files (x86)\Battle.net\Battle.net.exe", "World of Warcraft: Forever")]
    [TestCase("", "World of Warcraft: Forever")]
    [TestCase(@"D:\Tools\notwow.exe", "wow-forever")]
    public void Evaluate_OtherWarcraftClientsAndLaunchersDoNotGetTheForeverProfile(string executablePath, string name)
    {
        var service = CreateService();
        var game = new GameActivityPayload { Name = name, ExecutablePath = executablePath };

        var snapshot = Snapshot(service.Evaluate(new SceneEvaluationRequest
        {
            ActiveGame = game.Name,
            ActiveGameKey = game.GameKey,
            SampledAt = "2026-07-12T14:00:00-04:00"
        }));

        Assert.That(snapshot.ActiveSceneId, Is.EqualTo("scene-gaming"));
    }

    [Test]
    public void Evaluate_WhenTheGameExitsTheDefaultProfileReturns()
    {
        var service = CreateService();
        service.Evaluate(new SceneEvaluationRequest { ActiveGame = "World of Warcraft", ActiveGameKey = "wow-forever", SampledAt = "2026-07-12T14:00:00-04:00" });

        var snapshot = Snapshot(service.Evaluate(new SceneEvaluationRequest { SampledAt = "2026-07-12T14:05:00-04:00" }));

        Assert.That(snapshot.ActiveSceneId, Is.EqualTo("scene-work"));
    }

    [Test]
    public void Evaluate_ASecondGameProfileNeedsOnlyAProfileWithAGameKeyRule()
    {
        var service = CreateService();
        var duplicated = Snapshot(service.Duplicate(new SceneDuplicateRequest { SceneId = "scene-gaming", Name = "Diablo" }));
        var custom = duplicated.Profiles.Single(scene => !scene.IsBuiltIn);
        custom.ThemeId = "ember";
        custom.HomeWidget = "system";
        custom.Rules = [new SceneRule { Id = "rule-diablo", Type = "game", Value = "diablo-iv", Priority = 110 }];
        service.Save(new SceneSaveRequest { Scene = custom });
        service.ResumeAutomation();
        var game = new GameActivityPayload { Name = "Diablo IV", ExecutablePath = @"D:\Games\Diablo IV\Diablo IV.exe" };

        var snapshot = Snapshot(service.Evaluate(new SceneEvaluationRequest
        {
            ActiveGame = game.Name,
            ActiveGameKey = game.GameKey,
            SampledAt = "2026-07-12T14:00:00-04:00"
        }));
        var active = snapshot.Profiles.Single(scene => scene.Id == snapshot.ActiveSceneId);

        Assert.Multiple((Action)(() =>
        {
            Assert.That(game.GameKey, Is.EqualTo("diablo-iv"));
            Assert.That(snapshot.ActiveSceneId, Is.EqualTo(custom.Id));
            Assert.That(active.ThemeId, Is.EqualTo("ember"));
            Assert.That(active.HomeWidget, Is.EqualTo("system"));
        }));
    }

    [Test]
    public void SetTheme_ChangesABuiltInProfileAndSurvivesNormalization()
    {
        var service = CreateService();

        var snapshot = Snapshot(service.SetTheme(new SceneThemeRequest { SceneId = "scene-work", ThemeId = "midnight" }));
        var reloaded = Snapshot(service.GetSnapshot());

        Assert.Multiple((Action)(() =>
        {
            Assert.That(snapshot.Profiles.Single(scene => scene.Id == "scene-work").ThemeId, Is.EqualTo("midnight"));
            Assert.That(reloaded.Profiles.Single(scene => scene.Id == "scene-work").ThemeId, Is.EqualTo("midnight"));
            Assert.That(reloaded.Profiles.Single(scene => scene.Id == "scene-work").IsBuiltIn, Is.True);
            Assert.That(SceneDefaults.NormalizeProfile(new SceneProfile { Id = "scene-gaming", ThemeId = "ocean", IsBuiltIn = true }).ThemeId, Is.EqualTo("ocean"));
        }));
        Assert.Throws<InvalidOperationException>((Action)(() => service.SetTheme(new SceneThemeRequest { SceneId = "no-such-profile", ThemeId = "focus" })));
    }

    [Test]
    public void Normalize_ProfilesSavedBeforeHomePanelsGainTheBuiltInDefaults()
    {
        var scenes = SceneDefaults.Create();
        scenes.Profiles.RemoveAll(scene => scene.Id == "scene-wow-forever");
        scenes.Profiles.Single(scene => scene.Id == "scene-gaming").HomeWidget = "";

        var normalized = SceneDefaults.Normalize(scenes);

        Assert.Multiple((Action)(() =>
        {
            Assert.That(normalized.Profiles.Single(scene => scene.Id == "scene-gaming").HomeWidget, Is.EqualTo("game-mode"));
            Assert.That(normalized.Profiles.Single(scene => scene.Id == "scene-wow-forever").HomeWidget, Is.EqualTo("wow-forever"));
            Assert.That(normalized.Profiles.Single(scene => scene.Id == "scene-work").HomeWidget, Is.Empty);
        }));
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

    [Test]
    public void CreateForGame_GivesTheGameItsOwnProfileWithoutActivatingIt()
    {
        var service = CreateService();
        var before = Snapshot(service.GetSnapshot());
        var gaming = before.Profiles.Single(scene => scene.Id == "scene-gaming");

        var after = Snapshot(service.CreateForGame(new SceneGameProfileRequest { GameKey = "Steam:1086940", Name = "Baldur's Gate 3" }));
        var created = after.Profiles.Single(scene => scene.Name == "Baldur's Gate 3");

        Assert.Multiple((Action)(() =>
        {
            Assert.That(after.Profiles, Has.Count.EqualTo(before.Profiles.Count + 1));
            Assert.That(created.IsBuiltIn, Is.False);
            Assert.That(created.ThemeId, Is.EqualTo(gaming.ThemeId));
            Assert.That(created.ThemeVariant, Is.EqualTo("standard"));
            Assert.That(created.HomeWidget, Is.EqualTo(gaming.HomeWidget));
            Assert.That(created.Widgets, Is.EqualTo(gaming.Widgets));
            Assert.That(created.Rules, Has.Count.EqualTo(1));
            Assert.That(created.Rules[0].Type, Is.EqualTo("game"));
            Assert.That(created.Rules[0].Value, Is.EqualTo("steam:1086940"));
            Assert.That(created.Rules[0].Priority, Is.EqualTo(110));
            Assert.That(created.Rules[0].Enabled, Is.True);
            Assert.That(after.ActiveSceneId, Is.EqualTo(before.ActiveSceneId));
            Assert.That(after.ManualOverrideActive, Is.False);
        }));
    }

    [Test]
    public void CreateForGame_TheNewProfileWinsForThatGameOnly()
    {
        var service = CreateService();
        service.CreateForGame(new SceneGameProfileRequest { GameKey = "steam:1086940", Name = "Baldur's Gate 3" });

        var playing = Snapshot(service.Evaluate(new SceneEvaluationRequest
        {
            ActiveGame = "Baldur's Gate 3", ActiveGameKey = "steam:1086940", SampledAt = "2026-07-12T14:00:00-04:00"
        }));
        Assert.That(playing.Profiles.Single(scene => scene.Id == playing.ActiveSceneId).Name, Is.EqualTo("Baldur's Gate 3"));

        var other = Snapshot(service.Evaluate(new SceneEvaluationRequest
        {
            ActiveGame = "Hades", ActiveGameKey = "steam:1145360", SampledAt = "2026-07-12T14:05:00-04:00"
        }));
        Assert.That(other.ActiveSceneId, Is.EqualTo("scene-gaming"));

        var theme = Snapshot(service.SetTheme(new SceneThemeRequest { SceneId = playing.ActiveSceneId, ThemeId = "ember" }));
        Assert.That(theme.Profiles.Single(scene => scene.Id == playing.ActiveSceneId).ThemeId, Is.EqualTo("ember"));
        Assert.That(theme.Profiles.Single(scene => scene.Id == "scene-gaming").ThemeId, Is.Not.EqualTo("ember"));
    }

    [Test]
    public void CreateForGame_AGameThatAlreadyHasAProfileGetsNoSecondOne()
    {
        var service = CreateService();
        var before = Snapshot(service.GetSnapshot()).Profiles.Count;

        Assert.That(Snapshot(service.CreateForGame(new SceneGameProfileRequest { GameKey = "wow-forever", Name = "WoW" })).Profiles, Has.Count.EqualTo(before));

        service.CreateForGame(new SceneGameProfileRequest { GameKey = "game:hades", Name = "Hades" });
        var again = Snapshot(service.CreateForGame(new SceneGameProfileRequest { GameKey = " GAME:HADES ", Name = "Hades again" }));
        Assert.That(again.Profiles, Has.Count.EqualTo(before + 1));
        Assert.That(again.Profiles.Any(scene => scene.Name == "Hades again"), Is.False);
    }

    [TestCase(null)]
    [TestCase("")]
    [TestCase("   ")]
    [TestCase(@"C:\Games\Hades\Hades.exe")]
    [TestCase("game:two words")]
    [TestCase("game:<script>")]
    public void CreateForGame_RefusesAnythingThatIsNotAGameKey(string? gameKey)
    {
        var service = CreateService();
        var before = Snapshot(service.GetSnapshot()).Profiles.Count;

        Assert.Throws<InvalidOperationException>((Action)(() => service.CreateForGame(new SceneGameProfileRequest { GameKey = gameKey, Name = "Game" })));
        Assert.Throws<InvalidOperationException>((Action)(() => service.CreateForGame(new SceneGameProfileRequest { GameKey = "game:" + new string('a', 96), Name = "Game" })));
        Assert.That(Snapshot(service.GetSnapshot()).Profiles, Has.Count.EqualTo(before));
    }

    [Test]
    public void CreateForGame_CleansTheNameAndStopsWhenTheListIsFull()
    {
        var service = CreateService();
        var named = Snapshot(service.CreateForGame(new SceneGameProfileRequest { GameKey = "game:long", Name = "  Tab\tbed " + new string('n', 80) }));
        var blank = Snapshot(service.CreateForGame(new SceneGameProfileRequest { GameKey = "game:blank", Name = " \n " }));
        Assert.That(named.Profiles.Any(scene => scene.Name == ("Tabbed " + new string('n', 80))[..40]), Is.True);
        Assert.That(blank.Profiles.Count(scene => scene.Name == "Game"), Is.EqualTo(1));

        // Fill the list. The host counts every stored Profile, so the test
        // does not assume how many of them a snapshot shows.
        var beforeFilling = Snapshot(service.GetSnapshot()).Profiles.Count;
        var created = 0;
        InvalidOperationException? full = null;
        for (var index = 0; index < SceneService.MaxProfiles + 4 && full is null; index++)
        {
            try
            {
                service.CreateForGame(new SceneGameProfileRequest { GameKey = "game:filler-" + index, Name = "Filler" });
                created++;
            }
            catch (InvalidOperationException error)
            {
                full = error;
            }
        }

        Assert.That(full, Is.Not.Null, "the list never filled up");
        Assert.That(full!.Message, Does.Contain("no room"));
        Assert.That(created, Is.GreaterThan(0));
        Assert.That(created, Is.LessThan(SceneService.MaxProfiles));
        // Every Profile that was accepted is still there: none was dropped silently.
        Assert.That(Snapshot(service.GetSnapshot()).Profiles, Has.Count.EqualTo(beforeFilling + created));

        Assert.Throws<InvalidOperationException>((Action)(() => service.CreateForGame(new SceneGameProfileRequest { GameKey = "game:one-too-many", Name = "Extra" })));
        Assert.That(Snapshot(service.GetSnapshot()).Profiles, Has.Count.EqualTo(beforeFilling + created));
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
