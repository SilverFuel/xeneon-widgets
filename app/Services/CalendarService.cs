using System.Globalization;
using Ical.Net;
using Ical.Net.CalendarComponents;
using Ical.Net.DataTypes;
using Ical.Net.Evaluation;

namespace XenonEdgeHost;

public sealed class CalendarService
{
    private const int MaxIcsBytes = 512 * 1024;

    private readonly HttpClient _httpClient;
    private readonly HostLogger _logger;
    private readonly object _sync = new();
    private CalendarSnapshot _snapshot = CalendarSnapshot.CreateSetup();
    private string _cachedUrl = "";
    private DateTimeOffset _lastRefresh = DateTimeOffset.MinValue;

    public CalendarService(HttpClient httpClient, HostLogger logger)
    {
        _httpClient = httpClient;
        _logger = logger;
    }

    public async Task<CalendarSnapshot> GetSnapshotAsync(AppConfig config, CancellationToken cancellationToken)
    {
        var icsUrl = config.Calendar.IcsUrl?.Trim() ?? "";
        if (string.IsNullOrWhiteSpace(icsUrl))
        {
            lock (_sync)
            {
                _snapshot = CalendarSnapshot.CreateSetup();
                _cachedUrl = "";
                _lastRefresh = DateTimeOffset.MinValue;
                return _snapshot.Clone();
            }
        }

        try
        {
            icsUrl = NetworkEndpointGuard.NormalizeRemoteHttpUrl(icsUrl, "Calendar ICS URL");
        }
        catch (InvalidOperationException error)
        {
            lock (_sync)
            {
                _snapshot = CalendarSnapshot.CreateError(error.Message);
                _cachedUrl = icsUrl;
                _lastRefresh = DateTimeOffset.UtcNow;
                return _snapshot.Clone();
            }
        }

        if (DateTimeOffset.UtcNow - _lastRefresh > TimeSpan.FromMinutes(5)
            || !string.Equals(_cachedUrl, icsUrl, StringComparison.OrdinalIgnoreCase))
        {
            await RefreshAsync(icsUrl, cancellationToken);
        }

        lock (_sync)
        {
            var clone = _snapshot.Clone();
            clone.Stale = clone.SampledAt is null || DateTimeOffset.UtcNow - clone.SampledAt.Value > TimeSpan.FromMinutes(15);
            if (clone.Status == "live" && clone.Stale)
            {
                clone.Status = "stale";
            }

            return clone;
        }
    }

    private async Task RefreshAsync(string icsUrl, CancellationToken cancellationToken)
    {
        try
        {
            var normalizedUrl = NetworkEndpointGuard.NormalizeRemoteHttpUrl(icsUrl, "Calendar ICS URL");
            using var response = await _httpClient.GetAsync(normalizedUrl, HttpCompletionOption.ResponseHeadersRead, cancellationToken);
            if (response.Content.Headers.ContentLength is > MaxIcsBytes)
            {
                throw new InvalidOperationException("Calendar feed is larger than the supported 512 KiB limit.");
            }

            response.EnsureSuccessStatusCode();
            var text = await ReadContentWithLimitAsync(response.Content, MaxIcsBytes, cancellationToken);
            var entries = ParseIcs(text);
            var sampledAt = DateTimeOffset.UtcNow;

            lock (_sync)
            {
                _snapshot = new CalendarSnapshot
                {
                    Supported = true,
                    Configured = true,
                    Status = entries.Count > 0 ? "live" : "idle",
                    SampledAt = sampledAt,
                    Stale = false,
                    Message = entries.Count > 0 ? "Upcoming ICS events are live." : "No upcoming events in the configured calendar feed.",
                    Entries = entries,
                    Source = "ics"
                };
                _cachedUrl = normalizedUrl;
                _lastRefresh = sampledAt;
            }
        }
        catch (Exception error)
        {
            _logger.Error("Failed to refresh calendar snapshot.", error);
            lock (_sync)
            {
                _snapshot = _snapshot.SampledAt is null
                    ? CalendarSnapshot.CreateError(error.Message)
                    : _snapshot.WithError(error.Message);
                _cachedUrl = icsUrl;
                _lastRefresh = DateTimeOffset.UtcNow;
            }
        }
    }

