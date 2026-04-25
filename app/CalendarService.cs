using System.Globalization;

namespace XenonEdgeHost;

public sealed class CalendarService
{
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
            using var response = await _httpClient.GetAsync(icsUrl, cancellationToken);
            response.EnsureSuccessStatusCode();
            var text = await response.Content.ReadAsStringAsync(cancellationToken);
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
                _cachedUrl = icsUrl;
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

    private static List<CalendarEntry> ParseIcs(string icsText)
    {
        var unfolded = icsText.Replace("\r\n ", "").Replace("\r\n\t", "").Replace("\n ", "").Replace("\n\t", "");
        var events = new List<RawCalendarEvent>();
        var blocks = unfolded.Split("BEGIN:VEVENT", StringSplitOptions.None).Skip(1);

        foreach (var block in blocks)
        {
            var eventText = block.Split("END:VEVENT", StringSplitOptions.None)[0];
            var lines = eventText.Split(new[] { "\r\n", "\n" }, StringSplitOptions.None);
            var map = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);

            foreach (var line in lines)
            {
                var separatorIndex = line.IndexOf(':');
                if (separatorIndex <= 0)
                {
                    continue;
                }

                var key = line[..separatorIndex].Split(';')[0];
                var value = line[(separatorIndex + 1)..].Trim();
                map[key] = value;
            }

            if (!map.TryGetValue("DTSTART", out var startText) || !map.TryGetValue("SUMMARY", out var summary))
            {
                continue;
            }

            var start = ParseIcsDate(startText);
            if (start is null)
            {
                continue;
            }

            events.Add(new RawCalendarEvent
            {
                Start = start.Value,
                Title = summary,
                Detail = map.TryGetValue("LOCATION", out var location) ? location : ""
            });
        }

        var cutoff = DateTimeOffset.Now.AddHours(-1);
        return events
            .Where(item => item.Start >= cutoff)
            .OrderBy(item => item.Start)
            .Take(3)
            .Select(item => new CalendarEntry
            {
                Time = item.Start.ToLocalTime().ToString("hh:mm tt", CultureInfo.CurrentCulture),
                Title = item.Title,
                Detail = string.IsNullOrWhiteSpace(item.Detail) ? "Calendar event" : item.Detail
            })
            .ToList();
    }

    private static DateTimeOffset? ParseIcsDate(string rawValue)
    {
        if (string.IsNullOrWhiteSpace(rawValue))
        {
            return null;
        }

        if (rawValue.Length == 8 && DateOnly.TryParseExact(rawValue, "yyyyMMdd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var dateOnly))
        {
            return new DateTimeOffset(dateOnly.ToDateTime(TimeOnly.MinValue));
        }

        if (rawValue.Length == 16 && rawValue.EndsWith("Z", StringComparison.OrdinalIgnoreCase)
            && DateTimeOffset.TryParseExact(rawValue, "yyyyMMdd'T'HHmmss'Z'", CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal, out var utcTime))
        {
            return utcTime;
        }

        if (rawValue.Length == 15 && DateTime.TryParseExact(rawValue, "yyyyMMdd'T'HHmmss", CultureInfo.InvariantCulture, DateTimeStyles.AssumeLocal, out var localTime))
        {
            return new DateTimeOffset(localTime);
        }

        return DateTimeOffset.TryParse(rawValue, CultureInfo.InvariantCulture, DateTimeStyles.AssumeLocal, out var parsed)
            ? parsed
            : null;
    }

    private sealed class RawCalendarEvent
    {
        public DateTimeOffset Start { get; set; }

        public string Title { get; set; } = "";

        public string Detail { get; set; } = "";
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
