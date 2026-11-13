using System.Text;
using LuaTable = XenonEdgeHost.LuaSavedVariablesReader.LuaTable;

namespace XenonEdgeHost;

// Reads the snapshot the Auxora Companion add-on saves for World of Warcraft
// Forever. The game writes that file when the player logs out or reloads the
// interface, so this is the character as of the last save, not a live feed.
//
// Only this one file is read, and it is never written. The snapshot returned
// to the dashboard carries no file or folder path.
public sealed class WowCompanionService
{
    internal const string ClientFolderName = "_forever_";
    internal const string SavedFileName = "AuxoraCompanion.lua";
    internal const string SavedTableName = "AuxoraCompanionDB";
    internal const long MaxFileBytes = 2 * 1024 * 1024;
    internal const int MaxAccounts = 16;
    internal const int MaxQuests = 40;
    internal const int MaxObjectives = 8;
    internal const int MaxProfessions = 8;

    private readonly string[] _installRoots;
    private readonly object _gate = new();
    private string _runningClientFolder = "";
    private string _cachedPath = "";
    private DateTime _cachedWriteUtc;
    private long _cachedLength = -1;
    private WowCompanionSnapshot? _cached;

    public WowCompanionService() : this(DefaultInstallRoots())
    {
    }

    internal WowCompanionService(IEnumerable<string> installRoots)
    {
        _installRoots = installRoots
            .Where(root => !string.IsNullOrWhiteSpace(root) && Path.IsPathFullyQualified(root))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToArray();
    }

    // `runningExecutablePath` is the detected game executable, when one is
    // running. It lets an install outside the usual folders be found.
    public WowCompanionSnapshot GetSnapshot(string? runningExecutablePath = null)
    {
        lock (_gate)
        {
            RememberRunningClient(runningExecutablePath);
            var clientFolders = ClientFolders().Where(Directory.Exists).ToArray();
            if (clientFolders.Length == 0)
            {
                return new WowCompanionSnapshot
                {
                    Message = "World of Warcraft Forever was not found. Start the game once while Auxora is running."
                };
            }

            var saved = NewestSavedFile(clientFolders);
            if (saved is null)
            {
                return new WowCompanionSnapshot
                {
                    GameFound = true,
                    Message = "Install the Auxora Companion add-on, then type /auxora in game."
                };
            }

            if (_cached is not null
                && string.Equals(_cachedPath, saved.FullName, StringComparison.OrdinalIgnoreCase)
                && _cachedWriteUtc == saved.LastWriteTimeUtc
                && _cachedLength == saved.Length)
            {
                return _cached;
            }

            var snapshot = Read(saved);
            if (snapshot is null)
            {
                // The game may be part-way through writing. Keep the last good
                // snapshot of the same file if there is one.
                return _cached is not null && string.Equals(_cachedPath, saved.FullName, StringComparison.OrdinalIgnoreCase)
                    ? _cached
                    : new WowCompanionSnapshot
                    {
                        GameFound = true,
                        Installed = true,
                        Message = "The add-on's saved data could not be read. Type /auxora in game to save it again."
                    };
            }

            _cachedPath = saved.FullName;
            _cachedWriteUtc = saved.LastWriteTimeUtc;
            _cachedLength = saved.Length;
            _cached = snapshot;
            return snapshot;
        }
    }

