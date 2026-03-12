(function () {
  var stageWidth = 2560;
  var stageHeight = 720;

  function setScale() {
    var scale = Math.min(window.innerWidth / stageWidth, window.innerHeight / stageHeight);
    document.documentElement.style.setProperty("--dashboard-scale", String(scale));
  }

  function renderEmptyState() {
    var city = ApiUtils.getQueryParam("city", "Indianapolis");
    document.getElementById("hosted-weather-source").textContent = "Add apiKey";
    document.getElementById("hosted-weather-empty").classList.remove("is-hidden");
    document.getElementById("hosted-weather-live").classList.add("is-hidden");
    document.getElementById("hosted-weather-url").textContent = "?apiKey=YOUR_KEY&city=" + city;
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

      if (weather.source === "fallback") {
        renderEmptyState();
        return;
      }

      document.getElementById("hosted-weather-source").textContent = "Live";
      document.getElementById("hosted-weather-empty").classList.add("is-hidden");
      document.getElementById("hosted-weather-live").classList.remove("is-hidden");
      document.getElementById("hosted-weather-city").textContent = weather.city;
      document.getElementById("hosted-weather-temp").textContent = weather.temperature + "°";
      document.getElementById("hosted-weather-condition").textContent = weather.condition;
      document.getElementById("hosted-weather-icon").src = WeatherApi.getWeatherIconUrl(weather.icon);
      renderForecast(weather.forecast.slice(0, 5));
    } catch (error) {
      document.getElementById("hosted-weather-source").textContent = "Unavailable";
      document.getElementById("hosted-weather-empty").classList.remove("is-hidden");
      document.getElementById("hosted-weather-live").classList.add("is-hidden");
      document.getElementById("hosted-weather-url").textContent = "Weather request failed";
    }
  }

  document.addEventListener("DOMContentLoaded", function () {
    setScale();
    renderWeather();
    window.addEventListener("resize", setScale);
    window.setInterval(renderWeather, 600000);
  });
}());
