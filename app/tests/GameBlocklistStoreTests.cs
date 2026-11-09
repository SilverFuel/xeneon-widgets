using System.Diagnostics;
using NUnit.Framework;

namespace XenonEdgeHost.Tests;

public sealed class GameBlocklistStoreTests
{
    private string _root = "";
    private HostLogger? _logger;

    [SetUp]
    public void SetUp()
    {
        _root = Path.Combine(Path.GetTempPath(), $"auxora-blocklist-{Guid.NewGuid():N}");
        Directory.CreateDirectory(_root);
        _logger = new HostLogger(Path.Combine(_root, "logs"));
    }

    [TearDown]
    public void TearDown()
    {
        _logger?.Dispose();
        try
        {
            Directory.Delete(_root, recursive: true);
        }
        catch { }
    }

    private string StorePath => Path.Combine(_root, GameBlocklistStore.FileName);

    private GameBlocklistStore CreateStore() => new(_logger!, StorePath);

    [Test]
    public void NewStore_IsReadyAndEmpty()
    {
        var store = CreateStore();
        var snapshot = store.Snapshot();

        Assert.Multiple((Action)(() =>
        {
            Assert.That(store.IsAvailable, Is.True);
            Assert.That(snapshot.Status, Is.EqualTo("ready"));
            Assert.That(snapshot.Entries, Is.Empty);
            Assert.That(File.Exists(StorePath), Is.False);
        }));
    }

    [Test]
    public void Add_PersistsAndReloadsFromDisk()
    {
        var path = Path.Combine(_root, "apps", "wallpaper64.exe");
        var (entry, added) = CreateStore().Add("Wallpaper Engine", path, "steam:431960", "Steam library");

        var reloaded = CreateStore().Snapshot().Entries.Single();

        Assert.Multiple((Action)(() =>
        {
            Assert.That(added, Is.True);
            Assert.That(entry.Id, Does.StartWith("block-"));
            Assert.That(reloaded.Id, Is.EqualTo(entry.Id));
            Assert.That(reloaded.DisplayName, Is.EqualTo("Wallpaper Engine"));
            Assert.That(reloaded.ExecutablePath, Is.EqualTo(Path.GetFullPath(path)));
            Assert.That(reloaded.LauncherId, Is.EqualTo("steam:431960"));
            Assert.That(reloaded.Source, Is.EqualTo("Steam library"));
            Assert.That(reloaded.AddedAt.Offset, Is.EqualTo(TimeSpan.Zero));
        }));
    }

    [Test]
    public void Add_DuplicatePathOrLauncherIdReturnsExistingEntry()
    {
        var store = CreateStore();
        var path = Path.Combine(_root, "Dock.exe");
        var (first, _) = store.Add("Dock", path, "", "Running app");
        var (byPath, addedByPath) = store.Add("Dock again", path.ToUpperInvariant(), "", "Running app");
        var (steam, _) = store.Add("Wallpaper Engine", "", "steam:431960", "Steam library");
        var (byLauncher, addedByLauncher) = store.Add("Wallpaper", "", "STEAM:431960", "Steam library");

        Assert.Multiple((Action)(() =>
        {
            Assert.That(addedByPath, Is.False);
            Assert.That(byPath.Id, Is.EqualTo(first.Id));
            Assert.That(addedByLauncher, Is.False);
            Assert.That(byLauncher.Id, Is.EqualTo(steam.Id));
            Assert.That(store.Count, Is.EqualTo(2));
        }));
    }

    [Test]
    public void Add_TruncatesLongNamesAndRequiresAnIdentity()
    {
        var store = CreateStore();
        var (entry, _) = store.Add(new string('x', 121), Path.Combine(_root, "Long.exe"), "", "Running app");

        Assert.Multiple((Action)(() =>
        {
            Assert.That(entry.DisplayName, Has.Length.EqualTo(120));
            Assert.Throws<ArgumentException>((Action)(() => store.Add("Nothing", "", "", "Running app")));
        }));
    }

    [Test]
    public void DamagedFile_IsUnavailableUntouchedAndRejectsWrites()
    {
        const string damaged = "{\"schemaVersion\":1,\"entries\":[{\"id\":";
        File.WriteAllText(StorePath, damaged);

        var store = CreateStore();

        Assert.Multiple((Action)(() =>
        {
            Assert.That(store.IsAvailable, Is.False);
            Assert.That(store.Snapshot().Status, Is.EqualTo("unavailable"));
            Assert.That(store.IsBlocked(Path.Combine(_root, "Any.exe"), null), Is.False);
            Assert.Throws<GameBlocklistUnavailableException>((Action)(() => store.Add("App", Path.Combine(_root, "App.exe"), "", "Running app")));
            Assert.Throws<GameBlocklistUnavailableException>((Action)(() => store.Remove("block-1")));
            Assert.That(File.ReadAllText(StorePath), Is.EqualTo(damaged));
        }));
    }

