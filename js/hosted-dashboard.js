(function () {
  var stageWidth = 2560;
  var stageHeight = 720;

  function setScale() {
    var scale = Math.min(window.innerWidth / stageWidth, window.innerHeight / stageHeight);
    document.documentElement.style.setProperty("--dashboard-scale", String(scale));
  }

  function renderClock() {
    var now = new Date();
    document.getElementById("hosted-clock-time").textContent = now.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit"
    });
    document.getElementById("hosted-clock-date").textContent = now.toLocaleDateString([], {
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric"
    });
    document.getElementById("hosted-timezone-name").textContent =
      Intl.DateTimeFormat().resolvedOptions().timeZone || "Local";
    document.getElementById("hosted-utc-time").textContent =
      now.toLocaleTimeString([], { timeZone: "UTC", hour: "2-digit", minute: "2-digit" });

    var offsetMinutes = now.getTimezoneOffset();
    var sign = offsetMinutes <= 0 ? "+" : "-";
    var absolute = Math.abs(offsetMinutes);
    var hours = String(Math.floor(absolute / 60)).padStart(2, "0");
    var minutes = String(absolute % 60).padStart(2, "0");
    document.getElementById("hosted-utc-offset").textContent = "UTC " + sign + hours + ":" + minutes;
  }

  async function renderWeather() {
    try {
      var weather = await WeatherApi.fetchWeather();

      if (weather.source === "fallback") {
        document.getElementById("hosted-weather-source").textContent = "Add API key";
        document.getElementById("hosted-weather-city").textContent = weather.city;
        document.getElementById("hosted-weather-temp").textContent = "--°";
        document.getElementById("hosted-weather-condition").textContent = "Add ?apiKey=YOUR_KEY";
        document.getElementById("hosted-weather-forecast").innerHTML = "";
        return;
      }

      document.getElementById("hosted-weather-source").textContent = "Live";
      document.getElementById("hosted-weather-city").textContent = weather.city;
      document.getElementById("hosted-weather-temp").textContent = weather.temperature + "°";
      document.getElementById("hosted-weather-condition").textContent = weather.condition;
      document.getElementById("hosted-weather-icon").src = WeatherApi.getWeatherIconUrl(weather.icon);
      document.getElementById("hosted-weather-forecast").innerHTML = weather.forecast.slice(0, 3).map(function (entry) {
        return '<div class="dash-mini-list__item"><span>' + entry.hour + " " + entry.condition + '</span><strong>' + entry.temp + "°</strong></div>";
      }).join("");
    } catch (error) {
      document.getElementById("hosted-weather-source").textContent = "Unavailable";
      document.getElementById("hosted-weather-condition").textContent = "Weather request failed";
      document.getElementById("hosted-weather-forecast").innerHTML = "";
    }
  }

  document.addEventListener("DOMContentLoaded", function () {
    setScale();
    renderClock();
    renderWeather();
    window.addEventListener("resize", setScale);
    window.setInterval(renderClock, 1000);
    window.setInterval(renderWeather, 600000);
  });
}());
