(function () {
  var touchControlsInstalled = false;
  var activeTouch = null;
  var suppressedTouchClick = {
    until: 0,
    target: null
  };
  var recentScroll = {
    until: 0,
    target: null
  };
  var touchMoveThresholdPx = 20;
  var touchScrollThresholdPx = 7;
  var touchAxisBiasPx = 3;
  var touchPressDelayMs = 135;
  var touchClickBlockMs = 850;
  var touchInteractiveSelector = [
    "button",
    "a[href]",
    "[role='button']",
    "input[type='button']",
    "input[type='submit']",
    "input[type='reset']",
    "[data-action]",
    "[data-widget-id]",
    "[data-profile]",
    "[data-theme]",
    "[data-pack]",
    "[data-layout-action]",
    ".router-picker__button",
    ".router-diagnostics",
    ".router-settings__button",
    ".inline-button",
    ".inline-action-button",
    ".inline-launcher-hit",
    ".inline-list-item--button",
    ".product-card--button",
    ".product-swatch"
  ].join(",");
  var touchFineControlSelector = [
    "input[type='range']",
    "input[type='color']",
    "input[type='text']",
    "input[type='number']",
    "input[type='search']",
    "input[type='email']",
    "input[type='url']",
    "input[type='password']",
    "select",
    "textarea",
    "[contenteditable='true']"
  ].join(",");
  var touchScrollSelector = [
    ".landing-page",
    ".router-picker",
    ".router-settings__body",
    ".router-inline-widget",
    ".inline-list",
    ".audio-route-strip",
    ".audio-session-stack",
    ".game-mode-steam-grid",
    ".product-layout-list",
    ".product-privacy-list",
    ".product-code-preview",
    ".dashboard-native-page--browser"
  ].join(",");

  function elementFromTarget(target) {
    if (!target) {
      return null;
    }
    if (target.nodeType === 1) {
      return target;
    }
    return target.parentElement || null;
  }

  function closestElement(target, selector) {
    var element = elementFromTarget(target);
    return element && element.closest ? element.closest(selector) : null;
  }

  function isDisabledControl(element) {
    return Boolean(element && (element.disabled || element.getAttribute("aria-disabled") === "true"));
  }

  function closestTouchInteractive(target) {
    var element = closestElement(target, touchInteractiveSelector);
    return isDisabledControl(element) ? null : element;
  }

  function isFineTouchControl(element) {
    return Boolean(element && element.matches && element.matches(touchFineControlSelector));
  }

  function isTouchPointer(event) {
    return event && (event.pointerType === "touch" || event.pointerType === "pen");
  }

  function pointerDistanceFromStart(state, event) {
    var dx = (event.clientX || 0) - state.startX;
    var dy = (event.clientY || 0) - state.startY;
    return Math.sqrt((dx * dx) + (dy * dy));
  }

  function pointerDeltaFromStart(state, event) {
    return {
      x: (event.clientX || 0) - state.startX,
      y: (event.clientY || 0) - state.startY
    };
  }

  function isWindowScroller(element) {
    return element === document.body || element === document.documentElement || element === window;
  }

  function getScrollPosition(element) {
    if (!element) {
      return { left: 0, top: 0 };
    }

    if (isWindowScroller(element)) {
      return {
        left: window.scrollX || document.documentElement.scrollLeft || document.body.scrollLeft || 0,
        top: window.scrollY || document.documentElement.scrollTop || document.body.scrollTop || 0
      };
    }

    return {
      left: element.scrollLeft || 0,
      top: element.scrollTop || 0
    };
  }

  function canScroll(element) {
    var style;
    var overflowY;
    var overflowX;

    if (!element || element === window) {
      return false;
    }

    if (isWindowScroller(element)) {
      return document.documentElement.scrollHeight > window.innerHeight + 2
        || document.documentElement.scrollWidth > window.innerWidth + 2;
    }

    style = window.getComputedStyle ? window.getComputedStyle(element) : null;
    overflowY = style ? style.overflowY : "";
    overflowX = style ? style.overflowX : "";
    return ((element.scrollHeight > element.clientHeight + 2) && /auto|scroll|overlay/i.test(overflowY))
      || ((element.scrollWidth > element.clientWidth + 2) && /auto|scroll|overlay/i.test(overflowX));
  }

  function closestTouchScrollable(target) {
    var element = closestElement(target, touchScrollSelector);

    if (element && canScroll(element)) {
      return element;
    }

    element = elementFromTarget(target);
    while (element && element !== document.body) {
      if (canScroll(element)) {
        return element;
      }
      element = element.parentElement;
    }

    return canScroll(document.documentElement) ? document.documentElement : null;
  }

  function clearTouchPress(state) {
    var touch = state || activeTouch;
    if (!touch) {
      return;
    }

    if (touch.pressTimer) {
      window.clearTimeout(touch.pressTimer);
      touch.pressTimer = 0;
    }

    if (touch.pressTarget) {
      touch.pressTarget.classList.remove("is-touch-pressing");
      touch.pressTarget = null;
    }
  }

  function clearTouchScrolling(state) {
    var touch = state || activeTouch;
    if (!touch) {
      return;
    }

    if (touch.scrollTarget) {
      touch.scrollTarget.classList.remove("is-touch-scrolling");
    }

    document.documentElement.classList.remove("is-touch-scrolling");
  }

  function markTouchClickSuppressed(target) {
    if (!target) {
      return;
    }

    suppressedTouchClick.until = Date.now() + touchClickBlockMs;
    suppressedTouchClick.target = target;
  }

  function markRecentScroll(target) {
    recentScroll.until = Date.now() + touchClickBlockMs;
    recentScroll.target = elementFromTarget(target) || document.documentElement;
  }

  function isRelatedTouchTarget(reference, eventTarget) {
    var target = elementFromTarget(eventTarget);
    return Boolean(reference && target && (reference === target || reference.contains(target) || target.contains(reference)));
  }

  function handlePointerDown(event) {
    var interactive;
    var scrollPosition;
    var scrollTarget;

    if (!isTouchPointer(event) || event.isPrimary === false) {
      return;
    }

    document.documentElement.classList.add("is-touch-input");
    clearTouchPress();
    clearTouchScrolling();
    interactive = closestTouchInteractive(event.target);
    scrollTarget = closestTouchScrollable(event.target);
    scrollPosition = getScrollPosition(scrollTarget);
    activeTouch = {
      pointerId: event.pointerId,
      startX: event.clientX || 0,
      startY: event.clientY || 0,
      startScrollLeft: scrollPosition.left,
      startScrollTop: scrollPosition.top,
      moved: false,
      scrolling: false,
      interactive: interactive,
      scrollTarget: scrollTarget,
      pressTarget: null,
      pressTimer: 0
    };

    if (interactive && !isFineTouchControl(interactive)) {
      activeTouch.pressTarget = interactive;
      activeTouch.pressTimer = window.setTimeout(function () {
        if (activeTouch && activeTouch.pressTarget === interactive && !activeTouch.moved) {
          interactive.classList.add("is-touch-pressing");
        }
      }, touchPressDelayMs);
    }
  }

  function handlePointerMove(event) {
    var delta;
    var scrollDelta;
    var scrollPosition;
    var scrollMoved;
    var verticalScrollIntent;
    var horizontalScrollIntent;

    if (!activeTouch || activeTouch.pointerId !== event.pointerId) {
      return;
    }

    delta = pointerDeltaFromStart(activeTouch, event);
    scrollPosition = getScrollPosition(activeTouch.scrollTarget);
    scrollDelta = Math.abs(scrollPosition.top - activeTouch.startScrollTop)
      + Math.abs(scrollPosition.left - activeTouch.startScrollLeft);
    scrollMoved = scrollDelta > 1;
    verticalScrollIntent = Math.abs(delta.y) >= touchScrollThresholdPx
      && Math.abs(delta.y) >= Math.abs(delta.x) + touchAxisBiasPx;
    horizontalScrollIntent = Math.abs(delta.x) >= touchScrollThresholdPx
      && Math.abs(delta.x) >= Math.abs(delta.y) + touchAxisBiasPx;

    if (!activeTouch.moved
      && (pointerDistanceFromStart(activeTouch, event) >= touchMoveThresholdPx
        || (activeTouch.scrollTarget && (scrollMoved || verticalScrollIntent || horizontalScrollIntent)))) {
      activeTouch.moved = true;
      activeTouch.scrolling = Boolean(activeTouch.scrollTarget && (scrollMoved || verticalScrollIntent || horizontalScrollIntent));
      clearTouchPress(activeTouch);
      if (activeTouch.scrolling) {
        activeTouch.scrollTarget.classList.add("is-touch-scrolling");
        document.documentElement.classList.add("is-touch-scrolling");
      }
    }
  }

  function handlePointerEnd(event) {
    var touch = activeTouch;
    var interactive;

    if (!touch || touch.pointerId !== event.pointerId) {
      return;
    }

    if (pointerDistanceFromStart(touch, event) >= touchMoveThresholdPx) {
      touch.moved = true;
    }

    interactive = touch.interactive || closestTouchInteractive(event.target);
    clearTouchPress(touch);
    clearTouchScrolling(touch);
    activeTouch = null;

    if (touch.moved) {
      markTouchClickSuppressed(interactive || touch.scrollTarget || document.documentElement);
    }
  }

  function handlePointerCancel(event) {
    if (!activeTouch || activeTouch.pointerId !== event.pointerId) {
      return;
    }

    clearTouchPress(activeTouch);
    clearTouchScrolling(activeTouch);
    activeTouch = null;
  }

  function handleClickCapture(event) {
    var now = Date.now();

    if (recentScroll.until && now <= recentScroll.until && isRelatedTouchTarget(recentScroll.target, event.target)) {
      event.preventDefault();
      event.stopImmediatePropagation();
      recentScroll.until = 0;
      recentScroll.target = null;
      return;
    }

    if (!suppressedTouchClick.until || now > suppressedTouchClick.until) {
      suppressedTouchClick.until = 0;
      suppressedTouchClick.target = null;
      return;
    }

    if (isRelatedTouchTarget(suppressedTouchClick.target, event.target)) {
      event.preventDefault();
      event.stopImmediatePropagation();
      suppressedTouchClick.until = 0;
      suppressedTouchClick.target = null;
    }
  }

  function handleScrollCapture(event) {
    markRecentScroll(event.target || document.documentElement);
  }

  function installTouchControls() {
    if (touchControlsInstalled || typeof document === "undefined") {
      return;
    }

    touchControlsInstalled = true;
    document.addEventListener("pointerdown", handlePointerDown, { capture: true, passive: true });
    document.addEventListener("pointermove", handlePointerMove, { capture: true, passive: true });
    document.addEventListener("pointerup", handlePointerEnd, { capture: true, passive: true });
    document.addEventListener("pointercancel", handlePointerCancel, { capture: true, passive: true });
    document.addEventListener("scroll", handleScrollCapture, { capture: true, passive: true });
    document.addEventListener("click", handleClickCapture, true);
  }

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
    installTouchControls: installTouchControls,
    mountWidget: mountWidget
  };

  installTouchControls();
}());
