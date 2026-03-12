(function () {
  function bindButtonState(button) {
    ["pointerdown", "pointerup", "pointercancel", "pointerleave"].forEach(function (eventName) {
      button.addEventListener(eventName, function () {
        button.style.transform = eventName === "pointerdown" ? "scale(0.98)" : "";
      });
    });
  }

  function enhanceControls(selector) {
    document.querySelectorAll(selector).forEach(bindButtonState);
  }

  window.TouchControls = {
    enhanceControls: enhanceControls
  };
}());
