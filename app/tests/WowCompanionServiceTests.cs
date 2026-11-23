using System.Text.Json;
using NUnit.Framework;

namespace XenonEdgeHost.Tests;

[TestFixture]
public sealed class WowCompanionServiceTests
{
    // The layout the Forever client wrote on 2026-11-12 (build 1.60.1.70888),
    // with the character renamed and the quest list shortened.
    private const string SavedFile = """

        AuxoraCompanionDB = {
        ["characters"] = {
        ["Grimbold-Forever One"] = {
        ["zone"] = "Hillsbrad Foothills",
        ["class"] = "Paladin",
        ["race"] = "Undead",
        ["home"] = "The Sepulcher",
        ["level"] = 18,
        ["realm"] = "Forever One",
        ["classToken"] = "PALADIN",
        ["copper"] = 25098,
        ["clientInterface"] = 16001,
        ["clientBuild"] = "70888",
        ["subZone"] = "Tarren Mill",
        ["xp"] = 16733,
        ["savedAt"] = 1794461490,
        ["xpMax"] = 19400,
        ["questsRead"] = true,
        ["name"] = "Grimbold",
        ["faction"] = "Horde",
        ["xpRested"] = 3000,
        ["clientVersion"] = "1.60.1",
        ["quests"] = {
        {
        ["title"] = "The Rescue",
        ["zone"] = "Hillsbrad Foothills",
        ["level"] = 22,
        ["objectives"] = {
        {
        ["done"] = false,
        ["text"] = "0/1 Rescue Drull",
        },
        {
        ["done"] = true,
        ["text"] = "1/1 Rescue Tog'thar",
        },
        },
        ["complete"] = false,
        },
        {
        ["title"] = "Deathstalkers in Shadowfang",
        ["zone"] = "Shadowfang Keep",
        ["level"] = 25,
        ["objectives"] = {
        },
        ["complete"] = true,
        },
        },
        ["raceToken"] = "Scourge",
        },
        },
        ["last"] = "Grimbold-Forever One",
        ["addonVersion"] = "0.1.1",
        ["schema"] = 1,
        }

        """;

    private string _root = "";

