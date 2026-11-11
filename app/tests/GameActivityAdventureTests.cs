using NUnit.Framework;
using System.Text.Json;

namespace XenonEdgeHost.Tests;

public sealed class GameActivityAdventureTests
{
    [Test]
    public void RapidRelaunchOfSameGameStartsNewSessionWithoutAnIdlePoll()
    {
        var session = new GameActivitySession();
        var firstStart = DateTimeOffset.UtcNow.AddMinutes(-5);
        var nextStart = firstStart.AddMinutes(5);
        session.Update("wow", 100, firstStart, firstStart.AddSeconds(10));
        session.Update("wow", 101, nextStart, nextStart.AddSeconds(2));
        Assert.That(session.StartedAt, Is.EqualTo(nextStart));
    }

    [Test]
    public void ReusedProcessIdWithNewStartTimeStartsNewSession()
    {
        var session = new GameActivitySession();
        var firstStart = DateTimeOffset.UtcNow.AddMinutes(-5);
        var nextStart = firstStart.AddMinutes(5);
        session.Update("wow", 100, firstStart, firstStart.AddSeconds(10));
        session.Update("wow", 100, nextStart, nextStart.AddSeconds(2));
        Assert.That(session.StartedAt, Is.EqualTo(nextStart));
    }

    [Test]
    public void TimestampPrecisionDifferencesDoNotRestartTheSameProcess()
    {
        var session = new GameActivitySession();
        var firstStart = DateTimeOffset.UtcNow.AddMinutes(-5);
        session.Update("wow", 100, firstStart, firstStart.AddSeconds(10));
        session.Update("wow", 100, firstStart.AddTicks(5), firstStart.AddSeconds(20));
        Assert.That(session.StartedAt, Is.EqualTo(firstStart));
    }

    [Test]
    public void MissingRuntimeDetailsPreserveSessionAndKnownIdentity()
    {
        var session = new GameActivitySession();
        var firstStart = DateTimeOffset.UtcNow.AddMinutes(-5);
        session.Update("wow", 100, firstStart, firstStart.AddSeconds(10));
        session.Update("wow", null, null, firstStart.AddSeconds(20));
        session.Update("wow", 100, firstStart, firstStart.AddSeconds(30));
        Assert.That(session.StartedAt, Is.EqualTo(firstStart));

        session.Update("wow", null, null, firstStart.AddSeconds(40));
        var nextSample = firstStart.AddMinutes(5);
        session.Update("wow", 101, null, nextSample);
        Assert.That(session.StartedAt, Is.EqualTo(nextSample));
    }

    [Test]
    public void LateRuntimeIdentityDoesNotRestartSession()
    {
        var session = new GameActivitySession();
        var firstSample = DateTimeOffset.UtcNow;
        session.Update("wow", null, null, firstSample);
        session.Update("wow", 100, firstSample.AddSeconds(-10), firstSample.AddSeconds(5));
        Assert.That(session.StartedAt, Is.EqualTo(firstSample));
    }

    [Test]
    public void EndedSessionDoesNotCarryIdentityIntoNextLaunch()
    {
        var session = new GameActivitySession();
        var firstStart = DateTimeOffset.UtcNow.AddMinutes(-5);
        session.Update("wow", 100, firstStart, firstStart);
        session.End();
        Assert.That(session.StartedAt, Is.Null);
        var nextStart = firstStart.AddMinutes(5);
        session.Update("wow", null, null, nextStart);
        Assert.That(session.StartedAt, Is.EqualTo(nextStart));
    }

    [TestCase(@"C:\Program Files (x86)\World of Warcraft\_forever_\Wow.exe")]
    [TestCase(@"D:\Games\World of Warcraft\_FOREVER_\WOW.EXE")]
    [TestCase("D:/Games/World of Warcraft/_forever_/Wow.exe")]
    public void ForeverClient_UsesCanonicalAdventureIdentity(string executablePath)
    {
        var game = new GameActivityPayload { Name = "My pinned game", ExecutablePath = executablePath };

        Assert.Multiple((Action)(() =>
        {
            Assert.That(game.GameKey, Is.EqualTo("wow-forever"));
            Assert.That(GameActivityService.TryInferBattleNetGamePath(executablePath, out var inferred), Is.True);
            Assert.That(inferred.Name, Is.EqualTo("World of Warcraft: Forever"));
            Assert.That(inferred.Platform, Is.EqualTo("Battle.net"));
        }));
    }

