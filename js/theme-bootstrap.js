(function () {
  "use strict";

  var settingsStorageKey = "xeneon-dashboard-settings";
  var defaultSettings = {
    themeSchemaVersion: "2",
    themeId: "focus",
    accentMode: "preset",
    customAccentColor: "",
    accentColor: "",
    themeVariant: "auto",
    animationIntensity: "25",
    performanceBudget: "balanced",
    themeReadability: "normal"
  };
  var themeBackgrounds = {
    focus: "#0b0e12",
    gaming: "#05060a",
    warm: "#120c0d"
  };
  var themeOverrideProperties = [
    "--theme-accent",
    "--theme-accent-text",
    "--theme-accent-secondary",
    "--theme-on-accent",
    "--theme-accent-soft",
    "--theme-accent-border",
    "--theme-accent-glow",
    "--color-accent",
    "--color-accent-soft",
    "--dashboard-accent",
    "--dashboard-secondary",
    "--dashboard-warm",
    "--dashboard-accent-glow",
    "--dashboard-secondary-glow",
    "--dashboard-warm-glow",
    "--dashboard-theme-bg"
  ];
  var reducedMotionQuery = window.matchMedia
    ? window.matchMedia("(prefers-reduced-motion: reduce)")
    : null;
  var currentSettings = null;
  var sourceGeneration = 0;

  function hasOwn(source, key) {
    return Object.prototype.hasOwnProperty.call(source, key);
  }

  function normalizeChoice(value, fallback, allowed) {
    var normalized = String(value || "").trim().toLowerCase();
    return allowed.indexOf(normalized) >= 0 ? normalized : fallback;
  }

  function normalizeThemeId(value) {
    var requested = String(value || "").trim().toLowerCase();
    var aliases = {
      edge: "focus",
      deepcore: "gaming",
      afterburn: "warm",
      verdant: "focus"
    };
    requested = aliases[requested] || requested;
    return ["focus", "gaming", "warm"].indexOf(requested) === -1 ? "focus" : requested;
  }

  function normalizeAccentMode(value) {
    return String(value || "").trim().toLowerCase() === "custom" ? "custom" : "preset";
  }

  function normalizeThemeVariantPreference(value) {
    return normalizeChoice(value, "auto", ["auto", "standard", "night"]);
  }

  function normalizeAnimationPercent(value) {
    var parsed = Number(value);
    if (!Number.isFinite(parsed)) {
      return 100;
    }
    return Math.max(0, Math.min(140, Math.round(parsed)));
  }

  function parseHexColor(value) {
    var match = String(value || "").trim().match(/^#?([0-9a-f]{6})$/i);
    return match ? "#" + match[1].toLowerCase() : null;
  }

  function hexToRgb(value) {
    var normalized = parseHexColor(value);
    if (!normalized) {
      return null;
    }
    return {
      r: parseInt(normalized.slice(1, 3), 16),
      g: parseInt(normalized.slice(3, 5), 16),
      b: parseInt(normalized.slice(5, 7), 16)
    };
  }

  function rgbaFromHex(value, alpha) {
    var rgb = hexToRgb(value);
    if (!rgb) {
      return "rgba(0, 224, 255, " + alpha + ")";
    }
    return "rgba(" + rgb.r + ", " + rgb.g + ", " + rgb.b + ", " + alpha + ")";
  }

  function rgbToHex(rgb) {
    function toHex(value) {
      return Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, "0");
    }
    return "#" + toHex(rgb.r) + toHex(rgb.g) + toHex(rgb.b);
  }

  function mixHexColors(value, target, amount) {
    var sourceRgb = hexToRgb(value);
    var targetRgb = hexToRgb(target);
    if (!sourceRgb || !targetRgb) {
      return null;
    }
    return rgbToHex({
      r: sourceRgb.r + ((targetRgb.r - sourceRgb.r) * amount),
      g: sourceRgb.g + ((targetRgb.g - sourceRgb.g) * amount),
      b: sourceRgb.b + ((targetRgb.b - sourceRgb.b) * amount)
    });
  }

  function relativeLuminanceForHex(value) {
    var rgb = hexToRgb(value);

    function channel(valuePart) {
      var normalized = valuePart / 255;
      return normalized <= 0.04045
        ? normalized / 12.92
        : Math.pow((normalized + 0.055) / 1.055, 2.4);
    }

    if (!rgb) {
      return null;
    }
    return (0.2126 * channel(rgb.r)) + (0.7152 * channel(rgb.g)) + (0.0722 * channel(rgb.b));
  }

  function contrastRatioForHex(foreground, background) {
    var foregroundLuminance = relativeLuminanceForHex(foreground);
    var backgroundLuminance = relativeLuminanceForHex(background);
    var lighter;
    var darker;
    if (foregroundLuminance === null || backgroundLuminance === null) {
      return 0;
    }
    lighter = Math.max(foregroundLuminance, backgroundLuminance);
    darker = Math.min(foregroundLuminance, backgroundLuminance);
    return (lighter + 0.05) / (darker + 0.05);
  }

  function contrastSafeTextColor(value) {
    var normalized = parseHexColor(value);
    if (!normalized) {
      return "#ffffff";
    }
    return contrastRatioForHex("#000000", normalized) >= contrastRatioForHex("#ffffff", normalized)
      ? "#000000"
      : "#ffffff";
  }

  function contrastSafeAccentTextColor(value, backgrounds) {
    var normalized = parseHexColor(value);
    var validBackgrounds = (backgrounds || []).map(parseHexColor).filter(Boolean);
    var best = null;

    function minimumContrast(candidate) {
      return validBackgrounds.reduce(function (minimum, background) {
        return Math.min(minimum, contrastRatioForHex(candidate, background));
      }, Number.POSITIVE_INFINITY);
    }

    if (!normalized || !validBackgrounds.length) {
      return "#ffffff";
    }
    if (minimumContrast(normalized) >= 4.5) {
      return normalized;
    }

    ["#ffffff", "#000000"].forEach(function (target) {
      var step;
      for (step = 1; step <= 100; step += 1) {
        var candidate = mixHexColors(normalized, target, step / 100);
        var ratio = minimumContrast(candidate);
        if (ratio >= 4.5) {
          if (!best || step < best.step || (step === best.step && ratio > best.ratio)) {
            best = { color: candidate, step: step, ratio: ratio };
          }
          break;
        }
      }
    });

    if (best) {
      return best.color;
    }
    return minimumContrast("#ffffff") >= minimumContrast("#000000") ? "#ffffff" : "#000000";
  }

  function readStoredSettings() {
    try {
      var raw = window.localStorage.getItem(settingsStorageKey);
      var parsed = raw ? JSON.parse(raw) : {};
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch (error) {
      return {};
    }
  }

  function migrateThemeSettings(settings) {
    var source = settings && typeof settings === "object" && !Array.isArray(settings) ? settings : {};
    var migrated = {};
    var legacyVersion;
    var legacyAccent;
    var customAccent;
    var oldPresetAccents = ["#00e0ff", "#7a5cff", "#ff4d8d", "#44f0c2"];

    Object.keys(source).forEach(function (key) {
      migrated[key] = source[key];
    });

    legacyVersion = String(migrated.themeSchemaVersion || "") !== "2";
    legacyAccent = parseHexColor(migrated.accentColor);
    customAccent = parseHexColor(migrated.customAccentColor);
    migrated.themeId = normalizeThemeId(migrated.themeId);
    migrated.themeVariant = normalizeThemeVariantPreference(migrated.themeVariant);

    if (legacyVersion) {
      if (legacyAccent && oldPresetAccents.indexOf(legacyAccent) === -1) {
        migrated.accentMode = "custom";
        migrated.customAccentColor = legacyAccent;
      } else if (normalizeAccentMode(migrated.accentMode) === "custom" && customAccent) {
        migrated.accentMode = "custom";
        migrated.customAccentColor = customAccent;
      } else {
        migrated.accentMode = "preset";
        migrated.customAccentColor = "";
      }
    } else if (normalizeAccentMode(migrated.accentMode) === "custom" && customAccent) {
      migrated.accentMode = "custom";
      migrated.customAccentColor = customAccent;
    } else {
      migrated.accentMode = "preset";
      migrated.customAccentColor = "";
    }

    migrated.accentColor = "";
    migrated.themeSchemaVersion = "2";
    return migrated;
  }

  function buildSettings(stored) {
    var migrated = migrateThemeSettings(stored);
    var merged = {};

    Object.keys(defaultSettings).forEach(function (key) {
      merged[key] = hasOwn(migrated, key) && migrated[key] != null ? migrated[key] : defaultSettings[key];
    });
    Object.keys(migrated).forEach(function (key) {
      if (!hasOwn(merged, key)) {
        merged[key] = migrated[key];
      }
    });

    merged.themeId = normalizeThemeId(merged.themeId);
    merged.accentMode = normalizeAccentMode(merged.accentMode);
    merged.themeVariant = normalizeThemeVariantPreference(merged.themeVariant);
    merged.performanceBudget = normalizeChoice(merged.performanceBudget, "balanced", ["balanced", "battery", "game", "max"]);
    merged.themeReadability = normalizeChoice(merged.themeReadability, "normal", ["normal", "clean", "high-contrast", "visor"]);
    merged.animationIntensity = normalizeAnimationPercent(merged.animationIntensity);
    return merged;
  }

  function hasExplicitStoredThemeSelection(settings) {
    return hasOwn(settings, "themeId")
      || hasOwn(settings, "accentMode")
      || hasOwn(settings, "customAccentColor");
  }

  function mergeNativeDashboardSettings(stored, dashboard) {
    var merged = {};
    var nativeDashboard = dashboard && typeof dashboard === "object" && !Array.isArray(dashboard)
      ? dashboard
      : {};

    Object.keys(stored).forEach(function (key) {
      merged[key] = stored[key];
    });

    ["performanceBudget", "themeReadability", "animationIntensity"].forEach(function (key) {
      if (!hasOwn(stored, key) && nativeDashboard[key] != null) {
        merged[key] = nativeDashboard[key];
      }
    });

    if (!hasExplicitStoredThemeSelection(stored) && nativeDashboard.themeId) {
      ["themeId", "accentMode", "customAccentColor", "themeVariant"].forEach(function (key) {
        if (nativeDashboard[key] != null) {
          merged[key] = nativeDashboard[key];
        }
      });
      merged.themeSchemaVersion = "2";
      merged.accentColor = "";
    }

    return merged;
  }

  function resolveThemeVariant(settings) {
    var preference = normalizeThemeVariantPreference(settings.themeVariant);
    var hour;
    if (preference !== "auto") {
      return preference;
    }
    hour = new Date().getHours();
    return hour >= 22 || hour < 7 ? "night" : "standard";
  }

  function effectiveAnimationIntensity(settings) {
    var intensity = normalizeAnimationPercent(settings.animationIntensity);
    if (settings.performanceBudget === "battery") {
      return Math.min(intensity, 18);
    }
    if (settings.performanceBudget === "game") {
      return Math.min(intensity, 32);
    }
    return intensity;
  }

  function getThemeSurfaceColors(themeId) {
    var style;
    var colors = [];
    try {
      style = window.getComputedStyle(document.documentElement);
      colors = [
        style.getPropertyValue("--theme-page").trim(),
        style.getPropertyValue("--theme-surface-primary").trim(),
        style.getPropertyValue("--theme-surface-secondary").trim(),
        style.getPropertyValue("--theme-surface-elevated").trim()
      ];
    } catch (error) {
      colors = [];
    }
    colors.push(themeBackgrounds[themeId]);
    return colors.filter(Boolean);
  }

  function removeInlineThemeOverrides(node) {
    if (!node || !node.style) {
      return;
    }
    themeOverrideProperties.forEach(function (name) {
      node.style.removeProperty(name);
    });
  }

  function setInlineThemeOverride(node, name, value) {
    if (node && node.style) {
      node.style.setProperty(name, value);
    }
  }

  function setStateClasses(node, state) {
    if (!node || !node.classList) {
      return;
    }
    node.classList.toggle("dashboard-native-page--motion-low", state.effectiveIntensity > 0 && state.effectiveIntensity <= 35);
    node.classList.toggle("dashboard-native-page--motion-off", state.effectiveIntensity === 0);
    node.classList.toggle("dashboard-native-page--budget-battery", state.performanceBudget === "battery");
    node.classList.toggle("dashboard-native-page--budget-game", state.performanceBudget === "game");
    node.classList.toggle("dashboard-native-page--budget-max", state.performanceBudget === "max");
    node.classList.toggle("dashboard-native-page--readability-clean", state.readability === "clean");
    node.classList.toggle("dashboard-native-page--readability-high-contrast", state.readability === "high-contrast");
    node.classList.toggle("dashboard-native-page--readability-visor", state.readability === "visor");
  }

  function applyStateToNode(node, state) {
    if (!node) {
      return;
    }
    node.setAttribute("data-theme", state.themeId);
    node.setAttribute("data-theme-variant", state.variant);
    node.setAttribute("data-performance-budget", state.performanceBudget);
    node.setAttribute("data-readability", state.readability);
    node.setAttribute("data-reduced-motion", state.reducedMotion ? "true" : "false");
    setStateClasses(node, state);
  }

  function applyPresentation(settings) {
    var root = document.documentElement;
    var body = document.body;
    var customAccent = settings.accentMode === "custom" ? parseHexColor(settings.customAccentColor) : null;
    var effectiveIntensity = effectiveAnimationIntensity(settings);
    var state = {
      themeId: settings.themeId,
      variant: resolveThemeVariant(settings),
      performanceBudget: settings.performanceBudget,
      readability: settings.themeReadability,
      effectiveIntensity: effectiveIntensity,
      reducedMotion: Boolean(reducedMotionQuery && reducedMotionQuery.matches)
    };
    var accentText;

    root.setAttribute("data-standalone-ui", "");
    removeInlineThemeOverrides(root);
    removeInlineThemeOverrides(body);
    applyStateToNode(root, state);
    applyStateToNode(body, state);

    if (customAccent) {
      accentText = contrastSafeAccentTextColor(customAccent, getThemeSurfaceColors(state.themeId));
      [root, body].forEach(function (node) {
        setInlineThemeOverride(node, "--theme-accent", customAccent);
        setInlineThemeOverride(node, "--theme-accent-text", accentText);
        setInlineThemeOverride(node, "--theme-on-accent", contrastSafeTextColor(customAccent));
        setInlineThemeOverride(node, "--theme-accent-soft", rgbaFromHex(customAccent, 0.14));
        setInlineThemeOverride(node, "--theme-accent-border", rgbaFromHex(customAccent, 0.58));
        setInlineThemeOverride(node, "--theme-accent-glow", rgbaFromHex(customAccent, 0.22));
      });
    }

    root.style.setProperty("--dashboard-aura-opacity", String(effectiveIntensity / 100));
  }

  function refreshFromSources() {
    var generation = ++sourceGeneration;
    var stored = readStoredSettings();

    currentSettings = buildSettings(stored);
    applyPresentation(currentSettings);

    if (typeof window.fetch !== "function") {
      return;
    }

    window.fetch("/api/config", {
      credentials: "same-origin",
      headers: { Accept: "application/json" }
    }).then(function (response) {
      if (!response.ok) {
        throw new Error("Theme config unavailable");
      }
      return response.json();
    }).then(function (payload) {
      if (generation !== sourceGeneration) {
        return;
      }
      stored = readStoredSettings();
      currentSettings = buildSettings(mergeNativeDashboardSettings(stored, payload && payload.dashboard));
      applyPresentation(currentSettings);
    }).catch(function () {
      // Static and legacy hosts may not expose /api/config. Focus defaults remain valid.
    });
  }

  document.documentElement.setAttribute("data-standalone-ui", "");
  refreshFromSources();

  if (!document.body) {
    document.addEventListener("DOMContentLoaded", function () {
      applyPresentation(currentSettings || buildSettings(readStoredSettings()));
    }, { once: true });
  }

  window.addEventListener("storage", function (event) {
    if (event.key === settingsStorageKey || event.key === null) {
      refreshFromSources();
    }
  });

  if (reducedMotionQuery) {
    if (typeof reducedMotionQuery.addEventListener === "function") {
      reducedMotionQuery.addEventListener("change", function () {
        applyPresentation(currentSettings || buildSettings(readStoredSettings()));
      });
    } else if (typeof reducedMotionQuery.addListener === "function") {
      reducedMotionQuery.addListener(function () {
        applyPresentation(currentSettings || buildSettings(readStoredSettings()));
      });
    }
  }
}());
