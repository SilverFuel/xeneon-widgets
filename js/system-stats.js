(function () {
  var baseline = {
    cpu: 34,
    gpu: 48,
    ram: 61,
    disk: 52,
    cpuTemp: 56,
    gpuTemp: 61
  };

  function drift(value, amount, floor, ceiling) {
    var next = value + (Math.random() * amount * 2 - amount);
    return Math.max(floor, Math.min(ceiling, next));
  }

  async function readBrowserStats() {
    if (!("getBattery" in navigator)) {
      throw new Error("No browser-native stats available");
    }

    var battery = await navigator.getBattery();
    var level = Math.round(battery.level * 100);

    return {
      cpu: drift(level * 0.4, 6, 10, 85),
      gpu: drift(level * 0.5, 5, 8, 93),
      ram: drift(58, 4, 35, 84),
      disk: drift(51, 2, 40, 74),
      cpuTemp: drift(54, 2, 42, 78),
      gpuTemp: drift(61, 2, 48, 81),
      source: "browser-derived fallback"
    };
  }

  function readMockStats() {
    baseline.cpu = drift(baseline.cpu, 4, 12, 94);
    baseline.gpu = drift(baseline.gpu, 5, 8, 96);
    baseline.ram = drift(baseline.ram, 2.5, 35, 88);
    baseline.disk = drift(baseline.disk, 1.2, 42, 76);
    baseline.cpuTemp = drift(baseline.cpuTemp, 1.1, 43, 83);
    baseline.gpuTemp = drift(baseline.gpuTemp, 1.4, 48, 86);

    return Promise.resolve({
      cpu: baseline.cpu,
      gpu: baseline.gpu,
      ram: baseline.ram,
      disk: baseline.disk,
      cpuTemp: baseline.cpuTemp,
      gpuTemp: baseline.gpuTemp,
      source: "simulated data"
    });
  }

  async function getSystemStats() {
    try {
      return await readBrowserStats();
    } catch (error) {
      return readMockStats();
    }
  }

  window.SystemStats = {
    getSystemStats: getSystemStats
  };
}());