    [TestCase(@"C:\Games\World of Warcraft\_retail_\Wow.exe")]
    [TestCase(@"C:\Games\World of Warcraft\_classic_\WowClassic.exe")]
    [TestCase(@"C:\Games\World of Warcraft\_classic_beta_\Wow.exe")]
    [TestCase(@"C:\Games\World of Warcraft\_forever_\BlizzardError.exe")]
    [TestCase(@"C:\Games\World of Warcraft\_forever_\World of Warcraft Launcher.exe")]
    [TestCase(@"C:\Games\World of Warcraft\World of Warcraft Launcher.exe")]
    [TestCase(@"C:\Program Files (x86)\Battle.net\Battle.net.exe")]
    [TestCase(@"C:\Games\World of Warcraft\_forever_backup_\Wow.exe")]
    [TestCase(@"C:\Games\World of Warcraft\_forever_\Tools\Wow.exe")]
    [TestCase(@"C:\Games\World of Warcraft\_forever_\..\_retail_\Wow.exe")]
    [TestCase(@"_forever_\Wow.exe")]
    [TestCase("")]
    [TestCase(null)]
    public void OtherClientsAndLaunchers_CannotImpersonateForeverByDisplayName(string? executablePath)
    {
        var game = new GameActivityPayload
        {
            Name = "World of Warcraft: Forever",
            ExecutablePath = executablePath ?? ""
        };

        Assert.That(game.GameKey, Is.Not.EqualTo("wow-forever"));
    }

    [TestCase("steam:440", "Team Fortress 2", @"D:\Steam\steamapps\common\Team Fortress 2\tf_win64.exe", "steam:440")]
    [TestCase("battle.net:abc", "Diablo IV", @"D:\Games\Diablo IV\Diablo IV.exe", "diablo-iv")]
    [TestCase("battle.net:abc", "World of Warcraft", @"C:\Games\World of Warcraft\_retail_\Wow.exe", "world-of-warcraft")]
    [TestCase("epic:abc", "  Hades II: Early Access!  ", @"D:\Epic\Hades2\Hades2.exe", "game:hades-ii-early-access")]
    [TestCase("game-1", "wow-forever", @"D:\Tools\notwow.exe", "game:wow-forever")]
    [TestCase("", "", "", "")]
    public void EveryGameGetsAStableKeyThatNeverContainsItsPath(string id, string name, string executablePath, string expected)
    {
        var game = new GameActivityPayload { Id = id, Name = name, ExecutablePath = executablePath };

        Assert.That(game.GameKey, Is.EqualTo(expected));
    }

    [Test]
    public void RetailClient_RemainsGenericWorldOfWarcraft()
    {
        Assert.That(GameActivityService.TryInferBattleNetGamePath(
            @"C:\Games\World of Warcraft\_retail_\Wow.exe", out var inferred), Is.True);
        Assert.That(inferred.Name, Is.EqualTo("World of Warcraft"));
    }

    [Test]
    public void SerializedGame_ExposesAdventureKeyWithoutPrivateRuntimeDetails()
    {
        var game = new GameActivityPayload
        {
            Name = "World of Warcraft",
            ProcessId = 123,
            ProcessName = "Wow",
            ExecutablePath = @"C:\Users\PrivateName\Games\_forever_\Wow.exe"
        };
        using var json = JsonDocument.Parse(JsonSerializer.Serialize(game, new JsonSerializerOptions(JsonSerializerDefaults.Web)));

        Assert.Multiple((Action)(() =>
        {
            Assert.That(json.RootElement.GetProperty("gameKey").GetString(), Is.EqualTo("wow-forever"));
            Assert.That(json.RootElement.TryGetProperty("executablePath", out _), Is.False);
            Assert.That(json.RootElement.TryGetProperty("processName", out _), Is.False);
            Assert.That(json.RootElement.TryGetProperty("processId", out _), Is.False);
            Assert.That(json.RootElement.GetRawText(), Does.Not.Contain("PrivateName"));
        }));
    }

    [Test]
    public void AdventureKey_TracksRuntimeIdentityWhenCandidateDetailsAreMerged()
    {
        var reported = new GameActivityPayload { Id = "game", Name = "World of Warcraft", Confidence = 98 };
        var running = new GameActivityPayload
        {
            Id = "game",
            Name = "World of Warcraft: Forever",
            Confidence = 84,
            ProcessId = 123,
            ProcessName = "Wow",
            StartedAt = DateTimeOffset.UtcNow,
            ExecutablePath = @"D:\Games\World of Warcraft\_forever_\Wow.exe"
        };

        var selected = GameActivityService.SelectBestCandidate([reported, running]);

        Assert.Multiple((Action)(() =>
        {
            Assert.That(selected, Is.SameAs(reported));
            Assert.That(selected.GameKey, Is.EqualTo("wow-forever"));
            Assert.That(selected.ProcessId, Is.EqualTo(123));
            Assert.That(selected.Name, Is.EqualTo("World of Warcraft"));
        }));
    }
}
