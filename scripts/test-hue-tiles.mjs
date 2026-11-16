// Smart Home > Lights: the room and light tiles, checked on what they render.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import vm from "node:vm";

let helpers = null;
const number = value => (value == null || value === "" || Number.isNaN(Number(value)) ? null : Number(value));
const runtime = {
  registerRenderer() {}, registerHelpers(value) { helpers = value; },
  clamp(value, minimum, maximum) { return Math.min(maximum, Math.max(minimum, Number(value) || 0)); },
  escapeHtml(value) { return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;"); },
  emptyState(title, copy) { return `<div class="empty">${title} ${copy}</div>`; },
  formatPercent(value) { return number(value) == null ? "--" : Math.round(number(value)) + "%"; },
  optionalNumber: number, nullableNumber: number,
  text(value, fallback = "") { return value == null || value === "" ? fallback : String(value); }
};
vm.runInNewContext(readFileSync(resolve(process.cwd(), "js/widgets/integrations.js"), "utf8"), { window: { InlineWidgets: { runtime } } });

const colors = item => { const value = helpers.hueTileColors(item); return value ? { top: value.top, deep: value.deep } : null; };
// Relative luminance of "hsl(210 60% 20%)", to check white text against it.
function luminance(hsl) {
  const [h, s, l] = hsl.match(/[\d.]+/g).map(Number);
  const c = (1 - Math.abs(2 * l / 100 - 1)) * s / 100, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = l / 100 - c / 2;
  const [r, g, b] = [[c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x]][Math.floor(h / 60) % 6].map(v => v + m)
    .map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const whiteContrast = hsl => 1.05 / (luminance(hsl) + 0.05);

test("a tile takes the lamps' colour, and a brighter lamp gives a lighter tile", () => {
  assert.deepEqual(colors({ on: true, brightness: 100, colorMode: "hs", hue: 0, saturation: 254 }), { top: "hsl(0 85% 24%)", deep: "hsl(0 85% 16%)" });
  assert.deepEqual(colors({ on: true, brightness: 0, colorMode: "hs", hue: 0, saturation: 254 }), { top: "hsl(0 85% 16%)", deep: "hsl(0 85% 10%)" });
  assert.deepEqual(colors({ on: true, brightness: 50, colorMode: "xy", hue: 43690, saturation: 127 }), { top: "hsl(240 50% 20%)", deep: "hsl(240 50% 12%)" });
});

test("white lamps are warm or cool by their colour temperature, and a plain lamp is warm", () => {
  assert.deepEqual(colors({ on: true, brightness: 100, colorMode: "ct", colorTemperature: 500, hue: 9000, saturation: 200 }), { top: "hsl(36 85% 24%)", deep: "hsl(36 85% 16%)" });
  assert.deepEqual(colors({ on: true, brightness: 100, colorMode: "ct", colorTemperature: 153 }), { top: "hsl(212 30% 24%)", deep: "hsl(212 30% 16%)" });
  assert.deepEqual(colors({ on: true, brightness: 100 }), { top: "hsl(40 45% 24%)", deep: "hsl(40 45% 16%)" });
});

test("a tile that is off or out of reach stays plain", () => {
  assert.equal(colors({ on: false, brightness: 80, colorMode: "hs", hue: 0, saturation: 254 }), null);
  assert.equal(colors({ on: true, reachable: false, brightness: 80 }), null);
  assert.equal(colors(null), null);
});

test("white text is readable on every colour a tile can take", () => {
  for (let hue = 0; hue <= 65535; hue += 1285) {
    for (const saturation of [0, 127, 254]) {
      for (const brightness of [0, 50, 100]) {
        const value = colors({ on: true, brightness, colorMode: "hs", hue, saturation });
        for (const stop of [value.top, value.deep]) assert.ok(whiteContrast(stop) >= 4.5, `${stop} gives ${whiteContrast(stop).toFixed(2)}`);
      }
    }
  }
  for (let warmth = 153; warmth <= 500; warmth += 31) {
    const value = colors({ on: true, brightness: 100, colorMode: "ct", colorTemperature: warmth });
    assert.ok(whiteContrast(value.top) >= 4.5, `${value.top} gives ${whiteContrast(value.top).toFixed(2)}`);
  }
});

test("each room and light is one tile with its switch and its brightness inside it", () => {
  const data = {
    configured: true, linked: true, bridgeName: "Hue Bridge", bridgeIp: "192.168.1.20",
    groups: [{ id: "1", name: "Office", on: true, brightness: 80, lights: 3, colorMode: "hs", hue: 46920, saturation: 230 }, { id: "2", name: "Bedroom", on: false, brightness: 0, lights: 1 }],
    lights: [{ id: "11", name: "Desk lamp", on: true, brightness: 60, reachable: true }, { id: "12", name: "Hallway", on: true, brightness: 30, reachable: false }]
  };
  const html = helpers.renderHueWidget({ data, busy: false, statusTone: "good", statusText: "" });
  const tiles = html.split('<div class="inline-list-item hue-tile"').slice(1);
  assert.equal(tiles.length, 4);
  assert.match(tiles[0], /^ data-on="true" style="--hue-tile-top:hsl\(258 85% 22%\);--hue-tile-deep:hsl\(258 85% 14%\)"/);
  assert.match(tiles[0], /Office<\/div><div class="inline-list-copy">3 lights</);
  assert.match(tiles[0], /data-action="toggle-group" data-id="1" aria-label="Turn off Office">On<\/button>/);
  assert.match(tiles[0], /<strong>80%<\/strong><input class="inline-range"[^>]*data-action="brightness-group" data-id="1">/);
  assert.match(tiles[1], /^ data-on="false">/);
  assert.match(tiles[1], />1 light</);
  assert.match(tiles[1], /aria-label="Turn on Bedroom">Off</);
  assert.match(tiles[2], /data-action="toggle-light" data-id="11"/);
  assert.match(tiles[3], /^ data-on="false">[\s\S]*Not reachable[\s\S]*data-action="toggle-light" data-id="12"[^>]* disabled>/);
  // Taps are read from the button itself, so a switch must hold text only.
  for (const button of html.match(/<button class="inline-button[^>]*data-action="toggle-[^>]*>[\s\S]*?<\/button>/g)) assert.match(button, />(On|Off)<\/button>$/);
  assert.match(html, /<details class="hue-bridge" data-preserve-open>/);
});
