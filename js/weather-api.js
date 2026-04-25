(function () {
  function buildHourlyForecast(entries) {
    return (entries || []).slice(0, 5).map(function (entry) {
      return {
        hour: new Date(entry.dt * 1000).toLocaleTimeString([], { hour: "numeric" }),
        temp: Math.round(entry.main.temp),
        condition: entry.weather[0].main,
        icon: entry.weather[0].icon
      };
    });
  }

  function buildDailyForecast(entries) {
    var buckets = {};

    (entries || []).forEach(function (entry) {
      var date = new Date(entry.dt * 1000);
      var key = date.toISOString().slice(0, 10);
      var bucket = buckets[key];
      var condition = entry.weather[0].main;

      if (!bucket) {
        bucket = buckets[key] = {
          day: date.toLocaleDateString([], { weekday: "short" }),
          high: entry.main.temp,
          low: entry.main.temp,
          conditionCounts: {},
          iconCounts: {}
        };
      }

      bucket.high = Math.max(bucket.high, entry.main.temp);
      bucket.low = Math.min(bucket.low, entry.main.temp);
      bucket.conditionCounts[condition] = (bucket.conditionCounts[condition] || 0) + 1;
      bucket.iconCounts[entry.weather[0].icon] = (bucket.iconCounts[entry.weather[0].icon] || 0) + 1;
    });

    return Object.keys(buckets).slice(0, 5).map(function (key) {
      var bucket = buckets[key];
      var condition = Object.keys(bucket.conditionCounts).sort(function (left, right) {
        return bucket.conditionCounts[right] - bucket.conditionCounts[left];
      })[0];
      var icon = Object.keys(bucket.iconCounts).sort(function (left, right) {
        return bucket.iconCounts[right] - bucket.iconCounts[left];
      })[0];

      return {
        day: bucket.day,
        high: Math.round(bucket.high),
        low: Math.round(bucket.low),
        condition: condition,
        icon: icon
      };
    });
  }

  async function fetchWeather() {
    var city = ApiUtils.getQueryParam("city", "Indianapolis");
    var units = ApiUtils.getQueryParam("units", "metric");
    var endpoint = ApiUtils.getQueryParam("endpoint", "");

    if (!endpoint && window.location.origin && /^https?:/i.test(window.location.origin)) {
      endpoint = window.location.origin.replace(/\/$/, "") + "/api/weather";
    }

    if (endpoint) {
      try {
        return await ApiUtils.safeJsonFetch(endpoint);
      } catch (error) {
        console.warn("Native weather endpoint unavailable:", error);
      }
    }

    return {
      configured: false,
      message: "Open Xenon setup to add weather.",
      city: city,
      units: units,
      temperature: null,
      condition: "",
      icon: "",
      hourly: [],
      daily: [],
      forecast: [],
      source: "native setup"
    };
  }

  function getWeatherIconUrl(iconCode) {
    return "https://openweathermap.org/img/wn/" + iconCode + "@2x.png";
  }

  window.WeatherApi = {
    fetchWeather: fetchWeather,
    getWeatherIconUrl: getWeatherIconUrl
  };
}());
