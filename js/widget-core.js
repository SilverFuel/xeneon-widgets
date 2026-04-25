(function () {
  function getWidgetSize() {
    var params = new URLSearchParams(window.location.search);
    return params.get("size") || "full";
  }

  function applyWidgetSize() {
    document.documentElement.setAttribute("data-size", getWidgetSize());
  }

  function formatPercent(value) {
    return typeof value === "number" && isFinite(value) ? Math.round(value) + "%" : "--";
  }

  function formatBytesPerSecond(valueMbps) {
    return typeof valueMbps === "number" && isFinite(valueMbps) ? valueMbps.toFixed(1) + " Mbps" : "--";
  }

  function mountWidget(widget) {
    var activeWidget = widget;
    var disposed = false;
    var timerId = 0;
    var updateInFlight = false;
    var pendingUpdate = false;

    function clearTimer() {
      if (timerId) {
        window.clearTimeout(timerId);
        timerId = 0;
      }
      activeWidget.__interval = 0;
      activeWidget.__timer = 0;
    }

    async function renderUpdate() {
      if (disposed) {
        return;
      }

      if (updateInFlight) {
        pendingUpdate = true;
        return;
      }

      updateInFlight = true;
      if (typeof activeWidget.updateWidget === "function") {
        try {
          await activeWidget.updateWidget();
        } catch (error) {
          console.error("Widget update failed", error);
        }
      }
      updateInFlight = false;

      if (pendingUpdate && !document.hidden) {
        pendingUpdate = false;
        window.setTimeout(function () {
          renderUpdate();
        }, 0);
      }
    }

    function scheduleNextTick() {
      clearTimer();
      if (disposed || !activeWidget.refreshInterval) {
        return;
      }

      timerId = window.setTimeout(function () {
        if (document.hidden) {
          scheduleNextTick();
          return;
        }

        renderUpdate().then(function () {
          scheduleNextTick();
        });
      }, activeWidget.refreshInterval);

      activeWidget.__interval = timerId;
      activeWidget.__timer = timerId;
    }

    function handleVisibilityChange() {
      if (disposed || document.hidden) {
        clearTimer();
        return;
      }

      renderUpdate().then(function () {
        scheduleNextTick();
      });
    }

    applyWidgetSize();

    window.addEventListener("beforeunload", function () {
      disposed = true;
      clearTimer();
      if (typeof activeWidget.destroyWidget === "function") {
        activeWidget.destroyWidget();
      }
    });

    document.addEventListener("visibilitychange", handleVisibilityChange);

    if (typeof activeWidget.initWidget === "function") {
      activeWidget.initWidget();
    }

    if (typeof activeWidget.updateWidget === "function") {
      renderUpdate().then(function () {
        scheduleNextTick();
      });
    }

    return activeWidget;
  }

  window.WidgetCore = {
    applyWidgetSize: applyWidgetSize,
    formatBytesPerSecond: formatBytesPerSecond,
    formatPercent: formatPercent,
    getWidgetSize: getWidgetSize,
    mountWidget: mountWidget
  };
}());
