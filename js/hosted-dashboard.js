(function () {
  var stageWidth = 2560;
  var stageHeight = 720;

  function setScale() {
    var scale = Math.min(window.innerWidth / stageWidth, window.innerHeight / stageHeight);
    document.documentElement.style.setProperty("--dashboard-scale", String(scale));
  }

  function renderEmptyState(message) {
    var city = ApiUtils.getQueryParam("city", "Indianapolis");
    document.getElementById("hosted-weather-source").textContent = message || "Unavailable";
    document.getElementById("hosted-weather-empty").classList.remove("is-hidden");
    document.getElementById("hosted-weather-live").classList.add("is-hidden");
    document.getElementById("hosted-weather-url").textContent = message === "Open setup"
      ? "http://127.0.0.1:8976/dashboard.html?widget=setup"
      : "Weather request failed for " + city;
  }

  function renderForecast(entries) {
    document.getElementById("hosted-weather-forecast").innerHTML = entries.map(function (entry) {
      return '<div class="hosted-weather-forecast__item"><span>' + entry.hour + '</span><strong>' +
        entry.temp + '°</strong><small>' + entry.condition + "</small></div>";
    }).join("");
  }

  async function renderWeather() {
    try {
      var weather = await WeatherApi.fetchWeather();

      if (weather.configured === false) {
        renderEmptyState("Open setup");
        return;
      }

      document.getElementById("hosted-weather-source").textContent = "Live";
      document.getElementById("hosted-weather-empty").classList.add("is-hidden");
      document.getElementById("hosted-weather-live").classList.remove("is-hidden");
      document.getElementById("hosted-weather-city").textContent = weather.city;
      document.getElementById("hosted-weather-temp").textContent = weather.temperature + "°";
      document.getElementById("hosted-weather-condition").textContent = weather.condition;
      document.getElementById("hosted-weather-icon").src = WeatherApi.getWeatherIconUrl(weather.icon);
      renderForecast((weather.forecast || weather.hourly || []).slice(0, 5));
    } catch (error) {
      renderEmptyState("Unavailable");
    }
  }

  document.addEventListener("DOMContentLoaded", function () {
    setScale();
    renderWeather();
    window.addEventListener("resize", setScale);
    window.setInterval(renderWeather, 600000);
  });
}());
