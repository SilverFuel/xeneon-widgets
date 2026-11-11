import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const dashboard = read("js/dashboard.js");
const navigationSource = read("js/dashboard-navigation.js");
const product = read("js/widgets/product.js");
const homeSource = product.slice(
  product.indexOf("function mountAuxoraHomeWidget"),
  product.indexOf("function mountScenesWidget")
);

const canonicalIds = [
  "home", "scenes", "setup", "theme-studio", "updates", "layout-editor", "streaming",
  "marketplace", "privacy", "remote", "installer", "game-mode", "system", "network",
  "audio", "quick-actions", "shortcuts", "display-controls", "clipboard", "weather",
  "calendar", "hue", "frigate", "wow-forever", "tmog"
];
const navigationContext = {};
runInNewContext(navigationSource, navigationContext);
const navigation = navigationContext.AuxoraNavigation;
assert(navigation.sections.map(section => section.id).join(",") === "home,gaming,media,pc,smart-home,settings", "all six sections must remain available in the canonical navigation model");
assert(navigation.validateCatalog(canonicalIds), "every shipped panel must belong to exactly one section");
const destinationWidgetsSource = dashboard.slice(dashboard.indexOf("function getDestinationWidgets("), dashboard.indexOf("function getWidgetById("));
const destinationWidgets = runInNewContext(`(${destinationWidgetsSource})`, {
  navigation,
  primaryDestination: "home",
  getWidgetById: id => canonicalIds.includes(id) ? { id } : null,
  sortWidgetsByLayout: widgets => widgets,
  shouldShowWidget: () => false
});
const reachableIds = navigation.sections.flatMap(section => destinationWidgets(section.id).map(widget => widget.id));
assert(reachableIds.length === canonicalIds.length && new Set(reachableIds).size === canonicalIds.length && canonicalIds.every(id => reachableIds.includes(id)), "section tabs must expose every canonical panel independently of Mode visibility or integration setup");
const layoutWidgetsSource = dashboard.slice(dashboard.indexOf("function getLayoutEditorWidgets("), dashboard.indexOf("function sceneWidgetIds("));
const layoutWidgets = runInNewContext(`(${layoutWidgetsSource})`, { navigation, widgets: canonicalIds.map(id => ({ id })), sortWidgetsByLayout: widgets => widgets });
assert(layoutWidgets().some(widget => widget.id === "clipboard") && layoutWidgets().every(widget => widget.id !== "home" && navigation.sectionForWidget(widget.id) !== "settings"), "Layout Editor must include Clipboard History and other content panels while excluding Settings tools");

