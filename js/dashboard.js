(function () {
  var params = new URLSearchParams(window.location.search);
  var bridgeOrigin = params.get("bridge") || "http://127.0.0.1:8976";
  var weatherCity = params.get("city") || "Indianapolis";
  var weatherUnits = params.get("units") || "metric";
  var stageWidth = 2560;
  var stageHeight = 720;

  function setScale() {
    var scale = Math.min(window.innerWidth / stageWidth, window.innerHeight / stageHeight);
    document.documentElement.style.setProperty("--dashboard-scale", String(scale));
  }

  async function fetchBridge(path) {
    var response = await fetch(bridgeOrigin + path);
    var payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error || payload.message || "Bridge request failed");
    }

    return payload;
  }

  function setStatus(nodeId, text) {
    document.getElementById(nodeId).textContent = text;
  }

  function setText(nodeId, value) {
    document.getElementById(nodeId).textContent = value;
  }

  function renderClock() {
    var now = new Date();
    setText("dashboard-clock-time", now.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit"
    }));
    setText("dashboard-clock-date", now.toLocaleDateString([], {
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric"
    }));
    setText("dashboard-calendar-day", now.toLocaleDateString([], { weekday: "long" }));
    setText("dashboard-calendar-date", now.toLocaleDateString([], {
      month: "long",
      day: "numeric",
      year: "numeric"
    }));
  }

  async function renderSystem() {
    try {
      var stats = await fetchBridge("/api/system");
      setText("dashboard-cpu", WidgetCore.formatPercent(stats.cpu));
      setText("dashboard-gpu", WidgetCore.formatPercent(stats.gpu));
      setText("dashboard-ram", WidgetCore.formatPercent(stats.ram));
      setText("dashboard-disk", WidgetCore.formatPercent(stats.disk));
      setText("dashboard-cpu-temp", stats.cpuTemp == null ? "Sensor n/a" : Math.round(stats.cpuTemp) + " C");
      setText("dashboard-gpu-temp", stats.gpuTemp == null ? "Sensor n/a" : Math.round(stats.gpuTemp) + " C");
      document.getElementById("dashboard-cpu-bar").style.width = stats.cpu + "%";
      document.getElementById("dashboard-gpu-bar").style.width = stats.gpu + "%";
      document.getElementById("dashboard-ram-bar").style.width = stats.ram + "%";
      document.getElementById("dashboard-disk-bar").style.width = stats.disk + "%";
      setStatus("dashboard-system-source", "Live");
    } catch (error) {
      setStatus("dashboard-system-source", "Bridge offline");
    }
  }

  async function renderNetwork() {
    try {
      var network = await fetchBridge("/api/network");
      setText("dashboard-download", WidgetCore.formatBytesPerSecond(network.download));
      setText("dashboard-upload", WidgetCore.formatBytesPerSecond(network.upload));
      setText("dashboard-ping", Math.round(network.ping) + " ms");
      setText("dashboard-network-type", network.type);
      setStatus("dashboard-network-source", "Live");
    } catch (error) {
      setStatus("dashboard-network-source", "Bridge offline");
    }
  }

  async function renderWeather() {
    try {
      var weather = await fetchBridge("/api/weather?city=" + encodeURIComponent(weatherCity) + "&units=" + encodeURIComponent(weatherUnits));

      if (!weather.configured) {
        setStatus("dashboard-weather-source", "Set weather key");
        setText("dashboard-weather-condition", weather.message);
        document.getElementById("dashboard-weather-forecast").innerHTML = "";
        return;
      }

      setText("dashboard-weather-city", weather.city);
      setText("dashboard-weather-temp", weather.temperature + "°");
      setText("dashboard-weather-condition", weather.condition);
      document.getElementById("dashboard-weather-icon").src = "https://openweathermap.org/img/wn/" + weather.icon + "@2x.png";
      document.getElementById("dashboard-weather-forecast").innerHTML = weather.forecast.map(function (entry) {
        return '<div class="dash-mini-list__item"><span>' + entry.hour + " " + entry.condition + '</span><strong>' + entry.temp + "°</strong></div>";
      }).join("");
      setStatus("dashboard-weather-source", "Live");
    } catch (error) {
      setStatus("dashboard-weather-source", "Bridge offline");
    }
  }

  async function renderCalendar() {
    try {
      var calendar = await fetchBridge("/api/calendar");
      var calendarCard = document.querySelector(".dash-card--calendar");

      if (!calendar.configured) {
        document.documentElement.classList.add("layout-no-calendar");
        calendarCard.classList.add("is-hidden");
        return;
      }

      document.documentElement.classList.remove("layout-no-calendar");
      calendarCard.classList.remove("is-hidden");
      setStatus("dashboard-calendar-source", "Live");
      document.getElementById("dashboard-calendar-list").innerHTML = calendar.entries.map(function (entry) {
        return '<div class="dash-mini-list__item"><span>' + entry.time + " " + entry.title + '</span><strong>' + entry.detail + "</strong></div>";
      }).join("");
    } catch (error) {
      setStatus("dashboard-calendar-source", "Bridge offline");
    }
  }

  async function renderMedia() {
    try {
      var media = await fetchBridge("/api/media");
      var mediaCard = document.querySelector(".dash-card--media");

      if (!media.configured) {
        document.documentElement.classList.add("layout-no-media");
        mediaCard.classList.add("is-hidden");
        return;
      }

      document.documentElement.classList.remove("layout-no-media");
      mediaCard.classList.remove("is-hidden");
      setStatus("dashboard-media-source", "Live");
      setText("dashboard-media-title", media.title || "Unknown track");
      setText("dashboard-media-artist", media.artist || "Unknown artist");
      document.getElementById("dashboard-media-progress").style.width = (media.progress || 0) + "%";
      document.querySelector('[data-dashboard-action="toggle"]').textContent = media.playing ? "Pause" : "Play";
      if (media.artwork) {
        document.getElementById("dashboard-media-art").src = media.artwork;
      }
    } catch (error) {
      document.documentElement.classList.add("layout-no-media");
      document.querySelector(".dash-card--media").classList.add("is-hidden");
    }
  }

  async function postMediaAction(action) {
    try {
      await fetch(bridgeOrigin + "/api/media/" + action, { method: "POST" });
      renderMedia();
    } catch (error) {
      setStatus("dashboard-media-source", "Bridge offline");
    }
  }

  function bindMediaControls() {
    TouchControls.enhanceControls(".control-button");
    document.querySelectorAll("[data-dashboard-action]").forEach(function (button) {
      button.addEventListener("click", function () {
        postMediaAction(button.getAttribute("data-dashboard-action"));
      });
    });
  }

  async function applyCapabilities() {
    try {
      var health = await fetchBridge("/api/health");
      if (!health.capabilities.media) {
        document.documentElement.classList.add("layout-no-media");
        document.querySelector(".dash-card--media").classList.add("is-hidden");
      }
      if (!health.capabilities.calendar) {
        document.documentElement.classList.add("layout-no-calendar");
        document.querySelector(".dash-card--calendar").classList.add("is-hidden");
      }
    } catch (error) {
      document.documentElement.classList.add("layout-no-media");
      document.documentElement.classList.add("layout-no-calendar");
      document.querySelector(".dash-card--media").classList.add("is-hidden");
      document.querySelector(".dash-card--calendar").classList.add("is-hidden");
      setStatus("dashboard-system-source", "Bridge offline");
      setStatus("dashboard-network-source", "Bridge offline");
      setStatus("dashboard-weather-source", "Bridge offline");
      setStatus("dashboard-calendar-source", "Bridge offline");
      setStatus("dashboard-media-source", "Bridge offline");
    }
  }

  document.addEventListener("DOMContentLoaded", function () {
    setScale();
    renderClock();
    bindMediaControls();
    applyCapabilities();
    renderSystem();
    renderNetwork();
    renderWeather();
    renderCalendar();
    renderMedia();

    window.addEventListener("resize", setScale);
    window.setInterval(renderClock, 1000);
    window.setInterval(renderSystem, 2000);
    window.setInterval(renderNetwork, 2000);
    window.setInterval(renderWeather, 600000);
    window.setInterval(renderCalendar, 60000);
    window.setInterval(renderMedia, 3000);
  });
}());
