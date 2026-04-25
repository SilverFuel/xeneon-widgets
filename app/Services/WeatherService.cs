using System.Text.Json;

namespace XenonEdgeHost;

public sealed class WeatherService
{
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

        using var currentResponse = await _httpClient.GetAsync(currentUrl, cancellationToken);
        using var forecastResponse = await _httpClient.GetAsync(forecastUrl, cancellationToken);
        var currentContent = await currentResponse.Content.ReadAsStringAsync(cancellationToken);
        var forecastContent = await forecastResponse.Content.ReadAsStringAsync(cancellationToken);

        using var current = JsonDocument.Parse(currentContent);
        using var forecast = JsonDocument.Parse(forecastContent);

        if (!currentResponse.IsSuccessStatusCode)
        {
            throw new InvalidOperationException(current.RootElement.TryGetProperty("message", out var messageNode)
                ? messageNode.GetString() ?? "Weather request failed"
                : "Weather request failed");
        }

        if (!forecastResponse.IsSuccessStatusCode)
        {
            throw new InvalidOperationException(forecast.RootElement.TryGetProperty("message", out var messageNode)
                ? messageNode.GetString() ?? "Forecast request failed"
                : "Forecast request failed");
        }

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