    internal static IEnumerable<string> DefaultInstallRoots()
    {
        var roots = new List<string>
        {
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), "World of Warcraft"),
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "World of Warcraft")
        };
        try
        {
            foreach (var drive in DriveInfo.GetDrives())
            {
                if (drive.DriveType != DriveType.Fixed || !drive.IsReady)
                {
                    continue;
                }

                roots.Add(Path.Combine(drive.RootDirectory.FullName, "World of Warcraft"));
                roots.Add(Path.Combine(drive.RootDirectory.FullName, "Games", "World of Warcraft"));
                roots.Add(Path.Combine(drive.RootDirectory.FullName, "Program Files (x86)", "World of Warcraft"));
            }
        }
        catch (Exception exception) when (exception is IOException or UnauthorizedAccessException)
        {
        }

        return roots;
    }

    private void RememberRunningClient(string? executablePath)
    {
        if (string.IsNullOrWhiteSpace(executablePath))
        {
            return;
        }

        try
        {
            var folder = Path.GetDirectoryName(Path.GetFullPath(executablePath));
            if (!string.IsNullOrEmpty(folder)
                && string.Equals(Path.GetFileName(folder), ClientFolderName, StringComparison.OrdinalIgnoreCase))
            {
                _runningClientFolder = folder;
            }
        }
        catch (Exception exception) when (exception is ArgumentException or NotSupportedException or PathTooLongException)
        {
        }
    }

    private IEnumerable<string> ClientFolders()
    {
        if (_runningClientFolder.Length > 0)
        {
            yield return _runningClientFolder;
        }

        foreach (var root in _installRoots)
        {
            var folder = Path.Combine(root, ClientFolderName);
            if (!string.Equals(folder, _runningClientFolder, StringComparison.OrdinalIgnoreCase))
            {
                yield return folder;
            }
        }
    }

    // One saved file per game account; the most recently written one wins.
    private static FileInfo? NewestSavedFile(IEnumerable<string> clientFolders)
    {
        FileInfo? newest = null;
        foreach (var clientFolder in clientFolders)
        {
            try
            {
                var accounts = Path.Combine(clientFolder, "WTF", "Account");
                if (!Directory.Exists(accounts))
                {
                    continue;
                }

                foreach (var account in Directory.EnumerateDirectories(accounts).Take(MaxAccounts))
                {
                    var file = new FileInfo(Path.Combine(account, "SavedVariables", SavedFileName));
                    if (file.Exists && (newest is null || file.LastWriteTimeUtc > newest.LastWriteTimeUtc))
                    {
                        newest = file;
                    }
                }
            }
            catch (Exception exception) when (exception is IOException or UnauthorizedAccessException)
            {
            }
        }

        return newest;
    }

    private static WowCompanionSnapshot? Read(FileInfo saved)
    {
        string text;
        try
        {
            using var stream = new FileStream(saved.FullName, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete);
            if (stream.Length > MaxFileBytes)
            {
                return null;
            }

            using var reader = new StreamReader(stream, Encoding.UTF8);
            text = reader.ReadToEnd();
        }
        catch (Exception exception) when (exception is IOException or UnauthorizedAccessException)
        {
            return null;
        }

        return Parse(text);
    }

    // Turns the saved text into a snapshot, or null when it is not the
    // add-on's data.
    internal static WowCompanionSnapshot? Parse(string text)
    {
        var saved = LuaSavedVariablesReader.ReadTable(text, SavedTableName);
        var characters = saved?.Table("characters");
        if (saved is null || characters is null)
        {
            return null;
        }

        var character = characters.Table(saved.Text("last") ?? "")
            ?? characters.Fields.Values.OfType<LuaTable>().MaxBy(entry => entry.Number("savedAt") ?? 0);
        var name = Clean(character?.Text("name"), 48);
        if (character is null || name.Length == 0)
        {
            return null;
        }

        var quests = new List<WowCompanionQuest>();
        foreach (var quest in (character.Table("quests")?.Items ?? []).OfType<LuaTable>())
        {
            var title = Clean(quest.Text("title"), 96);
            if (title.Length == 0)
            {
                continue;
            }

            quests.Add(new WowCompanionQuest
            {
                Title = title,
                Zone = Clean(quest.Text("zone"), 64),
                Level = (int)Whole(quest.Number("level"), 999),
                Complete = quest.Flag("complete"),
                Objectives = (quest.Table("objectives")?.Items ?? [])
                    .OfType<LuaTable>()
                    .Select(objective => new WowCompanionObjective
                    {
                        Text = Clean(objective.Text("text"), 160),
                        Done = objective.Flag("done")
                    })
                    .Where(objective => objective.Text.Length > 0)
                    .Take(MaxObjectives)
                    .ToList()
            });
            if (quests.Count >= MaxQuests)
            {
                break;
            }
        }

        var professions = (character.Table("professions")?.Items ?? [])
            .OfType<LuaTable>()
            .Select(profession => new WowCompanionProfession
            {
                Name = Clean(profession.Text("name"), 48),
                Rank = (int)Whole(profession.Number("rank"), 9999),
                MaxRank = (int)Whole(profession.Number("maxRank"), 9999),
                Primary = profession.Flag("primary")
            })
            .Where(profession => profession.Name.Length > 0)
            .Take(MaxProfessions)
            .ToList();

        // Bag space is only meaningful as a pair, with free no larger than total.
        var bagTotal = Optional(character.Number("bagTotal"), 2000);
        var bagFree = Optional(character.Number("bagFree"), 2000);
        if (bagTotal is null or 0 || bagFree is null || bagFree > bagTotal)
        {
            bagTotal = null;
            bagFree = null;
        }

        var savedAt = Whole(character.Number("savedAt"), 4102444800);
        return new WowCompanionSnapshot
        {
            GameFound = true,
            Installed = true,
            Available = true,
            AddonVersion = Clean(saved.Text("addonVersion"), 16),
            Message = "Type /auxora in game to update.",
            Character = new WowCompanionCharacter
            {
                Name = name,
                Realm = Clean(character.Text("realm"), 64),
                Class = Clean(character.Text("class"), 32),
                ClassToken = Clean(character.Text("classToken"), 32),
                Race = Clean(character.Text("race"), 32),
                Faction = Clean(character.Text("faction"), 16),
                Level = (int)Whole(character.Number("level"), 999),
                Xp = Whole(character.Number("xp"), long.MaxValue / 2),
                XpMax = Whole(character.Number("xpMax"), long.MaxValue / 2),
                XpRested = Whole(character.Number("xpRested"), long.MaxValue / 2),
                Zone = Clean(character.Text("zone"), 64),
                SubZone = Clean(character.Text("subZone"), 64),
                Home = Clean(character.Text("home"), 64),
                Copper = Whole(character.Number("copper"), long.MaxValue / 2),
                SavedAt = savedAt > 0 ? DateTimeOffset.FromUnixTimeSeconds(savedAt) : null,
                QuestsRead = character.Flag("questsRead"),
                Quests = quests,
                Professions = professions,
                Durability = Optional(character.Number("durability"), 100),
                DurabilityLowest = Optional(character.Number("durabilityLowest"), 100),
                BagFree = bagFree,
                BagTotal = bagTotal
            }
        };
    }

    // Saved text is shown on the dashboard: drop control characters and cap it.
    private static string Clean(string? value, int maxLength)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return "";
        }

        var builder = new StringBuilder(Math.Min(value.Length, maxLength));
        foreach (var character in value)
        {
            if (builder.Length >= maxLength)
            {
                break;
            }

            if (!char.IsControl(character))
            {
                builder.Append(character);
            }
        }

        return builder.ToString().Trim();
    }

    // A whole number from 0 to max, or null when the add-on did not save one.
    private static int? Optional(double? value, int max)
    {
        if (value is not { } number || double.IsNaN(number) || number < 0)
        {
            return null;
        }

        return number >= max ? max : (int)Math.Floor(number);
    }

    private static long Whole(double? value, long max)
    {
        if (value is not { } number || double.IsNaN(number) || number <= 0)
        {
            return 0;
        }

        return number >= max ? max : (long)Math.Floor(number);
    }
}

