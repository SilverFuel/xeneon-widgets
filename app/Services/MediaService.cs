using Windows.Media.Control;
using Windows.Storage.Streams;

namespace XenonEdgeHost;

public sealed class MediaService
{
    private readonly HostLogger _logger;
    private readonly ConfigStore _configStore;
    private readonly object _sync = new();
    private MediaSnapshot _snapshot = MediaSnapshot.CreateStarting();
    private DateTimeOffset _lastRefresh = DateTimeOffset.MinValue;
    private Task? _refreshTask;

    public MediaService(HostLogger logger, ConfigStore configStore)
    {
        _logger = logger;
        _configStore = configStore;
    }

    public async Task<MediaSnapshot> GetSnapshotAsync(CancellationToken cancellationToken)
    {
        if (DateTimeOffset.UtcNow - _lastRefresh > TimeSpan.FromSeconds(5))
        {
            await RefreshWithTimeoutAsync(cancellationToken);
        }

        lock (_sync)
        {
            var clone = _snapshot.Clone();
            clone.Stale = clone.SampledAt is null || DateTimeOffset.UtcNow - clone.SampledAt.Value > TimeSpan.FromSeconds(20);
            if (clone.Status == "live" && clone.Stale)
            {
                clone.Status = "stale";
            }

            return clone;
        }
    }

    public async Task<MediaSnapshot> ExecuteAsync(string action, CancellationToken cancellationToken)
    {
        var manager = await GlobalSystemMediaTransportControlsSessionManager.RequestAsync();
        var session = manager.GetCurrentSession();
        if (session is null)
        {
            throw new InvalidOperationException("No active Windows media session is available.");
        }

        switch (action)
        {
            case "play":
                await session.TryPlayAsync();
                break;
            case "pause":
                await session.TryPauseAsync();
                break;
            case "play-pause":
                await session.TryTogglePlayPauseAsync();
                break;
            case "next":
                await session.TrySkipNextAsync();
                break;
            case "previous":
                await session.TrySkipPreviousAsync();
                break;
            case "seek-back":
                await SeekRelativeAsync(session, TimeSpan.FromSeconds(-15));
                break;
            case "seek-forward":
                await SeekRelativeAsync(session, TimeSpan.FromSeconds(15));
                break;
            default:
                throw new InvalidOperationException("Unknown media action.");
        }

        _lastRefresh = DateTimeOffset.MinValue;
        return await GetSnapshotAsync(cancellationToken);
    }

    private async Task RefreshWithTimeoutAsync(CancellationToken cancellationToken)
    {
        Task refreshTask;
        lock (_sync)
        {
            if (_refreshTask is null || _refreshTask.IsCompleted)
            {
                _refreshTask = RefreshAsync(CancellationToken.None);
            }

            refreshTask = _refreshTask;
        }

        var timeoutTask = Task.Delay(TimeSpan.FromMilliseconds(1800), cancellationToken);
        var completedTask = await Task.WhenAny(refreshTask, timeoutTask);
        if (completedTask == refreshTask)
        {
            await refreshTask;
            return;
        }

        _logger.Warn("Windows media session refresh timed out.");
        lock (_sync)
        {
            _snapshot = MediaSnapshot.CreateError("Windows media session check timed out.");
            _lastRefresh = DateTimeOffset.UtcNow;
        }
    }

    private static async Task SeekRelativeAsync(GlobalSystemMediaTransportControlsSession session, TimeSpan delta)
    {
        var timeline = session.GetTimelineProperties();
        var start = timeline.StartTime;
        var end = timeline.EndTime > start ? timeline.EndTime : TimeSpan.Zero;
        if (end <= TimeSpan.Zero)
        {
            throw new InvalidOperationException("This media session does not expose a seekable timeline.");
        }

        var target = timeline.Position + delta;
        if (target < start)
        {
            target = start;
        }

        if (target > end)
        {
            target = end;
        }

        await session.TryChangePlaybackPositionAsync(target.Ticks);
    }

