using System.Text.Json;

namespace XenonEdgeHost;

public sealed class WeatherService
{
    private const int MaxWeatherResponseBytes = 1024 * 1024;
    private static readonly TimeSpan CacheTtl = TimeSpan.FromMinutes(5);
    private readonly HttpClient _httpClient;
    private readonly object _cacheSync = new();
    private readonly Dictionary<string, WeatherCacheEntry> _cache = new(StringComparer.OrdinalIgnoreCase);

    public WeatherService(HttpClient httpClient)
    {
        _httpClient = httpClient;
    }

    public async Task<object> GetSnapshotAsync(AppConfig config, string? cityOverride, string? unitsOverride, CancellationToken cancellationToken)
    {
        var apiKey = config.Weather.ApiKey?.Trim() ?? "";
        var city = string.IsNullOrWhiteSpace(cityOverride) ? config.Weather.City : cityOverride.Trim();
        var units = string.Equals(unitsOverride, "imperial", StringComparison.OrdinalIgnoreCase)
            ? "imperial"
            : string.Equals(unitsOverride, "metric", StringComparison.OrdinalIgnoreCase)
                ? "metric"
                : config.Weather.Units;

        if (string.IsNullOrWhiteSpace(apiKey))
        {
            return new
            {
                supported = true,
                configured = false,
                status = "setup",
                message = "OpenWeather API key missing",
                city,
                units,
                source = "OpenWeather",
                sampledAt = (DateTimeOffset?)null,
                stale = false
            };
        }

        units = string.Equals(units, "imperial", StringComparison.OrdinalIgnoreCase) ? "imperial" : "metric";
        var cacheKey = $"{apiKey}|{city}|{units}";
        lock (_cacheSync)
        {
            if (_cache.TryGetValue(cacheKey, out var cached) && cached.ExpiresAt > DateTimeOffset.UtcNow)
            {
                return cached.Payload;
            }
        }

        var currentUrl = $"https://api.openweathermap.org/data/2.5/weather?q={Uri.EscapeDataString(city)}&units={Uri.EscapeDataString(units)}&appid={Uri.EscapeDataString(apiKey)}";
        var forecastUrl = $"https://api.openweathermap.org/data/2.5/forecast?q={Uri.EscapeDataString(city)}&units={Uri.EscapeDataString(units)}&appid={Uri.EscapeDataString(apiKey)}";

        using var currentResponse = await HttpReadResilience.SendAsync(
            _httpClient,
            () => new HttpRequestMessage(HttpMethod.Get, currentUrl),
            MaxWeatherResponseBytes,
            cancellationToken);
        if (!currentResponse.IsSuccessStatusCode)
        {
            var errorContent = HttpReadResilience.IsTransientStatus(currentResponse.StatusCode)
                ? ""
                : await currentResponse.Content.ReadAsStringAsync(cancellationToken);
            throw new InvalidOperationException(ReadErrorMessage(errorContent, "Weather request failed"));
        }

        var currentContent = await currentResponse.Content.ReadAsStringAsync(cancellationToken);
        using var forecastResponse = await HttpReadResilience.SendAsync(
            _httpClient,
            () => new HttpRequestMessage(HttpMethod.Get, forecastUrl),
            MaxWeatherResponseBytes,
            cancellationToken);
        if (!forecastResponse.IsSuccessStatusCode)
        {
            var errorContent = HttpReadResilience.IsTransientStatus(forecastResponse.StatusCode)
                ? ""
                : await forecastResponse.Content.ReadAsStringAsync(cancellationToken);
            throw new InvalidOperationException(ReadErrorMessage(errorContent, "Forecast request failed"));
        }

        var forecastContent = await forecastResponse.Content.ReadAsStringAsync(cancellationToken);

        using var current = ParseUpstreamJson(currentContent, "Weather");
        using var forecast = ParseUpstreamJson(forecastContent, "Forecast");

        var forecastList = forecast.RootElement.GetProperty("list").EnumerateArray().ToList();
        var hourly = forecastList.Take(5).Select(entry =>
        {
            var when = DateTimeOffset.FromUnixTimeSeconds(entry.GetProperty("dt").GetInt64()).LocalDateTime;
            var weather = entry.GetProperty("weather").EnumerateArray().First();
            return new
            {
                hour = when.ToString("%h tt").ToLowerInvariant(),
                temp = (int)Math.Round(entry.GetProperty("main").GetProperty("temp").GetDouble()),
                condition = weather.GetProperty("main").GetString() ?? "",
                icon = weather.GetProperty("icon").GetString() ?? ""
            };
        }).ToList();

        var dailyBuckets = new Dictionary<string, DailyBucket>(StringComparer.OrdinalIgnoreCase);
        foreach (var entry in forecastList)
        {
            var when = DateTimeOffset.FromUnixTimeSeconds(entry.GetProperty("dt").GetInt64()).LocalDateTime;
            var key = when.ToString("yyyy-MM-dd");
            var weather = entry.GetProperty("weather").EnumerateArray().First();
            var condition = weather.GetProperty("main").GetString() ?? "";
            var icon = weather.GetProperty("icon").GetString() ?? "";

            if (!dailyBuckets.TryGetValue(key, out var bucket))
            {
                var initialTemp = entry.GetProperty("main").GetProperty("temp").GetDouble();
                bucket = new DailyBucket(when.ToString("ddd"), initialTemp, initialTemp);
                dailyBuckets[key] = bucket;
            }

            bucket.High = Math.Max(bucket.High, entry.GetProperty("main").GetProperty("temp").GetDouble());
            bucket.Low = Math.Min(bucket.Low, entry.GetProperty("main").GetProperty("temp").GetDouble());
            bucket.ConditionCounts[condition] = bucket.ConditionCounts.TryGetValue(condition, out var conditionCount) ? conditionCount + 1 : 1;
            bucket.IconCounts[icon] = bucket.IconCounts.TryGetValue(icon, out var iconCount) ? iconCount + 1 : 1;
        }

        var daily = dailyBuckets.Values
            .Take(5)
            .Select(bucket => new
            {
                day = bucket.Day,
                high = (int)Math.Round(bucket.High),
                low = (int)Math.Round(bucket.Low),
                condition = bucket.ConditionCounts.OrderByDescending(entry => entry.Value).First().Key,
                icon = bucket.IconCounts.OrderByDescending(entry => entry.Value).First().Key
            })
            .ToList();

        var sampledAt = DateTimeOffset.UtcNow;
        var payload = new
        {
            supported = true,
            configured = true,
            status = "live",
            city = current.RootElement.GetProperty("name").GetString() ?? city,
            temperature = (int)Math.Round(current.RootElement.GetProperty("main").GetProperty("temp").GetDouble()),
            condition = current.RootElement.GetProperty("weather").EnumerateArray().First().GetProperty("description").GetString() ?? "",
            icon = current.RootElement.GetProperty("weather").EnumerateArray().First().GetProperty("icon").GetString() ?? "",
            units,
            hourly,
            daily,
            source = "OpenWeather",
            sampledAt,
            stale = false
        };

        lock (_cacheSync)
        {
            _cache[cacheKey] = new WeatherCacheEntry(payload, sampledAt.Add(CacheTtl));
        }

        return payload;
    }

