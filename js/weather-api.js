(function () {
  var FALLBACK_FORECAST = [
    { hour: "Now", temp: 18, condition: "Clear" },
    { hour: "+1h", temp: 18, condition: "Light clouds" },
    { hour: "+2h", temp: 17, condition: "Clear" },
    { hour: "+3h", temp: 17, condition: "Breezy" },
    { hour: "+4h", temp: 16, condition: "Clear" }
  ];

  async function fetchWeather() {
    var apiKey = ApiUtils.getQueryParam("apiKey", "");
    var city = ApiUtils.getQueryParam("city", "Indianapolis");
    var units = ApiUtils.getQueryParam("units", "metric");

    if (!apiKey) {
      return {
        city: city,
        temperature: units === "imperial" ? 68 : 20,
        condition: "API key missing",
        icon: "01d",
        forecast: FALLBACK_FORECAST,
        source: "fallback"
      };
    }

    var currentUrl = "https://api.openweathermap.org/data/2.5/weather?q=" +
      encodeURIComponent(city) + "&units=" + encodeURIComponent(units) + "&appid=" + encodeURIComponent(apiKey);
    var forecastUrl = "https://api.openweathermap.org/data/2.5/forecast?q=" +
      encodeURIComponent(city) + "&units=" + encodeURIComponent(units) + "&appid=" + encodeURIComponent(apiKey);

    var current = await ApiUtils.safeJsonFetch(currentUrl);
    var forecast = await ApiUtils.safeJsonFetch(forecastUrl);

    return {
      city: current.name,
      temperature: Math.round(current.main.temp),
      condition: current.weather[0].description,
      icon: current.weather[0].icon,
      forecast: forecast.list.slice(0, 5).map(function (entry) {
        return {
          hour: new Date(entry.dt * 1000).toLocaleTimeString([], { hour: "numeric" }),
          temp: Math.round(entry.main.temp),
          condition: entry.weather[0].main
        };
      }),
      source: "openweathermap"
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
