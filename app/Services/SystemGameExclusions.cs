namespace XenonEdgeHost;

// Built-in Game Mode exclusions. They are read-only, always applied before user rules, and
// win over pinned games. The Settings blocklist panel lists them through DescribeRules().
public static class SystemGameExclusions
{
    private static readonly HashSet<string> IgnoredProcessNames = new(StringComparer.OrdinalIgnoreCase)
    {
        "agent",
        "applicationframehost",
        "battle.net",
        "blizzardbrowser",
        "chrome",
        "cmd",
        "codex",
        "code",
        "conhost",
        "corsair.service",
        "corsaircue",
        "discord",
        "dotnet",
        "eadesktop",
        "epicgameslauncher",
        "epicwebhelper",
        "explorer",
        "firefox",
        "galaxyclient",
        "gamingservices",
        "gamingservicesnet",
        "git",
        "gog galaxy",
        "msedge",
        "msbuild",
        "ms-teams",
        "msteams",
        "msteams_autostarter",
        "node",
        "nvidia app",
        "nvcontainer",
        "origin",
        "openconsole",
        "powershell",
        "pwsh",
        "python",
        "riotclientservices",
        "skype",
        "slack",
        "steam",
        "steamwebhelper",
        "systemsettings",
        "teams",
        "windowsterminal",
        "webex",
        "zoom",
        "ubisoftconnect",
        "xboxappservices",
        "xenonedgehost"
    };

    private static readonly HashSet<string> LauncherProcessNames = new(StringComparer.OrdinalIgnoreCase)
    {
        "amazon games",
        "amazon games ui",
        "battle.net",
        "battle.net helper",
        "bethesda.net_launcher",
        "blizzardbrowser",
        "curseforge",
        "eabackgroundservice",
        "eadesktop",
        "ealauncher",
        "epicgameslauncher",
        "epicwebhelper",
        "galaxyclient",
        "galaxyclient helper",
        "galaxycommunication",
        "gamebar",
        "gamebarftserver",
        "gamebarpresencewriter",
        "gamingservices",
        "gamingservicesnet",
        "gog galaxy notifications renderer",
        "heroic",
        "itch",
        "legendary",
        "minecraftlauncher",
        "modrinth app",
        "origin",
        "originwebhelperservice",
        "overwolf",
        "prismlauncher",
        "riotclientcrashhandler",
        "riotclientservices",
        "riotclientux",
        "riotclientuxrender",
        "rockstar games launcher",
        "rockstarservice",
        "socialclubhelper",
        "steam",
        "steamservice",
        "steamwebhelper",
        "ubisoftconnect",
        "ubisoftgamelauncher",
        "upc",
        "xboxapp",
        "xboxappservices",
        "xboxpcapp",
        "xboxpcappft"
    };

    private static readonly string[] IgnoredProcessFragments =
    [
        "crashpad",
        "crashreport",
        "helper",
        "installer",
        "launcher",
        "overlay",
        "setup",
        "unins",
        "update"
    ];

    private static readonly string[] IgnoredExecutablePathFragments =
    [
        @"\microsoft teams\",
        @"\msteams_",
        @"\slack\",
        @"\teams\current\",
        @"\webex\",
        @"\zoom\"
    ];

    private static readonly string[] LauncherExecutablePathFragments =
    [
        @"\amazon games\app\",
        @"\battle.net\",
        @"\bethesda.net launcher\",
        @"\curseforge\",
        @"\ea desktop\",
        @"\electronic arts\ea desktop\",
        @"\epic games\launcher\",
        @"\gog galaxy\galaxyclient",
        @"\gog galaxy\gog galaxy notifications renderer",
        @"\gog.com\galaxy\redists\galaxycommunication",
        @"\heroic\",
        @"\itch\",
        @"\minecraft launcher\",
        @"\modrinth app\",
        @"\origin\origin",
        @"\overwolf\",
        @"\prismlauncher\",
        @"\riot client\",
        @"\rockstar games\launcher\",
        @"\rockstar games\social club\",
        @"\steam\bin\",
        @"\steam\steam.exe",
        @"\ubisoft game launcher\ubisoftconnect",
        @"\ubisoft game launcher\upc.exe",
        @"\windowsapps\microsoft.gamingapp_",
        @"\windowsapps\microsoft.xboxapp_"
    ];

    public static bool IsExcluded(string? processName, string? executablePath)
    {
        var name = processName ?? "";
        var baseName = Path.GetFileNameWithoutExtension(name);
        var lowerName = name.ToLowerInvariant();
        var lowerPath = (executablePath ?? "").ToLowerInvariant();
        if (IgnoredProcessNames.Contains(name)
            || IgnoredProcessNames.Contains(baseName)
            || LauncherProcessNames.Contains(name)
            || LauncherProcessNames.Contains(baseName)
            || lowerPath.Contains(WindowsPathFragment, StringComparison.OrdinalIgnoreCase)
            || IgnoredExecutablePathFragments.Any(fragment => lowerPath.Contains(fragment, StringComparison.OrdinalIgnoreCase))
            || LauncherExecutablePathFragments.Any(fragment => lowerPath.Contains(fragment, StringComparison.OrdinalIgnoreCase)))
        {
            return true;
        }

        return IgnoredProcessFragments.Any(fragment => lowerName.Contains(fragment, StringComparison.OrdinalIgnoreCase));
    }

    public static IReadOnlyList<SystemExclusionRule> DescribeRules()
    {
        var rules = new List<SystemExclusionRule>();
        rules.AddRange(IgnoredProcessNames.Select(value => Rule("name", value)));
        rules.AddRange(LauncherProcessNames.Select(value => Rule("launcher", value)));
        rules.AddRange(IgnoredProcessFragments.Select(value => Rule("nameFragment", value)));
        rules.Add(Rule("pathFragment", WindowsPathFragment));
        rules.AddRange(IgnoredExecutablePathFragments.Select(value => Rule("pathFragment", value)));
        rules.AddRange(LauncherExecutablePathFragments.Select(value => Rule("pathFragment", value)));

        return rules
            .GroupBy(rule => $"{rule.Kind}|{rule.Value}", StringComparer.OrdinalIgnoreCase)
            .Select(group => group.First())
            .OrderBy(rule => KindOrder(rule.Kind))
            .ThenBy(rule => rule.Value, StringComparer.OrdinalIgnoreCase)
            .ToList();
    }

    private const string WindowsPathFragment = @"\windows\";

    private static SystemExclusionRule Rule(string kind, string value)
    {
        return new SystemExclusionRule { Kind = kind, Value = value };
    }

    private static int KindOrder(string kind)
    {
        return kind switch
        {
            "name" => 0,
            "launcher" => 1,
            "nameFragment" => 2,
            _ => 3
        };
    }
}
