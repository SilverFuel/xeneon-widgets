(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.AuxoraLayout = api;
  }
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  function classifyViewport(width, height) {
    var numericWidth = Number(width);
    var numericHeight = Number(height);
    var safeWidth = Number.isFinite(numericWidth) ? Math.max(numericWidth, 1) : 1;
    var safeHeight = Number.isFinite(numericHeight) ? Math.max(numericHeight, 1) : 1;
    var aspect = safeWidth / safeHeight;
    var portrait = aspect < 1;
    var ultrawide = aspect >= 2.8;
    var compact = safeWidth < 900 || safeHeight < 480;

    return {
      width: safeWidth,
      height: safeHeight,
      aspect: aspect,
      browser: safeWidth < 1100,
      compact: compact,
      portrait: portrait,
      ultrawide: ultrawide,
      layoutClass: portrait ? "portrait" : ultrawide ? "ultrawide" : compact ? "compact" : "standard"
    };
  }

  return {
    classifyViewport: classifyViewport
  };
});
