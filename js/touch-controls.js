(function () {
  function enhanceControls(selector) {
    if (window.WidgetCore && typeof window.WidgetCore.installTouchControls === "function") {
      window.WidgetCore.installTouchControls();
    }

    document.querySelectorAll(selector).forEach(function (button) {
      button.classList.add("touch-control");
    });
  }

  window.TouchControls = {
    enhanceControls: enhanceControls
  };
}());
