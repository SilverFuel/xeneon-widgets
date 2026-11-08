// Regression: a touch on blank space must not apply press styling to <html> or <body>.
// The theme runtime sets [data-theme] on both roots, and that selector is also a touch-interactive
// marker for theme swatches. Before the fix, a stationary touch longer than the press delay put
// .is-touch-pressing on <body>, and css/widgets/product.css scaled the whole page to 0.985.
// Runs the real js/widget-core.js in a VM with a minimal DOM and a fake clock. No browser, no device.
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const source = readFileSync(new URL("../js/widget-core.js", import.meta.url), "utf8");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function makeElement(name, simpleSelectors, parent) {
  const classes = new Set();
  const element = {
    nodeType: 1,
    tagName: name.toUpperCase(),
    parentElement: parent || null,
    disabled: false,
    scrollTop: 0,
    scrollLeft: 0,
    scrollHeight: 0,
    clientHeight: 0,
    scrollWidth: 0,
    clientWidth: 0,
    classList: {
      add: (value) => classes.add(value),
      remove: (value) => classes.delete(value),
      contains: (value) => classes.has(value)
    },
    getAttribute: () => null,
    matches(selectorList) {
      return selectorList.split(",").some((selector) => simpleSelectors.includes(selector.trim()));
    },
    closest(selectorList) {
      for (let node = element; node; node = node.parentElement) {
        if (node.matches(selectorList)) return node;
      }
      return null;
    },
    contains(other) {
      for (let node = other; node; node = node.parentElement) {
        if (node === element) return true;
      }
      return false;
    }
  };
  return element;
}

const html = makeElement("html", ["[data-theme]"]);
const body = makeElement("body", ["[data-theme]"], html);
const blank = makeElement("div", [], body);
const swatch = makeElement("button", ["button", "[data-theme]", ".product-swatch"], body);
const range = makeElement("input", ["input[type='range']"], body);

const listeners = {};
const timers = [];
let now = 1000;
const document = {
  documentElement: html,
  body,
  addEventListener(type, handler) {
    (listeners[type] = listeners[type] || []).push(handler);
  }
};
const window = {
  innerHeight: 720,
  innerWidth: 2560,
  scrollX: 0,
  scrollY: 0,
  getComputedStyle: () => ({ overflowX: "visible", overflowY: "visible" }),
  setTimeout(callback, delay) {
    timers.push({ at: now + delay, callback });
    return timers.length;
  },
  clearTimeout(id) {
    if (timers[id - 1]) timers[id - 1].callback = null;
  },
  location: { search: "" },
  addEventListener() {}
};
html.scrollHeight = 720;
html.scrollWidth = 2560;

runInNewContext(source, {
  window,
  document,
  Date: { now: () => now },
  URLSearchParams,
  console
});

function advance(ms) {
  now += ms;
  for (const timer of timers) {
    if (timer.callback && timer.at <= now) {
      const callback = timer.callback;
      timer.callback = null;
      callback();
    }
  }
}

function dispatch(type, target, extra = {}) {
  const event = {
    type,
    target,
    pointerType: "touch",
    isPrimary: true,
    pointerId: 7,
    clientX: 400,
    clientY: 300,
    defaultPrevented: false,
    preventDefault() { this.defaultPrevented = true; },
    stopImmediatePropagation() { this.stopped = true; },
    ...extra
  };
  for (const handler of listeners[type] || []) handler(event);
  return event;
}

assert(typeof window.WidgetCore?.installTouchControls === "function", "widget-core.js must load in the harness");

// 1. Stationary hold on blank space: neither root receives press styling.
dispatch("pointerdown", blank);
advance(300);
assert(!body.classList.contains("is-touch-pressing"), "blank-space touch must not press <body> (scales the whole dashboard)");
assert(!html.classList.contains("is-touch-pressing"), "blank-space touch must not press <html>");
dispatch("pointerup", blank);

// 2. Stationary hold on a range input with no interactive ancestor: no root press styling.
dispatch("pointerdown", range);
advance(300);
assert(!body.classList.contains("is-touch-pressing"), "range touch must not press <body>");
dispatch("pointerup", range);

// 3. A real [data-theme] swatch keeps its press feedback.
dispatch("pointerdown", swatch);
advance(300);
assert(swatch.classList.contains("is-touch-pressing"), "theme swatch must still receive press feedback");
dispatch("pointerup", swatch);
assert(!swatch.classList.contains("is-touch-pressing"), "swatch press feedback must clear on release");

// 4. A tap (no movement) on a swatch is not click-suppressed.
const click = dispatch("click", swatch, { pointerType: undefined });
assert(!click.defaultPrevented && !click.stopped, "an unmoved tap must not suppress its click");

console.log("touch root-press regression passed (4 cases; real widget-core.js, fake DOM and clock)");