// Execute the actual Home mount with a fake clock and event propagation. These
// gesture regressions do not start a browser, host, or device-facing request.
function homeGestureHarness(source = homeSource) {
  let clock = 0;
  let nextTimer = 0;
  const timers = new Map();
  const selections = [];
  const targets = [];
  const target = (parentElement = null, control = "") => {
    const node = {
      parentElement, control, isConnected: true, scrollTop: 0, scrollLeft: 0,
      listeners: new Map(),
      contains(other) { for (let current = other; current; current = current.parentElement) if (current === this) return true; return false; },
      closest(selector) { for (let current = this; current; current = current.parentElement) if (current.control && selector.split(",").includes(current.control)) return current; return null; },
      addEventListener(type, handler, options = false) {
        const capture = options === true || Boolean(options && options.capture);
        const handlers = this.listeners.get(type) || [];
        if (!handlers.some(entry => entry.handler === handler && entry.capture === capture)) handlers.push({ handler, capture, once: Boolean(options && options.once), passive: Boolean(options && options.passive) });
        this.listeners.set(type, handlers);
      },
      removeEventListener(type, handler, options = false) {
        const capture = options === true || Boolean(options && options.capture);
        this.listeners.set(type, (this.listeners.get(type) || []).filter(entry => entry.handler !== handler || entry.capture !== capture));
      }
    };
    targets.push(node);
    return node;
  };
  const document = target();
  document.hidden = false;
  const scroller = target(document);
  const container = target(scroller);
  const content = target(container);
  const outside = target(document);
  const window = target();
  window.setTimeout = (handler, milliseconds) => { const id = ++nextTimer; timers.set(id, { handler, due: clock + milliseconds }); return id; };
  window.clearTimeout = id => timers.delete(id);
  const mount = runInNewContext(`(${source})`, {
    window, document,
    addListener(cleanups, node, type, handler, options) { node.addEventListener(type, handler, options); cleanups.push(() => node.removeEventListener(type, handler, options)); },
    runCleanups: cleanups => cleanups.splice(0).forEach(cleanup => cleanup()),
    patchStableDom() {}, productShell: () => "", metricCard: () => "", escapeHtml: value => value,
    text: (value, fallback) => value == null || value === "" ? fallback : String(value),
    buildBridgeUrl: (env, path) => path,
    requestJson: () => new Promise(() => {})
  });
  const instance = mount({ id: "home" }, container, { selectWidget: (id, persist) => selections.push({ id, persist }) });
  return {
    document, window, scroller, container, content, outside, target, selections, instance, timers,
    listenerCount: () => targets.reduce((count, node) => count + [...node.listeners.values()].reduce((sum, handlers) => sum + handlers.length, 0), 0),
    emit(type, properties = {}, eventTarget = content) {
      let stopped = false;
      let immediatelyStopped = false;
      const event = {
        type, target: eventTarget, currentTarget: null, eventPhase: 0, bubbles: !["scroll", "blur"].includes(type),
        pointerId: 1, pointerType: "touch", button: 0, buttons: 1, isPrimary: true, clientX: 100, clientY: 100,
        preventDefault() { throw new Error("Home gesture must not block native scrolling"); },
        stopPropagation() { stopped = true; },
        stopImmediatePropagation() { stopped = true; immediatelyStopped = true; },
        ...properties
      };
      const path = [];
      for (let node = eventTarget; node; node = node.parentElement) path.unshift(node);
      if (path[0] === document) path.unshift(window);
      const invoke = (node, capture, phase) => {
        event.currentTarget = node; event.eventPhase = phase;
        for (const entry of [...(node.listeners.get(type) || [])]) {
          if (entry.capture !== capture || !(node.listeners.get(type) || []).includes(entry)) continue;
          if (entry.once) node.removeEventListener(type, entry.handler, entry.capture);
          entry.handler(event);
          if (immediatelyStopped) break;
        }
      };
      const ancestors = path.slice(0, -1);
      for (const node of ancestors) { invoke(node, true, 1); if (stopped) break; }
      if (!stopped) {
        invoke(eventTarget, true, 2);
        if (!immediatelyStopped) invoke(eventTarget, false, 2);
        if (event.bubbles && !stopped) for (const node of ancestors.reverse()) { invoke(node, false, 3); if (stopped) break; }
      }
      event.currentTarget = null; event.eventPhase = 0;
    },
    advance(milliseconds) {
      const until = clock + milliseconds;
      while (true) {
        const next = [...timers].filter(([, timer]) => timer.due <= until).sort((a, b) => a[1].due - b[1].due)[0];
        if (!next) break;
        timers.delete(next[0]); clock = next[1].due; next[1].handler();
      }
      clock = until;
    }
  };
}

