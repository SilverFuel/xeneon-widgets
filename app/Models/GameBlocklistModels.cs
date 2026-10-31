namespace XenonEdgeHost;

public sealed class BlockedItem
{
    public string Id { get; set; } = "";

    public string DisplayName { get; set; } = "";

    public string ExecutablePath { get; set; } = "";

    public string LauncherId { get; set; } = "";

    public string Source { get; set; } = "";

    public DateTimeOffset AddedAt { get; set; }
}

public sealed class GameBlocklistDocument
{
    public int SchemaVersion { get; set; } = 1;

    public List<BlockedItem> Entries { get; set; } = [];
}

public sealed class GameBlocklistSnapshot
{
    public string Status { get; set; } = "ready";

    public string Message { get; set; } = "";

    public List<BlockedItem> Entries { get; set; } = [];

    public List<SystemExclusionRule> SystemExclusions { get; set; } = [];
}

public sealed class SystemExclusionRule
{
    public string Kind { get; set; } = "";

    public string Value { get; set; } = "";
}

public sealed class GameBlocklistAddRequest
{
    public string? Ref { get; set; }
}

public sealed class GameBlocklistRemoveRequest
{
    public string? Id { get; set; }
}

public sealed class GameBlocklistAddResult
{
    public bool Ok { get; set; } = true;

    public bool Added { get; set; }

    public BlockedItem? Entry { get; set; }

    public bool Unpinned { get; set; }

    public bool SelectionCleared { get; set; }

    public string Message { get; set; } = "";
}

public sealed class GameBlocklistRemoveResult
{
    public bool Ok { get; set; } = true;

    public bool Removed { get; set; }
}

public sealed class GameBlocklistSourceItem
{
    public string Ref { get; set; } = "";

    public string Name { get; set; } = "";

    public string Source { get; set; } = "";

    public string ExecutableName { get; set; } = "";

    public int Confidence { get; set; }

    public bool Active { get; set; }
}

public sealed class GameBlocklistSources
{
    public List<GameBlocklistSourceItem> Detected { get; set; } = [];

    public List<GameBlocklistSourceItem> Running { get; set; } = [];
}

public sealed class GameBlocklistUnavailableException : InvalidOperationException
{
    public const string DefaultMessage = "The blocklist could not be read. Game Mode keeps using the built-in rules.";

    public GameBlocklistUnavailableException()
        : base(DefaultMessage)
    {
    }
}

public sealed class GameBlocklistReferenceNotFoundException : InvalidOperationException
{
    public const string DefaultMessage = "That app is no longer running.";

    public GameBlocklistReferenceNotFoundException()
        : base(DefaultMessage)
    {
    }
}

public sealed class GameCandidateNotFoundException : InvalidOperationException
{
    public const string DefaultMessage = "That app is no longer running.";

    public GameCandidateNotFoundException()
        : base(DefaultMessage)
    {
    }
}
