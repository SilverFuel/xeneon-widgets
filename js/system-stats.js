(function () {
  function buildUnavailableStats(reason) {
    return {
      cpu: null,
      gpu: null,
      ram: null,
      cpuTemp: null,
      gpuTemp: null,
      source: reason || "Telemetry unavailable"
    };
  }

  async function getSystemStats() {
    return buildUnavailableStats("Bridge required");
  }

  window.SystemStats = {
    getSystemStats: getSystemStats
  };
}());
