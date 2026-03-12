(function () {
  function getWidgetSize() {
    var params = new URLSearchParams(window.location.search);
    return params.get("size") || "full";
  }

  function applyWidgetSize() {
    document.documentElement.setAttribute("data-size", getWidgetSize());
  }

  function formatPercent(value) {
    return Math.round(value) + "%";
  }

  function formatBytesPerSecond(valueMbps) {
    return valueMbps.toFixed(1) + " Mbps";
  }

  function mountWidget(widget) {
    var activeWidget = widget;

    function renderUpdate() {
      if (typeof activeWidget.updateWidget === "function") {
        activeWidget.updateWidget();
      }
    }

    applyWidgetSize();

    window.addEventListener("beforeunload", function () {
      if (typeof activeWidget.destroyWidget === "function") {
        activeWidget.destroyWidget();
      }
    });

    if (typeof activeWidget.initWidget === "function") {
      activeWidget.initWidget();
    }

    if (typeof activeWidget.updateWidget === "function" && activeWidget.refreshInterval) {
      renderUpdate();
      activeWidget.__interval = window.setInterval(renderUpdate, activeWidget.refreshInterval);
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