    private async Task RefreshAsync(CancellationToken cancellationToken)
    {
        try
        {
            var manager = await GlobalSystemMediaTransportControlsSessionManager.RequestAsync();
            var session = manager.GetCurrentSession();
            if (session is null)
            {
                lock (_sync)
                {
                    _snapshot = MediaSnapshot.CreateIdle();
                    _lastRefresh = DateTimeOffset.UtcNow;
                }

                return;
            }

            var playback = session.GetPlaybackInfo();
            var timeline = session.GetTimelineProperties();
            var properties = await session.TryGetMediaPropertiesAsync();
            cancellationToken.ThrowIfCancellationRequested();

            var sampledAt = DateTimeOffset.UtcNow;
            var playbackStatus = playback.PlaybackStatus.ToString().ToLowerInvariant();
            var duration = timeline.EndTime > TimeSpan.Zero ? timeline.EndTime - timeline.StartTime : TimeSpan.Zero;
            var exposeMetadata = _configStore.Snapshot().Dashboard.MediaMetadataVisible;

            lock (_sync)
            {
                _snapshot = new MediaSnapshot
                {
                    Supported = true,
                    Configured = true,
                    Status = playbackStatus == "closed" ? "idle" : "live",
                    SampledAt = sampledAt,
                    Stale = false,
                    Message = playbackStatus == "closed" ? "No active Windows media session is available." : "Windows media session data is live.",
                    Source = "windows media session",
                    AppId = exposeMetadata ? session.SourceAppUserModelId ?? "" : "",
                    Title = exposeMetadata ? properties.Title ?? "" : playbackStatus == "closed" ? "" : "Media playing",
                    Artist = exposeMetadata ? properties.Artist ?? "" : "",
                    AlbumTitle = exposeMetadata ? properties.AlbumTitle ?? "" : "",
                    AlbumArtist = exposeMetadata ? properties.AlbumArtist ?? "" : "",
                    PlaybackStatus = playbackStatus,
                    PositionMs = (long)Math.Max(0, timeline.Position.TotalMilliseconds),
                    DurationMs = (long)Math.Max(0, duration.TotalMilliseconds),
                    CanPlay = playback.Controls?.IsPlayEnabled ?? false,
                    CanPause = playback.Controls?.IsPauseEnabled ?? false,
                    CanGoNext = playback.Controls?.IsNextEnabled ?? false,
                    CanGoPrevious = playback.Controls?.IsPreviousEnabled ?? false,
                    CanSeek = duration > TimeSpan.Zero
                };
                _lastRefresh = sampledAt;
            }

            var artwork = exposeMetadata ? await TryReadArtworkAsync(properties.Thumbnail) : "";
            lock (_sync)
            {
                _snapshot.ThumbnailDataUrl = artwork;
            }
        }
        catch (Exception error)
        {
            _logger.Error("Failed to refresh media snapshot.", error);
            lock (_sync)
            {
                _snapshot = MediaSnapshot.CreateError(error.Message);
                _lastRefresh = DateTimeOffset.UtcNow;
            }
        }
    }

    private static async Task<string> TryReadArtworkAsync(IRandomAccessStreamReference? thumbnail)
    {
        if (thumbnail is null)
        {
            return "";
        }

        try
        {
            using var stream = await thumbnail.OpenReadAsync();
            if (stream is null || stream.Size == 0)
            {
                return "";
            }

            using var reader = new DataReader(stream);
            await reader.LoadAsync((uint)stream.Size);
            var buffer = new byte[stream.Size];
            reader.ReadBytes(buffer);
            var contentType = ResolveArtworkContentType(stream.ContentType, buffer);
            return $"data:{contentType};base64,{Convert.ToBase64String(buffer)}";
        }
        catch
        {
            return "";
        }
    }

