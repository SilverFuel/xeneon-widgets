using Windows.Media.Control;
using Windows.Storage.Streams;

namespace XenonEdgeHost;

public sealed class MediaService
{
    private readonly HostLogger _logger;
    private readonly object _sync = new();
    private MediaSnapshot _snapshot = MediaSnapshot.CreateStarting();
    private DateTimeOffset _lastRefresh = DateTimeOffset.MinValue;

    public MediaService(HostLogger logger)
    {
        _logger = logger;
    }

    public async Task<MediaSnapshot> GetSnapshotAsync(CancellationToken cancellationToken)
    {
        if (DateTimeOffset.UtcNow - _lastRefresh > TimeSpan.FromSeconds(5))
        {
            await RefreshAsync(cancellationToken);
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
            default:
                throw new InvalidOperationException("Unknown media action.");
        }

        _lastRefresh = DateTimeOffset.MinValue;
        return await GetSnapshotAsync(cancellationToken);
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
                    AppId = session.SourceAppUserModelId ?? "",
                    Title = properties.Title ?? "",
                    Artist = properties.Artist ?? "",
                    AlbumTitle = properties.AlbumTitle ?? "",
                    AlbumArtist = properties.AlbumArtist ?? "",
                    PlaybackStatus = playbackStatus,
                    PositionMs = (long)Math.Max(0, timeline.Position.TotalMilliseconds),
                    DurationMs = (long)Math.Max(0, duration.TotalMilliseconds),
                    CanPlay = playback.Controls?.IsPlayEnabled ?? false,
                    CanPause = playback.Controls?.IsPauseEnabled ?? false,
                    CanGoNext = playback.Controls?.IsNextEnabled ?? false,
                    CanGoPrevious = playback.Controls?.IsPreviousEnabled ?? false
                };
                _lastRefresh = sampledAt;
            }

            var artwork = await TryReadArtworkAsync(properties.Thumbnail);
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
            var contentType = string.IsNullOrWhiteSpace(stream.ContentType) ? "image/png" : stream.ContentType;
            return $"data:{contentType};base64,{Convert.ToBase64String(buffer)}";
        }
        catch
        {
            return "";
        }
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