public sealed class WowCompanionSnapshot
{
    // The Forever client folder exists on this PC.
    public bool GameFound { get; set; }

    // The add-on has saved a file at least once.
    public bool Installed { get; set; }

    // That file was read and holds a character.
    public bool Available { get; set; }

    public string Message { get; set; } = "";

    public string AddonVersion { get; set; } = "";

    public WowCompanionCharacter? Character { get; set; }
}

public sealed class WowCompanionCharacter
{
    public string Name { get; set; } = "";

    public string Realm { get; set; } = "";

    public string Class { get; set; } = "";

    public string ClassToken { get; set; } = "";

    public string Race { get; set; } = "";

    public string Faction { get; set; } = "";

    public int Level { get; set; }

    public long Xp { get; set; }

    public long XpMax { get; set; }

    public long XpRested { get; set; }

    public string Zone { get; set; } = "";

    public string SubZone { get; set; } = "";

    public string Home { get; set; } = "";

    public long Copper { get; set; }

    public DateTimeOffset? SavedAt { get; set; }

    public bool QuestsRead { get; set; }

    public List<WowCompanionQuest> Quests { get; set; } = [];

    // Empty when the add-on could not read professions, or none are learned.
    public List<WowCompanionProfession> Professions { get; set; } = [];

    // Equipped gear, as whole percentages: all of it, and the most worn piece.
    // Null when the add-on did not report it.
    public int? Durability { get; set; }

    public int? DurabilityLowest { get; set; }

    public int? BagFree { get; set; }

    public int? BagTotal { get; set; }
}

public sealed class WowCompanionProfession
{
    public string Name { get; set; } = "";

    public int Rank { get; set; }

    public int MaxRank { get; set; }

    // One of the two main professions, as opposed to cooking, fishing and the like.
    public bool Primary { get; set; }
}

public sealed class WowCompanionQuest
{
    public string Title { get; set; } = "";

    public string Zone { get; set; } = "";

    public int Level { get; set; }

    public bool Complete { get; set; }

    public List<WowCompanionObjective> Objectives { get; set; } = [];
}

public sealed class WowCompanionObjective
{
    public string Text { get; set; } = "";

    public bool Done { get; set; }
}