    internal static string ResolveArtworkContentType(string? reportedContentType, ReadOnlySpan<byte> content)
    {
        if (content.Length >= 3
            && content[0] == 0xFF
            && content[1] == 0xD8
            && content[2] == 0xFF)
        {
            return "image/jpeg";
        }

        if (content.Length >= 8
            && content[0] == 0x89
            && content[1] == 0x50
            && content[2] == 0x4E
            && content[3] == 0x47
            && content[4] == 0x0D
            && content[5] == 0x0A
            && content[6] == 0x1A
            && content[7] == 0x0A)
        {
            return "image/png";
        }

        if (content.Length >= 6
            && content[0] == (byte)'G'
            && content[1] == (byte)'I'
            && content[2] == (byte)'F'
            && content[3] == (byte)'8'
            && (content[4] == (byte)'7' || content[4] == (byte)'9')
            && content[5] == (byte)'a')
        {
            return "image/gif";
        }

        if (content.Length >= 12
            && content[0] == (byte)'R'
            && content[1] == (byte)'I'
            && content[2] == (byte)'F'
            && content[3] == (byte)'F'
            && content[8] == (byte)'W'
            && content[9] == (byte)'E'
            && content[10] == (byte)'B'
            && content[11] == (byte)'P')
        {
            return "image/webp";
        }

        var normalized = (reportedContentType ?? "").Split(';', 2)[0].Trim().ToLowerInvariant();
        if (System.Text.RegularExpressions.Regex.IsMatch(normalized, @"^image/[a-z0-9][a-z0-9.+-]*$"))
        {
            return normalized;
        }

        return "image/png";
    }
}

public sealed class MediaSnapshot
{
    public bool Supported { get; set; } = true;

    public bool Configured { get; set; } = true;

    public string Status { get; set; } = "starting";

    public DateTimeOffset? SampledAt { get; set; }

    public bool Stale { get; set; }

    public string Message { get; set; } = "";

    public string Source { get; set; } = "windows media session";

    public string AppId { get; set; } = "";

    public string Title { get; set; } = "";

    public string Artist { get; set; } = "";

    public string AlbumTitle { get; set; } = "";

    public string AlbumArtist { get; set; } = "";

    public string PlaybackStatus { get; set; } = "idle";

    public long PositionMs { get; set; }

    public long DurationMs { get; set; }

    public bool CanPlay { get; set; }

    public bool CanPause { get; set; }

    public bool CanGoNext { get; set; }

    public bool CanGoPrevious { get; set; }

    public bool CanSeek { get; set; }

    public string ThumbnailDataUrl { get; set; } = "";

    public MediaSnapshot Clone()
    {
        return new MediaSnapshot
        {
            Supported = Supported,
            Configured = Configured,
            Status = Status,
            SampledAt = SampledAt,
            Stale = Stale,
            Message = Message,
            Source = Source,
            AppId = AppId,
            Title = Title,
            Artist = Artist,
            AlbumTitle = AlbumTitle,
            AlbumArtist = AlbumArtist,
            PlaybackStatus = PlaybackStatus,
            PositionMs = PositionMs,
            DurationMs = DurationMs,
            CanPlay = CanPlay,
            CanPause = CanPause,
            CanGoNext = CanGoNext,
            CanGoPrevious = CanGoPrevious,
            CanSeek = CanSeek,
            ThumbnailDataUrl = ThumbnailDataUrl
        };
    }

    public static MediaSnapshot CreateStarting()
    {
        return new MediaSnapshot
        {
            Supported = true,
            Configured = true,
            Status = "starting",
            Message = "Checking Windows media sessions..."
        };
    }

    public static MediaSnapshot CreateIdle()
    {
        return new MediaSnapshot
        {
            Supported = true,
            Configured = true,
            Status = "idle",
            Message = "No active Windows media session is available."
        };
    }

    public static MediaSnapshot CreateError(string message)
    {
        return new MediaSnapshot
        {
            Supported = true,
            Configured = true,
            Status = "error",
            Message = message
        };
    }
}
