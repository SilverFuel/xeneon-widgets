(function () {
  var mediaTracks = [
    {
      title: "Midnight Circuit",
      artist: "Neon Avenue",
      art: "https://images.unsplash.com/photo-1511379938547-c1f69419868d?auto=format&fit=crop&w=600&q=80"
    },
    {
      title: "Skyline Static",
      artist: "Voltage Hearts",
      art: "https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?auto=format&fit=crop&w=600&q=80"
    },
    {
      title: "Night Drive",
      artist: "Pulse Arcade",
      art: "https://images.unsplash.com/photo-1501612780327-45045538702b?auto=format&fit=crop&w=600&q=80"
    }
  ];
  var mediaState = { index: 0, playing: true, progress: 38 };
  var agendaItems = [
    { time: "09:00", title: "Sprint standup", detail: "Status review" },
    { time: "11:30", title: "Design sync", detail: "Widget layout pass" },
    { time: "14:00", title: "Benchmarks", detail: "iFrame performance test" }
  ];
  var networkSeed = 37;

  function renderClock() {
    var now = new Date();
    document.getElementById("dashboard-clock-time").textContent =
      now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    document.getElementById("dashboard-clock-date").textContent =
      now.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric", year: "numeric" });
    document.getElementById("dashboard-calendar-day").textContent =
      now.toLocaleDateString([], { weekday: "long" });
    document.getElementById("dashboard-calendar-date").textContent =
      now.toLocaleDateString([], { month: "long", day: "numeric", year: "numeric" });
  }

  function renderCalendar() {
    document.getElementById("dashboard-calendar-list").innerHTML = agendaItems.map(function (item) {
      return '<div class="dash-mini-list__item"><span>' + item.time + " " + item.title + '</span><strong>' +
        item.detail + "</strong></div>";
    }).join("");
  }

  async function renderSystem() {
    var stats = await SystemStats.getSystemStats();
    document.getElementById("dashboard-cpu").textContent = WidgetCore.formatPercent(stats.cpu);
    document.getElementById("dashboard-gpu").textContent = WidgetCore.formatPercent(stats.gpu);
    document.getElementById("dashboard-ram").textContent = WidgetCore.formatPercent(stats.ram);
    document.getElementById("dashboard-disk").textContent = WidgetCore.formatPercent(stats.disk);
    document.getElementById("dashboard-cpu-temp").textContent = Math.round(stats.cpuTemp) + " C";
    document.getElementById("dashboard-gpu-temp").textContent = Math.round(stats.gpuTemp) + " C";
    document.getElementById("dashboard-cpu-bar").style.width = stats.cpu + "%";
    document.getElementById("dashboard-gpu-bar").style.width = stats.gpu + "%";
    document.getElementById("dashboard-ram-bar").style.width = stats.ram + "%";
    document.getElementById("dashboard-disk-bar").style.width = stats.disk + "%";
    document.getElementById("dashboard-system-source").textContent = stats.source;
  }

  async function renderWeather() {
    try {
      var weather = await WeatherApi.fetchWeather();
      document.getElementById("dashboard-weather-city").textContent = weather.city;
      document.getElementById("dashboard-weather-temp").textContent = weather.temperature + "°";
      document.getElementById("dashboard-weather-condition").textContent = weather.condition;
      document.getElementById("dashboard-weather-source").textContent = weather.source;
      document.getElementById("dashboard-weather-icon").src = WeatherApi.getWeatherIconUrl(weather.icon);
      document.getElementById("dashboard-weather-forecast").innerHTML = weather.forecast.slice(0, 3).map(function (entry) {
        return '<div class="dash-mini-list__item"><span>' + entry.hour + " " + entry.condition + '</span><strong>' +
          entry.temp + "°</strong></div>";
      }).join("");
    } catch (error) {
      document.getElementById("dashboard-weather-source").textContent = "Weather unavailable";
    }
  }

  function nextNetworkValue(min, max) {
    networkSeed = (networkSeed * 9301 + 49297) % 233280;
    return min + (networkSeed / 233280) * (max - min);
  }

  function renderNetwork() {
    var connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    var downlink = connection && typeof connection.downlink === "number" ? connection.downlink : nextNetworkValue(45, 210);
    var upload = downlink * nextNetworkValue(0.18, 0.36);
    var ping = connection && typeof connection.rtt === "number" ? connection.rtt : nextNetworkValue(14, 42);
    var type = connection && connection.effectiveType ? connection.effectiveType : "ethernet";
    document.getElementById("dashboard-download").textContent = WidgetCore.formatBytesPerSecond(downlink);
    document.getElementById("dashboard-upload").textContent = WidgetCore.formatBytesPerSecond(upload);
    document.getElementById("dashboard-ping").textContent = Math.round(ping) + " ms";
    document.getElementById("dashboard-network-type").textContent = type;
    document.getElementById("dashboard-network-source").textContent = connection ? "Network API" : "Estimated fallback";
  }

  function renderMedia() {
    var track = mediaTracks[mediaState.index];
    document.getElementById("dashboard-media-title").textContent = track.title;
    document.getElementById("dashboard-media-artist").textContent = track.artist;
    document.getElementById("dashboard-media-art").src = track.art;
    document.getElementById("dashboard-media-progress").style.width = mediaState.progress + "%";
    document.querySelector('[data-dashboard-action="toggle"]').textContent = mediaState.playing ? "Pause" : "Play";
  }

  function bindMediaControls() {
    TouchControls.enhanceControls(".control-button");
    document.querySelectorAll("[data-dashboard-action]").forEach(function (button) {
      button.addEventListener("click", function () {
        var action = button.getAttribute("data-dashboard-action");
        if (action === "prev") {
          mediaState.index = (mediaState.index - 1 + mediaTracks.length) % mediaTracks.length;
          mediaState.progress = 8;
        } else if (action === "next") {
          mediaState.index = (mediaState.index + 1) % mediaTracks.length;
          mediaState.progress = 8;
        } else {
          mediaState.playing = !mediaState.playing;
        }
        renderMedia();
      });
    });
  }

  function tickMedia() {
    if (!mediaState.playing) {
      return;
    }
    mediaState.progress = (mediaState.progress + 4) % 100;
    renderMedia();
  }

  document.addEventListener("DOMContentLoaded", function () {
    renderClock();
    renderCalendar();
    renderMedia();
    bindMediaControls();
    renderSystem();
    renderWeather();
    renderNetwork();

    window.setInterval(renderClock, 1000);
    window.setInterval(renderSystem, 2000);
    window.setInterval(renderNetwork, 2000);
    window.setInterval(renderWeather, 600000);
    window.setInterval(tickMedia, 2000);
  });
}());