    private sealed class DailyBucket
    {
        public DailyBucket(string day, double high, double low)
        {
            Day = day;
            High = high;
            Low = low;
        }

        public string Day { get; }

        public double High { get; set; }

        public double Low { get; set; }

        public Dictionary<string, int> ConditionCounts { get; } = new(StringComparer.OrdinalIgnoreCase);

        public Dictionary<string, int> IconCounts { get; } = new(StringComparer.OrdinalIgnoreCase);
    }

    private static JsonDocument ParseUpstreamJson(string content, string label)
    {
        try
        {
            return JsonDocument.Parse(content);
        }
        catch (JsonException error)
        {
            throw new InvalidOperationException($"{label} service returned invalid JSON.", error);
        }
    }

    private static string ReadErrorMessage(string content, string fallback)
    {
        try
        {
            using var document = JsonDocument.Parse(content);
            return document.RootElement.TryGetProperty("message", out var messageNode)
                ? messageNode.GetString() ?? fallback
                : fallback;
        }
        catch (JsonException)
        {
            return fallback;
        }
    }

    private sealed class WeatherCacheEntry
    {
        public WeatherCacheEntry(object payload, DateTimeOffset expiresAt)
        {
            Payload = payload;
            ExpiresAt = expiresAt;
        }

        public object Payload { get; }

        public DateTimeOffset ExpiresAt { get; }
    }
}