    private static async Task<string> ReadContentWithLimitAsync(HttpContent content, int maxBytes, CancellationToken cancellationToken)
    {
        await using var stream = await content.ReadAsStreamAsync(cancellationToken);
        using var memory = new MemoryStream();
        var buffer = new byte[8192];

        while (true)
        {
            var read = await stream.ReadAsync(buffer, cancellationToken);
            if (read == 0)
            {
                break;
            }

            if (memory.Length + read > maxBytes)
            {
                throw new InvalidOperationException("Calendar feed is larger than the supported 512 KiB limit.");
            }

            memory.Write(buffer, 0, read);
        }

        return System.Text.Encoding.UTF8.GetString(memory.ToArray());
    }

    internal static List<CalendarEntry> ParseIcs(string icsText, DateTimeOffset? now = null)
    {
        var calendar = Ical.Net.Calendar.Load(icsText)
            ?? throw new InvalidOperationException("Calendar feed could not be parsed.");
        var cutoff = now ?? DateTimeOffset.Now;
        var startBoundary = new CalDateTime(cutoff.AddHours(-1).UtcDateTime, true);
        var options = new EvaluationOptions
        {
            MaxUnmatchedIncrementsLimit = 4096
        };

        var events = calendar.Events is { } loadedEvents
            ? loadedEvents.AsEnumerable()
            : Enumerable.Empty<CalendarEvent>();

        return events
            .Where(calendarEvent => !string.Equals(calendarEvent.Status, "CANCELLED", StringComparison.OrdinalIgnoreCase))
            .SelectMany(calendarEvent => calendarEvent.GetOccurrences(startBoundary, options)
                .Take(24)
                .Select(occurrence => new
                {
                    Event = occurrence.Source as CalendarEvent ?? calendarEvent,
                    Start = new DateTimeOffset(occurrence.Period.StartTime.AsUtc, TimeSpan.Zero),
                    HasTime = occurrence.Period.StartTime.HasTime
                }))
            .Where(item => item.Start >= cutoff.AddHours(-1))
            .OrderBy(item => item.Start)
            .Take(3)
            .Select(item => new CalendarEntry
            {
                Time = item.HasTime
                    ? item.Start.ToLocalTime().ToString("hh:mm tt", CultureInfo.CurrentCulture)
                    : item.Start.ToLocalTime().ToString("ddd, MMM d", CultureInfo.CurrentCulture),
                Title = string.IsNullOrWhiteSpace(item.Event.Summary) ? "Calendar event" : item.Event.Summary,
                Detail = string.IsNullOrWhiteSpace(item.Event.Location) ? "Calendar event" : item.Event.Location
            })
            .ToList();
    }
}

public sealed class CalendarSnapshot
{
    public bool Supported { get; set; } = true;

    public bool Configured { get; set; }

    public string Status { get; set; } = "setup";

    public DateTimeOffset? SampledAt { get; set; }

    public bool Stale { get; set; }

    public string Message { get; set; } = "";

    public List<CalendarEntry> Entries { get; set; } = new();

    public string Source { get; set; } = "ics";

    public CalendarSnapshot Clone()
    {
        return new CalendarSnapshot
        {
            Supported = Supported,
            Configured = Configured,
            Status = Status,
            SampledAt = SampledAt,
            Stale = Stale,
            Message = Message,
            Entries = Entries.Select(entry => entry.Clone()).ToList(),
            Source = Source
        };
    }

    public CalendarSnapshot WithError(string message)
    {
        var clone = Clone();
        clone.Status = "stale";
        clone.Stale = true;
        clone.Message = message;
        return clone;
    }

    public static CalendarSnapshot CreateSetup()
    {
        return new CalendarSnapshot
        {
            Supported = true,
            Configured = false,
            Status = "setup",
            Message = "Calendar ICS URL missing"
        };
    }

    public static CalendarSnapshot CreateError(string message)
    {
        return new CalendarSnapshot
        {
            Supported = true,
            Configured = true,
            Status = "error",
            Message = message
        };
    }
}

public sealed class CalendarEntry
{
    public string Time { get; set; } = "";

    public string Title { get; set; } = "";

    public string Detail { get; set; } = "";

    public CalendarEntry Clone()
    {
        return new CalendarEntry
        {
            Time = Time,
            Title = Title,
            Detail = Detail
        };
    }
}