    [Test]
    public void Remove_DeletesEntryAndUnknownIdIsNoOp()
    {
        var store = CreateStore();
        var path = Path.Combine(_root, "Dock.exe");
        var (entry, _) = store.Add("Dock", path, "", "Running app");

        Assert.Multiple((Action)(() =>
        {
            Assert.That(store.Remove("block-unknown"), Is.False);
            Assert.That(store.Remove(entry.Id), Is.True);
            Assert.That(store.IsBlocked(path, null), Is.False);
            Assert.That(CreateStore().Snapshot().Entries, Is.Empty);
        }));
    }

    [Test]
    public void Clear_DeletesTheFile()
    {
        var store = CreateStore();
        store.Add("Dock", Path.Combine(_root, "Dock.exe"), "", "Running app");

        var removed = store.Clear();

        Assert.Multiple((Action)(() =>
        {
            Assert.That(removed, Is.GreaterThan(0));
            Assert.That(File.Exists(StorePath), Is.False);
            Assert.That(store.Count, Is.Zero);
        }));
    }

    [Test]
    public void IsBlocked_MatchesFullPathCaseInsensitivelyAndLauncherId()
    {
        var store = CreateStore();
        var path = Path.Combine(_root, "A", "Tool.exe");
        store.Add("Tool", path, "", "Running app");
        store.Add("Wallpaper Engine", "", "steam:431960", "Steam library");

        Assert.Multiple((Action)(() =>
        {
            Assert.That(store.IsBlocked(path.ToUpperInvariant(), null), Is.True);
            Assert.That(store.IsBlocked(Path.Combine(_root, "B", "Tool.exe"), null), Is.False);
            Assert.That(store.IsBlocked(null, "steam:431960"), Is.True);
            Assert.That(store.IsBlocked(null, "steam:1086940"), Is.False);
        }));
    }

    [Test]
    public void IsBlocked_StaysFastWithFiftyEntries()
    {
        var store = CreateStore();
        for (var index = 0; index < 50; index++)
        {
            store.Add($"App {index}", Path.Combine(_root, $"App{index}.exe"), "", "Running app");
        }

        var probe = Path.Combine(_root, "Missing.exe");
        var timer = Stopwatch.StartNew();
        for (var index = 0; index < 10_000; index++)
        {
            store.IsBlocked(probe, "steam:1");
        }

        timer.Stop();
        Assert.That(timer.ElapsedMilliseconds, Is.LessThan(200));
    }

    [Test]
    public void SystemExclusions_IgnoreEngineCrashHandlerBesideTheGame()
    {
        var gameDir = @"E:\Games\Steam\steamapps\common\Yu-Gi-Oh!  Master Duel\";

        Assert.Multiple((Action)(() =>
        {
            Assert.That(SystemGameExclusions.IsExcluded("UnityCrashHandler64.exe", gameDir + "UnityCrashHandler64.exe"), Is.True);
            Assert.That(SystemGameExclusions.IsExcluded("masterduel.exe", gameDir + "masterduel.exe"), Is.False);
        }));
    }

    [Test]
    public void SystemExclusions_DescribeBuiltInRulesWithoutNewEntries()
    {
        var rules = SystemGameExclusions.DescribeRules();

        Assert.Multiple((Action)(() =>
        {
            Assert.That(rules, Has.Some.Matches<SystemExclusionRule>(rule => rule.Kind == "name" && rule.Value == "discord"));
            Assert.That(rules, Has.Some.Matches<SystemExclusionRule>(rule => rule.Kind == "nameFragment" && rule.Value == "launcher"));
            Assert.That(rules, Has.Some.Matches<SystemExclusionRule>(rule => rule.Kind == "pathFragment" && rule.Value == @"\windows\"));
            Assert.That(rules, Has.None.Matches<SystemExclusionRule>(rule => rule.Value.Contains("wallpaper", StringComparison.OrdinalIgnoreCase)));
            Assert.That(SystemGameExclusions.IsExcluded("discord", @"C:\Apps\Discord\discord.exe"), Is.True);
            Assert.That(SystemGameExclusions.IsExcluded("eldenring", @"D:\Games\ELDEN RING\eldenring.exe"), Is.False);
        }));
    }
}