function checkHomeLongPress() {
  let checks = 0;
  const check = (condition, message) => { assert(condition, `Home long press: ${message}`); checks += 1; };
  const propagation = homeGestureHarness();
  const order = [];
  const registrations = [];
  for (const [name, node] of [["window", propagation.window], ["document", propagation.document], ["container", propagation.container], ["content", propagation.content]]) {
    for (const capture of [false, true]) {
      const handler = event => order.push(`${name}-${capture ? "capture" : "bubble"}-${event.eventPhase}`);
      node.addEventListener("gesture-test", handler, { capture });
      registrations.push({ node, handler, capture });
    }
  }
  propagation.emit("gesture-test");
  check(order.join(",") === "window-capture-1,document-capture-1,container-capture-1,content-capture-2,content-bubble-2,container-bubble-3,document-bubble-3,window-bubble-3", "test dispatcher must use capture, target, and bubble order regardless of registration order");
  order.length = 0;
  propagation.emit("gesture-test", { bubbles: false });
  check(order.join(",") === "window-capture-1,document-capture-1,container-capture-1,content-capture-2,content-bubble-2", "non-bubbling events must still reach ancestor capture and both target phases");
  for (const { node, handler, capture } of registrations) node.removeEventListener("gesture-test", handler, capture);
  let captured = 0;
  const captureHandler = () => { captured += 1; };
  propagation.document.addEventListener("capture-cleanup-test", captureHandler, true);
  propagation.document.removeEventListener("capture-cleanup-test", captureHandler, false);
  propagation.emit("capture-cleanup-test");
  check(captured === 1, "listener removal with the wrong capture flag must not remove a capture listener");
  propagation.document.removeEventListener("capture-cleanup-test", captureHandler, { capture: true });
  propagation.emit("capture-cleanup-test");
  check(captured === 1, "matching capture-aware cleanup must remove the listener");
  propagation.instance.destroy();
  check(propagation.listenerCount() === 0, "all mounted capture and bubble listeners must be removed on destroy");
  const missingCaptureSource = homeSource.replace(/(addListener\(cleanups, document, "pointerdown", function \(event\) \{[\s\S]*?\}, \{ )capture: true(, passive: true \}\);)/, "$1capture: false$2");
  check(missingCaptureSource !== homeSource, "capture regression mutation must alter the real document pointerdown listener");
  const missingCapture = homeGestureHarness(missingCaptureSource);
  missingCapture.emit("pointerdown"); missingCapture.advance(700);
  check(missingCapture.selections.length === 0, "removing document capture must reproduce the ordering bug that the real-hold checks reject");
  missingCapture.instance.destroy();
  const jitter = homeGestureHarness();
  jitter.emit("pointerdown"); jitter.advance(200);
  jitter.emit("pointermove", { clientX: 103, clientY: 104 }); jitter.advance(499);
  check(jitter.selections.length === 0, "must wait the full 700ms hold");
  jitter.advance(1);
  check(jitter.selections.length === 1 && jitter.selections[0].id === "layout-editor" && jitter.selections[0].persist, "small stationary finger jitter must still open Customize Home after 700ms");
  jitter.advance(1400);
  check(jitter.selections.length === 1, "a held pointer must open only once");
  jitter.instance.destroy();

  for (const [name, x, y, opens] of [["stationary", 100, 100, true], ["six-pixel boundary", 106, 100, true], ["scroll intent", 100, 107, false], ["horizontal movement", 107, 100, false], ["diagonal movement", 105, 105, false]]) {
    const fixture = homeGestureHarness(); fixture.emit("pointerdown");
    fixture.emit("pointermove", { clientX: x, clientY: y }); fixture.advance(700);
    check(fixture.selections.length === Number(opens), `${name} must ${opens ? "allow" : "cancel"} the hold`); fixture.instance.destroy();
  }
  const drift = homeGestureHarness(); drift.emit("pointerdown");
  for (const x of [103, 105, 107, 100]) { drift.advance(100); drift.emit("pointermove", { clientX: x }); }
  drift.advance(700);
  check(drift.selections.length === 0, "movement is measured from the original touch, and returning must not rearm it"); drift.instance.destroy();

  for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) {
    const fixture = homeGestureHarness(); fixture.emit("pointerdown"); fixture.advance(600);
    fixture.emit(type, {}, fixture.outside); fixture.advance(700);
    check(fixture.selections.length === 0, `${type} outside Home must cancel the matching pointer`); fixture.instance.destroy();
  }
  const identity = homeGestureHarness(); identity.emit("pointerdown");
  identity.emit("pointermove", { pointerId: 9, clientX: 200 }, identity.outside);
  identity.emit("pointerup", { pointerId: 9 }, identity.outside); identity.advance(700);
  check(identity.selections.length === 1, "unrelated pointer movement/end must not cancel the active pointer"); identity.instance.destroy();

  for (const pointerType of ["mouse", "pen"]) {
    for (const buttons of [3, 2, 0, 5]) {
      const fixture = homeGestureHarness(); fixture.emit("pointerdown", { pointerType }); fixture.advance(400);
      fixture.emit("pointermove", { pointerType, button: -1, buttons }); fixture.advance(700);
      check(fixture.selections.length === 0, `${pointerType} buttons=${buttons} must cancel a chord or lost primary contact`); fixture.instance.destroy();
    }
    const fixture = homeGestureHarness(); fixture.emit("pointerdown", { pointerType });
    fixture.emit("pointermove", { pointerType, button: -1, buttons: 1, clientX: 103 }); fixture.advance(700);
    check(fixture.selections.length === 1, `${pointerType} primary-button jitter must still allow a hold`); fixture.instance.destroy();
  }
  const chord = homeGestureHarness(); chord.emit("pointerdown", { pointerType: "mouse" }); chord.advance(200);
  chord.emit("pointermove", { pointerType: "mouse", button: 2, buttons: 3 }); chord.advance(200);
  chord.emit("pointermove", { pointerType: "mouse", button: 0, buttons: 2 }); chord.advance(700);
  check(chord.selections.length === 0, "left down, right down, then left up must cancel even without a second pointerdown or pointerup"); chord.instance.destroy();
  const released = homeGestureHarness(); released.emit("pointerdown", { pointerType: "mouse" });
  released.emit("pointermove", { pointerType: "mouse", button: -1, buttons: 0 });
  released.emit("pointerdown", { pointerId: 2, pointerType: "touch" }); released.advance(700);
  check(released.selections.length === 1, "a fully released mouse must not remain a phantom contact that blocks the next touch"); released.instance.destroy();
  for (const pointerType of ["mouse", "pen"]) {
    const fixture = homeGestureHarness();
    const capturedNode = fixture.target(fixture.container);
    fixture.emit("pointerdown", {}, capturedNode);
    capturedNode.isConnected = false; capturedNode.parentElement = null;
    fixture.emit("lostpointercapture", {}, fixture.document);
    fixture.emit("pointerdown", { pointerId: 2, pointerType }); fixture.advance(700);
    check(fixture.selections.length === 0, `lost capture after node replacement must not forget a held touch and arm a new ${pointerType} hold`);
    fixture.emit("pointerup", { pointerId: 2, pointerType }); fixture.emit("pointerup");
    fixture.emit("pointerdown", { pointerId: 2, pointerType }); fixture.advance(700);
    check(fixture.selections.length === 1, `${pointerType} must work normally once both contacts have actually ended`); fixture.instance.destroy();
  }

  for (const properties of [{ button: 2 }, { button: 1 }, { isPrimary: false }, { pointerType: "mouse", buttons: 3 }, { pointerType: "pen", buttons: 2 }]) {
    const fixture = homeGestureHarness(); fixture.emit("pointerdown", properties); fixture.advance(700);
    check(fixture.selections.length === 0, "secondary buttons and nonprimary contacts must not start a hold"); fixture.instance.destroy();
  }
  for (const control of ["button", "a", "input", "select", "textarea", "summary", "[role='button']", "[contenteditable]"]) {
    const fixture = homeGestureHarness(); const child = fixture.target(fixture.target(fixture.container, control));
    fixture.emit("pointerdown", {}, child); fixture.advance(700);
    check(fixture.selections.length === 0, `holding inside ${control} must keep its normal interaction`); fixture.instance.destroy();
  }
  for (const second of [{ pointerId: 2, isPrimary: false }, { pointerId: 2, pointerType: "mouse", isPrimary: true }]) {
    for (const relation of ["outside", "content"]) {
      const fixture = homeGestureHarness(); fixture.emit("pointerdown"); fixture.advance(400);
      fixture.emit("pointerdown", second, fixture[relation]); fixture.emit("pointerup", second, fixture[relation]); fixture.advance(700);
      check(fixture.selections.length === 0, "another contact must cancel without restarting the original hold");
      fixture.emit("pointerup"); fixture.emit("pointerdown"); fixture.advance(700);
      check(fixture.selections.length === 1, "a fresh single-finger hold must work after multitouch ends"); fixture.instance.destroy();
    }
  }
  for (const type of ["scroll", "wheel"]) {
    for (const relation of ["scroller", "content"]) {
      const fixture = homeGestureHarness(); fixture.emit("pointerdown"); fixture.emit(type, {}, fixture[relation]); fixture.advance(700);
      check(fixture.selections.length === 0, `${type} on a related ${relation} must cancel`); fixture.instance.destroy();
    }
    const fixture = homeGestureHarness(); fixture.emit("pointerdown"); fixture.emit(type, {}, fixture.outside); fixture.advance(700);
    check(fixture.selections.length === 1, `unrelated ${type} must not cancel`); fixture.instance.destroy();
  }
  const scrolled = homeGestureHarness(); scrolled.emit("pointerdown"); scrolled.scroller.scrollTop = 1; scrolled.advance(700);
  check(scrolled.selections.length === 0, "actual scroll position changes must cancel even before their scroll event arrives"); scrolled.instance.destroy();
  for (const cause of ["blur", "hidden", "detached", "inert", "destroy"]) {
    const fixture = homeGestureHarness(); fixture.emit("pointerdown");
    if (cause === "blur") fixture.emit("blur", {}, fixture.window);
    if (cause === "hidden") { fixture.document.hidden = true; fixture.emit("visibilitychange", {}, fixture.document); }
    if (cause === "detached") fixture.container.isConnected = false;
    if (cause === "inert") fixture.scroller.control = "[inert]";
    if (cause === "destroy") fixture.instance.destroy();
    fixture.advance(700);
    check(fixture.selections.length === 0, `${cause} must not leave a delayed navigation`);
    if (cause !== "destroy") fixture.instance.destroy();
    check(fixture.timers.size === 0 && fixture.listenerCount() === 0, `${cause} cleanup must remove all gesture listeners and timers`);
  }
  console.log(`checked ${checks} deterministic Home long-press assertions`);
}

