namespace XenonEdgeHost;

// One balance for two volumes: the running game and a music app. In the middle both are at
// full volume; toward either end the other one fades to silence. The dashboard draws its
// slider with the same sums (blendVolumes in js/widgets/wow-forever.js); keep them in step.
public static class AudioBlend
{
    public const string Game = "game";
    public const string Music = "music";
    public const string Chat = "chat";

    // The process names Discord's desktop apps run under (stable, test and canary builds).
    public static bool IsDiscordProcess(string? processName)
    {
        return TrimExe(processName).StartsWith("Discord", StringComparison.OrdinalIgnoreCase);
    }

    // Which side of a balance an audio session belongs to: "music", "chat", "game" or "".
    public static string RoleOf(string? processName, string? displayName, int processId, int? gameProcessId, string? gameProcessName)
    {
        var process = TrimExe(processName);
        if (process.Contains("AppleMusic", StringComparison.OrdinalIgnoreCase)
            || (displayName ?? "").Contains("Apple Music", StringComparison.OrdinalIgnoreCase))
        {
            return Music;
        }

        if (IsDiscordProcess(process))
        {
            return Chat;
        }

        if (gameProcessId is int id && id > 0 && id == processId)
        {
            return Game;
        }

        var game = TrimExe(gameProcessName);
        return game.Length > 0 && string.Equals(game, process, StringComparison.OrdinalIgnoreCase) ? Game : "";
    }

    // The two volumes, 0 to 100, at a slider position from 0 (all game) to 100 (all music).
    public static (int Game, int Music) VolumesAt(double position)
    {
        var at = double.IsNaN(position) ? 50d : Math.Clamp(position, 0d, 100d);
        var game = at <= 50d ? 100 : (int)Math.Round((100d - at) * 2d);
        var music = at >= 50d ? 100 : (int)Math.Round(at * 2d);
        return (game, music);
    }

    // Where the slider sits for two volumes, however they were set: only their ratio counts.
    public static int PositionOf(int gameVolume, int musicVolume)
    {
        var game = Math.Clamp(gameVolume, 0, 100);
        var music = Math.Clamp(musicVolume, 0, 100);
        var loudest = Math.Max(game, music);
        if (loudest == 0)
        {
            return 50;
        }

        return game >= music
            ? (int)Math.Round(music * 50d / loudest)
            : (int)Math.Round(100d - game * 50d / loudest);
    }

    private static string TrimExe(string? name)
    {
        var value = (name ?? "").Trim();
        return value.EndsWith(".exe", StringComparison.OrdinalIgnoreCase) ? value[..^4] : value;
    }
}

public sealed class AudioBlendPayload
{
    // True when both a game and a music app are making sound and can be balanced.
    public bool Available { get; set; }

    public bool GameFound { get; set; }

    public bool MusicFound { get; set; }

    public int GameVolume { get; set; }

    public int MusicVolume { get; set; }

    public int Position { get; set; } = 50;

    // What the game is balanced against: "music" (Apple Music) or "chat" (Discord).
    public string Other { get; set; } = AudioBlend.Music;

    public bool OtherFound { get; set; }

    public int OtherVolume { get; set; }

    // For chat: whether Discord is running at all, sound or no sound.
    public bool OtherRunning { get; set; }

    public string Message { get; set; } = "";
}

public sealed class AudioBlendRequest
{
    public double Position { get; set; } = 50;
}

// Brings Discord to the front, or starts it, through the link Discord registers with Windows.
public static class DiscordLauncher
{
    public const string Target = "discord://-/";

    public static DiscordOpenPayload Open()
    {
        try
        {
            using var process = System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo
            {
                FileName = Target,
                UseShellExecute = true
            });
            return new DiscordOpenPayload { Opened = true, Message = "" };
        }
        catch (Exception)
        {
            // Windows has no app for discord:// links: Discord is not installed for this user.
            return new DiscordOpenPayload { Opened = false, Message = "Discord does not seem to be installed on this PC." };
        }
    }
}

public sealed class DiscordOpenPayload
{
    public bool Opened { get; set; }

    public string Message { get; set; } = "";
}
