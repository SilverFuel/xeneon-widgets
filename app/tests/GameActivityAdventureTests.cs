using NUnit.Framework;
using System.Text.Json;

namespace XenonEdgeHost.Tests;

public sealed class GameActivityAdventureTests
{
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

        Assert.That(game.GameKey, Is.Empty);
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