function checkAdventurePanelRouting() {
  const gameFaceTarget = dashboard.slice(
    dashboard.indexOf("  function isWowForeverGame("),
    dashboard.indexOf("  function clearPendingGameFaceAutoOpen(")
  );
  const openGameFace = dashboard.slice(
    dashboard.indexOf("  function openGameFaceForActiveId("),
    dashboard.indexOf("  function schedulePendingGameFaceAutoOpen(")
  );
  const pendingGameFace = dashboard.slice(
    dashboard.indexOf("  function maybeOpenPendingGameFace("),
    dashboard.indexOf("  function restorePreGamePerformanceBudget(")
  );
  for (const entrypoint of ["openGameFaceForActiveId('active-game')", "maybeOpenPendingGameFace()"] ) {
    for (const panel of ["wow-forever", "setup", "system"]) {
      const selections = [];
      const fixture = {
        currentWidgetId: panel,
        gameFaceSuppressedGameId: "",
        gameFaceAutoOpenedGameId: "",
        pendingGameFaceAutoOpenId: "active-game",
        gameActivity: { active: true },
        isGameFaceAutoOpenEnabled: () => true,
        activeGameIdFromPayload: () => "active-game",
        isDashboardBusyForGameFaceAutoOpen: () => false,
        clearPendingGameFaceAutoOpen() { fixture.pendingGameFaceAutoOpenId = ""; },
        getFallbackPrimaryWidget: () => "home",
        selectWidget: id => selections.push(id),
        showTouchFeedback() {}
      };
      runInNewContext(`${gameFaceTarget}\n${openGameFace}\n${pendingGameFace}\n${entrypoint};`, fixture);
      assert(selections.length === (panel === "system" ? 1 : 0), `${entrypoint}: game detection must preserve ${panel} or open normal Game Mode`);
      if (selections.length) assert(selections[0] === "game-mode", "ordinary panels must still open Game Mode");
    }
  }
  console.log("checked adventure panel navigation during immediate and deferred game detection");
}

checkAdventurePanelRouting();
checkHomeLongPress();
await import("./check-display-controls.mjs");
console.log("checked navigation catalog, Home gestures, and Display Controls behaviour");