    [SetUp]
    public void CreateRoot()
    {
        _root = Path.Combine(Path.GetTempPath(), "auxora-wow-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(_root);
    }

    [TearDown]
    public void RemoveRoot()
    {
        try
        {
            Directory.Delete(_root, true);
        }
        catch (IOException)
        {
        }
    }

    private string InstallRoot => Path.Combine(_root, "World of Warcraft");

    private string WriteSaved(string account, string text, DateTime? writtenUtc = null, string? installRoot = null)
    {
        var folder = Path.Combine(installRoot ?? InstallRoot, "_forever_", "WTF", "Account", account, "SavedVariables");
        Directory.CreateDirectory(folder);
        var path = Path.Combine(folder, "AuxoraCompanion.lua");
        File.WriteAllText(path, text);
        if (writtenUtc is { } time)
        {
            File.SetLastWriteTimeUtc(path, time);
        }

        return path;
    }

    private WowCompanionService Service() => new([InstallRoot]);

    [Test]
    public void ReadsTheCharacterTheAddonSaved()
    {
        WriteSaved("ACCOUNT1", SavedFile);

        var snapshot = Service().GetSnapshot();

        Assert.That(snapshot.GameFound && snapshot.Installed && snapshot.Available, Is.True);
        Assert.That(snapshot.AddonVersion, Is.EqualTo("0.1.1"));
        var character = snapshot.Character!;
        Assert.That(character.Name, Is.EqualTo("Grimbold"));
        Assert.That(character.Realm, Is.EqualTo("Forever One"));
        Assert.That(character.Class, Is.EqualTo("Paladin"));
        Assert.That(character.ClassToken, Is.EqualTo("PALADIN"));
        Assert.That(character.Race, Is.EqualTo("Undead"));
        Assert.That(character.Faction, Is.EqualTo("Horde"));
        Assert.That(character.Level, Is.EqualTo(18));
        Assert.That(character.Xp, Is.EqualTo(16733));
        Assert.That(character.XpMax, Is.EqualTo(19400));
        Assert.That(character.XpRested, Is.EqualTo(3000));
        Assert.That(character.Zone, Is.EqualTo("Hillsbrad Foothills"));
        Assert.That(character.SubZone, Is.EqualTo("Tarren Mill"));
        Assert.That(character.Home, Is.EqualTo("The Sepulcher"));
        Assert.That(character.Copper, Is.EqualTo(25098));
        Assert.That(character.SavedAt, Is.EqualTo(DateTimeOffset.FromUnixTimeSeconds(1794461490)));
        Assert.That(character.QuestsRead, Is.True);
        Assert.That(character.Quests, Has.Count.EqualTo(2));
        Assert.That(character.Quests[0].Title, Is.EqualTo("The Rescue"));
        Assert.That(character.Quests[0].Zone, Is.EqualTo("Hillsbrad Foothills"));
        Assert.That(character.Quests[0].Level, Is.EqualTo(22));
        Assert.That(character.Quests[0].Complete, Is.False);
        Assert.That(character.Quests[0].Objectives.Select(objective => objective.Text), Is.EqualTo(new[] { "0/1 Rescue Drull", "1/1 Rescue Tog'thar" }));
        Assert.That(character.Quests[0].Objectives.Select(objective => objective.Done), Is.EqualTo(new[] { false, true }));
        Assert.That(character.Quests[1].Complete, Is.True);
        Assert.That(character.Quests[1].Objectives, Is.Empty);
    }

    [Test]
    public void SaysWhatIsMissingWhenThereIsNoGameOrNoAddon()
    {
        var noGame = Service().GetSnapshot();
        Assert.That(noGame.GameFound || noGame.Installed || noGame.Available, Is.False);
        Assert.That(noGame.Character, Is.Null);
        Assert.That(noGame.Message, Does.Contain("was not found"));

        Directory.CreateDirectory(Path.Combine(InstallRoot, "_forever_", "WTF", "Account", "ACCOUNT1", "SavedVariables"));
        var noAddon = Service().GetSnapshot();
        Assert.That(noAddon.GameFound, Is.True);
        Assert.That(noAddon.Installed || noAddon.Available, Is.False);
        Assert.That(noAddon.Message, Does.Contain("Install the Auxora Companion add-on"));
    }

    [Test]
    public void TheMostRecentlyWrittenAccountWins()
    {
        WriteSaved("OLDER", SavedFile.Replace("Grimbold", "Older"), new DateTime(2026, 11, 1, 0, 0, 0, DateTimeKind.Utc));
        WriteSaved("NEWER", SavedFile.Replace("Grimbold", "Newer"), new DateTime(2026, 11, 12, 0, 0, 0, DateTimeKind.Utc));

        Assert.That(Service().GetSnapshot().Character!.Name, Is.EqualTo("Newer"));
    }

    [Test]
    public void ARunningForeverClientIsFoundOutsideTheUsualFolders()
    {
        var elsewhere = Path.Combine(_root, "Elsewhere", "WoW");
        WriteSaved("ACCOUNT1", SavedFile, installRoot: elsewhere);
        var service = Service();
        Assert.That(service.GetSnapshot().GameFound, Is.False);

        // Another client's executable does not point at Forever's data.
        Assert.That(service.GetSnapshot(Path.Combine(elsewhere, "_retail_", "Wow.exe")).GameFound, Is.False);

        var found = service.GetSnapshot(Path.Combine(elsewhere, "_forever_", "Wow.exe"));
        Assert.That(found.Available, Is.True);
        Assert.That(found.Character!.Name, Is.EqualTo("Grimbold"));

        // Remembered after the game closes.
        Assert.That(service.GetSnapshot().Available, Is.True);
    }

    [Test]
    public void ANewSaveIsPickedUpAndABrokenOneKeepsTheLastGoodSnapshot()
    {
        var path = WriteSaved("ACCOUNT1", SavedFile, new DateTime(2026, 11, 12, 1, 0, 0, DateTimeKind.Utc));
        var service = Service();
        Assert.That(service.GetSnapshot().Character!.Level, Is.EqualTo(18));

        File.WriteAllText(path, SavedFile.Replace("[\"level\"] = 18,", "[\"level\"] = 19,"));
        File.SetLastWriteTimeUtc(path, new DateTime(2026, 11, 12, 2, 0, 0, DateTimeKind.Utc));
        Assert.That(service.GetSnapshot().Character!.Level, Is.EqualTo(19));

        File.WriteAllText(path, "AuxoraCompanionDB = {\n[\"characters\"] = {");
        File.SetLastWriteTimeUtc(path, new DateTime(2026, 11, 12, 3, 0, 0, DateTimeKind.Utc));
        var kept = service.GetSnapshot();
        Assert.That(kept.Available, Is.True);
        Assert.That(kept.Character!.Level, Is.EqualTo(19));
    }

    [Test]
    public void AnUnreadableFirstSaveIsReportedNotInvented()
    {
        WriteSaved("ACCOUNT1", "AuxoraCompanionDB = nil\n");
        var snapshot = Service().GetSnapshot();
        Assert.That(snapshot.GameFound && snapshot.Installed, Is.True);
        Assert.That(snapshot.Available, Is.False);
        Assert.That(snapshot.Character, Is.Null);
        Assert.That(snapshot.Message, Does.Contain("could not be read"));
    }

    [Test]
    public void AnOversizedFileIsNotRead()
    {
        WriteSaved("ACCOUNT1", SavedFile + "-- " + new string('x', (int)WowCompanionService.MaxFileBytes) + "\n");
        Assert.That(Service().GetSnapshot().Available, Is.False);
    }

    [Test]
    public void TheSnapshotSentToTheDashboardHasNoPath()
    {
        WriteSaved("ACCOUNT1", SavedFile);
        var json = JsonSerializer.Serialize(Service().GetSnapshot(Path.Combine(InstallRoot, "_forever_", "Wow.exe")));

        Assert.That(json, Does.Not.Contain(_root.Replace("\\", "\\\\")));
        Assert.That(json, Does.Not.Contain("auxora-wow-"));
        Assert.That(json, Does.Not.Contain("WTF"));
        Assert.That(json, Does.Not.Contain("ACCOUNT1"));
        Assert.That(json, Does.Not.Contain("_forever_"));
    }

    [Test]
    public void SavedTextIsCappedAndCleanedBeforeItReachesTheDashboard()
    {
        var quests = string.Concat(Enumerable.Range(1, 60).Select(index =>
            "{\n[\"title\"] = \"Quest " + index + "\",\n[\"level\"] = -5,\n[\"objectives\"] = {\n"
            + string.Concat(Enumerable.Range(1, 12).Select(step => "{\n[\"text\"] = \"step " + step + "\",\n[\"done\"] = false,\n},\n"))
            + "},\n},\n"));
        var text = "AuxoraCompanionDB = {\n[\"last\"] = \"A-B\",\n[\"characters\"] = {\n[\"A-B\"] = {\n"
            + "[\"name\"] = \"Tab\\tby\\nName\",\n[\"zone\"] = \"" + new string('z', 500) + "\",\n"
            + "[\"level\"] = 1e9,\n[\"copper\"] = -40,\n[\"savedAt\"] = -1,\n[\"quests\"] = {\n" + quests + "},\n},\n},\n}\n";

        var character = WowCompanionService.Parse(text)!.Character!;

        Assert.That(character.Name, Is.EqualTo("TabbyName"));
        Assert.That(character.Zone, Has.Length.EqualTo(64));
        Assert.That(character.Level, Is.EqualTo(999));
        Assert.That(character.Copper, Is.EqualTo(0));
        Assert.That(character.SavedAt, Is.Null);
        Assert.That(character.Quests, Has.Count.EqualTo(WowCompanionService.MaxQuests));
        Assert.That(character.Quests[0].Level, Is.EqualTo(0));
        Assert.That(character.Quests[0].Objectives, Has.Count.EqualTo(WowCompanionService.MaxObjectives));
    }

    [Test]
    public void WithoutALastCharacterTheNewestSaveIsShown()
    {
        var text = "AuxoraCompanionDB = {\n[\"characters\"] = {\n"
            + "[\"Old-Realm\"] = {\n[\"name\"] = \"Old\",\n[\"savedAt\"] = 100,\n},\n"
            + "[\"New-Realm\"] = {\n[\"name\"] = \"New\",\n[\"savedAt\"] = 200,\n},\n},\n}\n";
        Assert.That(WowCompanionService.Parse(text)!.Character!.Name, Is.EqualTo("New"));

        var stale = "AuxoraCompanionDB = {\n[\"last\"] = \"Gone-Realm\",\n[\"characters\"] = {\n[\"Old-Realm\"] = {\n[\"name\"] = \"Old\",\n},\n},\n}\n";
        Assert.That(WowCompanionService.Parse(stale)!.Character!.Name, Is.EqualTo("Old"));
    }

    [Test]
    public void TheReaderHandlesTheFormatsTheGameWrites()
    {
        var table = LuaSavedVariablesReader.ReadTable(
            "Other = {\n[\"x\"] = 1,\n}\n"
            + "Target = {\n"
            + "[\"text\"] = \"a \\\"quoted\\\" back\\\\slash\",\n"
            + "[\"accent\"] = \"caf\\195\\169\",\n"
            + "[\"negative\"] = -2.5,\n"
            + "[\"off\"] = false,\n"
            + "[\"nothing\"] = nil,\n"
            + "bare = true,\n"
            + "[\"list\"] = {\n\"one\", -- [1]\n\"two\", -- [2]\n},\n"
            + "[\"indexed\"] = {\n[1] = \"first\",\n[2] = \"second\",\n},\n"
            + "}\n",
            "Target")!;

        Assert.That(table.Text("text"), Is.EqualTo("a \"quoted\" back\\slash"));
        Assert.That(table.Text("accent"), Is.EqualTo("café"));
        Assert.That(table.Number("negative"), Is.EqualTo(-2.5));
        Assert.That(table.Flag("off"), Is.False);
        Assert.That(table.Fields.ContainsKey("nothing") && table.Fields["nothing"] is null, Is.True);
        Assert.That(table.Flag("bare"), Is.True);
        Assert.That(table.Table("list")!.Items, Is.EqualTo(new object?[] { "one", "two" }));
        Assert.That(table.Table("indexed")!.Items, Is.EqualTo(new object?[] { "first", "second" }));
    }

    [TestCase("Target = os.execute(\"calc\")")]
    [TestCase("Target = { run() }")]
    [TestCase("Target = { [\"a\"] = 1 + 1 }")]
    [TestCase("Target = { [\"a\"] = other }")]
    [TestCase("Target = { [\"a\"] = \"unterminated }")]
    [TestCase("Target = { [\"a\"] = 0x10 }")]
    [TestCase("Target = \"text\"")]
    [TestCase("Target = {")]
    [TestCase("")]
    public void TheReaderRefusesAnythingThatIsNotSavedData(string text)
    {
        Assert.That(LuaSavedVariablesReader.ReadTable(text, "Target"), Is.Null);
    }

    [Test]
    public void TheReaderStopsAtItsDepthAndSizeLimits()
    {
        var deep = "Target = " + new string('{', LuaSavedVariablesReader.MaxDepth + 1) + new string('}', LuaSavedVariablesReader.MaxDepth + 1);
        Assert.That(LuaSavedVariablesReader.ReadTable(deep, "Target"), Is.Null);

        var allowed = "Target = " + new string('{', LuaSavedVariablesReader.MaxDepth) + new string('}', LuaSavedVariablesReader.MaxDepth);
        Assert.That(LuaSavedVariablesReader.ReadTable(allowed, "Target"), Is.Not.Null);

        var wide = "Target = {" + string.Concat(Enumerable.Repeat("1,", LuaSavedVariablesReader.MaxValues + 1)) + "}";
        Assert.That(LuaSavedVariablesReader.ReadTable(wide, "Target"), Is.Null);
    }
}
