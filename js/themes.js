// Auxora themes: the one place theme colours are defined.
//
// To add a theme, add one object to `themes` below. Nothing else needs to change:
// the picker, the Profile editor, the dashboard and the standalone pages all read
// this table, and the native host accepts any well-formed theme id.
//
// A theme is five colours. Every other token is derived from them in deriveTokens().
// Focus, Gaming and Warm predate this table; their `tokens` hold the exact values they
// shipped with so nobody's colours change on upgrade. A theme with `tokens` is not derived.
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.AuxoraThemes = api;
    if (root.document) {
      api.install(root.document);
    }
  }
}(typeof window !== "undefined" ? window : null, function () {
  "use strict";

  var defaultThemeId = "focus";
  var legacyAliases = { edge: "focus", deepcore: "gaming", afterburn: "warm", verdant: "focus" };

  var themes = [
    {
      id: "focus", name: "Focus", scheme: "light",
      page: "#f4f5f7", surface: "#ffffff", text: "#172b46", accent: "#2b4d7d", secondary: "#d4ac63",
      // Focus is the default token block in css/theme.css, so it adds nothing here.
      tokens: {}
    },
    {
      id: "gaming", name: "Gaming", scheme: "dark",
      page: "#132238", surface: "#1b304d", text: "#f4f5f7", accent: "#d4ac63", secondary: "#e56335",
      tokens: {
        "--theme-page": "#132238",
        "--theme-surface-primary": "#1b304d",
        "--theme-surface-secondary": "#162940",
        "--theme-surface-elevated": "#223c5e",
        "--theme-surface-primary-rgb": "27, 48, 77",
        "--theme-surface-secondary-rgb": "22, 41, 64",
        "--theme-surface-elevated-rgb": "34, 60, 94",
        "--theme-surface-muted": "rgba(244, 245, 247, 0.045)",
        "--theme-border": "rgba(212, 172, 99, 0.25)",
        "--theme-border-strong": "rgba(212, 172, 99, 0.52)",
        "--theme-text": "#f4f5f7",
        "--theme-text-muted": "#b9c9dc",
        "--theme-accent": "#d4ac63",
        "--theme-accent-secondary": "#e56335",
        "--theme-on-accent": "#132238",
        "--theme-accent-soft": "rgba(212, 172, 99, 0.12)",
        "--theme-accent-border": "rgba(212, 172, 99, 0.52)",
        "--theme-accent-glow": "rgba(212, 172, 99, 0.15)",
        "--theme-selected-surface": "rgba(212, 172, 99, 0.16)",
        "--theme-hover-surface": "rgba(244, 245, 247, 0.07)",
        "--theme-pressed-surface": "rgba(229, 99, 53, 0.18)",
        "--theme-focus-ring": "#d4ac63",
        "--theme-ambient-primary": "rgba(43, 77, 125, 0.18)",
        "--theme-ambient-secondary": "rgba(229, 99, 53, 0.065)",
        "--theme-ambient-rim": "rgba(212, 172, 99, 0.12)",
        "--theme-vignette": "rgba(6, 15, 29, 0.5)",
        "--theme-panel-shadow": "0 20px 50px rgba(6, 15, 29, 0.4)",
        "--theme-inner-highlight": "rgba(244, 245, 247, 0.07)",
        "--theme-motion-scale": "0.8",
        "--theme-motion-duration": "180ms",
        "--theme-glow-intensity": "0.9",
        "--theme-panel-radius": "12px",
        "--theme-panel-blur": "8px",
        "--theme-ambient-canvas-c": "#cd2435",
        "--status-success-text": "#b6d1f4",
        "--status-success-surface": "rgba(43, 77, 125, 0.22)",
        "--status-success-border": "rgba(182, 209, 244, 0.46)",
        "--status-warning-text": "#ffc19c",
        "--status-warning-surface": "rgba(229, 99, 53, 0.12)",
        "--status-warning-border": "rgba(255, 193, 156, 0.46)",
        "--status-danger-text": "#ffbdc6",
        "--status-danger-surface": "rgba(205, 36, 53, 0.13)",
        "--status-danger-border": "rgba(255, 189, 198, 0.46)"
      }
    },
    {
      id: "warm", name: "Warm", scheme: "light",
      page: "#f5f1e9", surface: "#fffaf2", text: "#302c27", accent: "#e56335", secondary: "#d4ac63",
      tokens: {
        "--theme-page": "#f5f1e9",
        "--theme-surface-primary": "#fffaf2",
        "--theme-surface-secondary": "#ebe3d6",
        "--theme-surface-elevated": "#ffffff",
        "--theme-surface-primary-rgb": "255, 250, 242",
        "--theme-surface-secondary-rgb": "235, 227, 214",
        "--theme-surface-elevated-rgb": "255, 255, 255",
        "--theme-surface-muted": "rgba(120, 70, 34, 0.055)",
        "--theme-border": "rgba(123, 82, 40, 0.26)",
        "--theme-border-strong": "rgba(148, 54, 15, 0.48)",
        "--theme-text": "#302c27",
        "--theme-text-muted": "#6b5949",
        "--theme-accent": "#e56335",
        "--theme-accent-secondary": "#d4ac63",
        "--theme-on-accent": "#1d1c1a",
        "--theme-accent-soft": "rgba(229, 99, 53, 0.085)",
        "--theme-accent-border": "rgba(148, 54, 15, 0.48)",
        "--theme-accent-glow": "rgba(229, 99, 53, 0.1)",
        "--theme-selected-surface": "rgba(229, 99, 53, 0.13)",
        "--theme-hover-surface": "rgba(120, 70, 34, 0.065)",
        "--theme-pressed-surface": "rgba(212, 172, 99, 0.2)",
        "--theme-focus-ring": "#94360f",
        "--theme-ambient-primary": "rgba(229, 99, 53, 0.045)",
        "--theme-ambient-secondary": "rgba(212, 172, 99, 0.1)",
        "--theme-ambient-rim": "rgba(212, 172, 99, 0.15)",
        "--theme-vignette": "rgba(104, 69, 30, 0.04)",
        "--theme-panel-shadow": "0 18px 44px rgba(90, 61, 28, 0.1)",
        "--theme-inner-highlight": "rgba(255, 255, 255, 0.75)",
        "--theme-motion-scale": "0.35",
        "--theme-motion-duration": "90ms",
        "--theme-glow-intensity": "0.45",
        "--theme-panel-radius": "20px",
        "--theme-panel-blur": "12px",
        "--theme-ambient-canvas-c": "#2b4d7d",
        "--theme-accent-text": "#94360f"
      }
    },
    { id: "horde", name: "Horde", scheme: "dark", page: "#140a0a", surface: "#221010", text: "#f3e6dc", accent: "#e24a3e", secondary: "#d9a441" },
    { id: "alliance", name: "Alliance", scheme: "dark", page: "#0b1526", surface: "#13233d", text: "#e8eef8", accent: "#4f8fe6", secondary: "#e2b54a" },
    { id: "midnight", name: "Midnight", scheme: "dark", page: "#0a0d12", surface: "#141922", text: "#e6ebf2", accent: "#38bdf8", secondary: "#a78bfa" },
    { id: "ember", name: "Ember", scheme: "dark", page: "#15110e", surface: "#211a15", text: "#f2e9e1", accent: "#ff7a33", secondary: "#ffc857" },
    { id: "forest", name: "Forest", scheme: "dark", page: "#0c1410", surface: "#14211a", text: "#e4efe7", accent: "#4ade80", secondary: "#d9b25f" },
    { id: "synthwave", name: "Synthwave", scheme: "dark", page: "#140b24", surface: "#1f1238", text: "#f1e9ff", accent: "#ff5fa8", secondary: "#35d6ff" },
    { id: "terminal", name: "Terminal", scheme: "dark", page: "#050805", surface: "#0d140d", text: "#d6f5d6", accent: "#39e75f", secondary: "#b6f09c" },
    { id: "ocean", name: "Ocean", scheme: "dark", page: "#071a1f", surface: "#0e2a31", text: "#e2f4f6", accent: "#2dd4bf", secondary: "#7dd3fc" },
    { id: "rose", name: "Rose", scheme: "dark", page: "#1a0f16", surface: "#281722", text: "#f7e8ef", accent: "#fb7185", secondary: "#f0abfc" },
    { id: "slate", name: "Slate", scheme: "dark", page: "#11161b", surface: "#1b232b", text: "#e5eaf0", accent: "#8fb4d9", secondary: "#f0b86e" },
    { id: "mono", name: "Mono", scheme: "dark", page: "#0c0c0d", surface: "#18181a", text: "#f2f2f3", accent: "#e5e5e7", secondary: "#8e8e93" },
    { id: "arctic", name: "Arctic", scheme: "light", page: "#f2f7fb", surface: "#ffffff", text: "#12283a", accent: "#0b6fa4", secondary: "#5b8def" },
    { id: "sand", name: "Sand", scheme: "light", page: "#f6f1e7", surface: "#fffaf2", text: "#33291c", accent: "#8a5a1f", secondary: "#c2703d" }
  ];

  function parseHex(value) {
    var match = String(value || "").trim().match(/^#?([0-9a-f]{6})$/i);
    return match ? "#" + match[1].toLowerCase() : null;
  }

  function toRgb(value) {
    var hex = parseHex(value) || "#000000";
    return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
  }

  function toHex(rgb) {
    return "#" + rgb.map(function (part) {
      return Math.max(0, Math.min(255, Math.round(part))).toString(16).padStart(2, "0");
    }).join("");
  }

  function mix(from, to, amount) {
    var a = toRgb(from);
    var b = toRgb(to);
    return toHex([a[0] + (b[0] - a[0]) * amount, a[1] + (b[1] - a[1]) * amount, a[2] + (b[2] - a[2]) * amount]);
  }

  function rgba(value, alpha) {
    return "rgba(" + toRgb(value).join(", ") + ", " + alpha + ")";
  }

  function luminance(value) {
    var parts = toRgb(value).map(function (part) {
      var unit = part / 255;
      return unit <= 0.04045 ? unit / 12.92 : Math.pow((unit + 0.055) / 1.055, 2.4);
    });
    return (0.2126 * parts[0]) + (0.7152 * parts[1]) + (0.0722 * parts[2]);
  }

  function contrast(foreground, background) {
    var a = luminance(foreground);
    var b = luminance(background);
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  }

  function onColor(fill) {
    return contrast("#000000", fill) >= contrast("#ffffff", fill) ? "#000000" : "#ffffff";
  }

  // Moves `color` toward `toward` until it reaches `ratio` against every background.
  function readable(color, backgrounds, toward, ratio) {
    var step;
    var candidate = color;
    function worst(value) {
      return Math.min.apply(null, backgrounds.map(function (background) { return contrast(value, background); }));
    }
    for (step = 0; step <= 20 && worst(candidate) < ratio; step += 1) {
      candidate = mix(color, toward, step / 20);
    }
    return candidate;
  }

  function deriveTokens(theme) {
    var dark = theme.scheme !== "light";
    var page = theme.page;
    var surface = theme.surface;
    var text = theme.text;
    var accent = theme.accent;
    var secondary = theme.secondary;
    var surfaceSecondary = mix(surface, page, 0.5);
    var surfaceElevated = dark ? mix(surface, "#ffffff", 0.08) : mix(surface, "#ffffff", 0.6);
    var surfaces = [page, surface, surfaceSecondary, surfaceElevated];
    var shade = mix(page, "#000000", 0.6);
    // The selected section tab is read from across the desk, so it needs 7:1.
    var sectionFill = [accent, secondary, text].filter(function (fill) {
      return contrast(onColor(fill), fill) >= 7;
    })[0] || text;
    var tokens = {
      "--theme-page": page,
      "--theme-surface-primary": surface,
      "--theme-surface-secondary": surfaceSecondary,
      "--theme-surface-elevated": surfaceElevated,
      "--theme-surface-primary-rgb": toRgb(surface).join(", "),
      "--theme-surface-secondary-rgb": toRgb(surfaceSecondary).join(", "),
      "--theme-surface-elevated-rgb": toRgb(surfaceElevated).join(", "),
      "--theme-surface-muted": rgba(text, 0.045),
      "--theme-border": rgba(accent, 0.25),
      "--theme-border-strong": rgba(accent, 0.52),
      "--theme-text": text,
      "--theme-text-muted": readable(mix(text, page, 0.3), surfaces, text, 4.5),
      "--theme-accent": accent,
      "--theme-accent-text": readable(accent, surfaces, text, 4.5),
      "--theme-accent-secondary": secondary,
      "--theme-on-accent": onColor(accent),
      "--theme-accent-soft": rgba(accent, 0.12),
      "--theme-accent-border": rgba(accent, 0.52),
      "--theme-accent-glow": rgba(accent, 0.15),
      "--theme-selected-surface": rgba(accent, 0.16),
      "--theme-section-selected": sectionFill,
      "--theme-on-section-selected": onColor(sectionFill),
      "--theme-hover-surface": rgba(text, 0.07),
      "--theme-pressed-surface": rgba(secondary, 0.18),
      "--theme-focus-ring": readable(accent, [page, surface], text, 3),
      "--theme-ambient-primary": rgba(accent, dark ? 0.1 : 0.04),
      "--theme-ambient-secondary": rgba(secondary, 0.065),
      "--theme-ambient-rim": rgba(secondary, 0.12),
      "--theme-vignette": dark ? rgba(shade, 0.5) : rgba(accent, 0.04),
      "--theme-panel-shadow": dark ? "0 20px 50px " + rgba(shade, 0.4) : "0 18px 42px " + rgba(text, 0.1),
      "--theme-inner-highlight": dark ? rgba(text, 0.07) : "rgba(255, 255, 255, 0.8)",
      "--theme-ambient-canvas-c": mix(accent, secondary, 0.5)
    };
    if (dark) {
      // Light status text on tinted fills, readable on any dark surface.
      tokens["--status-success-text"] = "#b6d1f4";
      tokens["--status-success-surface"] = "rgba(43, 77, 125, 0.22)";
      tokens["--status-success-border"] = "rgba(182, 209, 244, 0.46)";
      tokens["--status-warning-text"] = "#ffc19c";
      tokens["--status-warning-surface"] = "rgba(229, 99, 53, 0.12)";
      tokens["--status-warning-border"] = "rgba(255, 193, 156, 0.46)";
      tokens["--status-danger-text"] = "#ffbdc6";
      tokens["--status-danger-surface"] = "rgba(205, 36, 53, 0.13)";
      tokens["--status-danger-border"] = "rgba(255, 189, 198, 0.46)";
    }
    return tokens;
  }

  function tokensFor(theme) {
    return theme.tokens ? theme.tokens : deriveTokens(theme);
  }

  function normalizeId(value) {
    var requested = String(value || "").trim().toLowerCase();
    requested = legacyAliases[requested] || requested;
    return themes.some(function (theme) { return theme.id === requested; }) ? requested : defaultThemeId;
  }

  function get(value) {
    var id = normalizeId(value);
    return themes.filter(function (theme) { return theme.id === id; })[0];
  }

  function cssText() {
    return themes.map(function (theme) {
      var tokens = tokensFor(theme);
      return ':root[data-theme="' + theme.id + '"] {\n  color-scheme: ' + (theme.scheme === "light" ? "light" : "dark") + ";\n" +
        Object.keys(tokens).map(function (name) { return "  " + name + ": " + tokens[name] + ";\n"; }).join("") + "}\n";
    }).join("\n");
  }

  // The rules go first in <head> so the Night, readability and forced-colors rules in
  // css/theme.css still override them, exactly as they overrode the old per-theme blocks.
  function install(doc) {
    var head = doc && doc.head;
    var style;
    if (!head || !doc.createElement || (doc.getElementById && doc.getElementById("auxora-themes"))) {
      return;
    }
    style = doc.createElement("style");
    style.id = "auxora-themes";
    style.textContent = cssText();
    head.insertBefore(style, head.firstChild);
  }

  return {
    defaultThemeId: defaultThemeId,
    list: themes,
    get: get,
    normalizeId: normalizeId,
    tokensFor: tokensFor,
    contrast: contrast,
    cssText: cssText,
    install: install
  };
}));
