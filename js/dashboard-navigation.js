(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.AuxoraNavigation = api;
  }
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  var sections = [
    { id: "home", label: "Home", tabs: [
      { id: "home", label: "Overview" },
      { id: "calendar", label: "Calendar" },
      { id: "weather", label: "Weather" }
    ] },
    { id: "gaming", label: "Gaming", tabs: [
      { id: "game-mode", label: "Game Mode" },
      { id: "wow-forever", label: "WoW Forever" }
    ] },
    { id: "media", label: "Media", tabs: [
      { id: "audio", label: "Audio & Media" },
      { id: "streaming", label: "Streaming" }
    ] },
    { id: "pc", label: "PC", tabs: [
      { id: "system", label: "Performance" },
      { id: "tmog", label: "Graphs (TMOG)" },
      { id: "network", label: "Network" },
      { id: "display-controls", label: "Display" },
      { id: "shortcuts", label: "Windows controls" },
      { id: "quick-actions", label: "Windows tools" },
      { id: "clipboard", label: "Clipboard" }
    ] },
    { id: "smart-home", label: "Smart Home", tabs: [
      { id: "hue", label: "Lights" },
      { id: "frigate", label: "Cameras" }
    ] },
    { id: "settings", label: "Settings", tabs: [
      { id: "theme-studio", label: "Appearance" },
      { id: "layout-editor", label: "Layout" },
      { id: "scenes", label: "Modes & automation" },
      { id: "game-blocklist", label: "Game blocklist" },
      { id: "updates", label: "Updates" },
      { id: "privacy", label: "Privacy & Backup" },
      { id: "remote", label: "Phone Remote" },
      { id: "marketplace", label: "Widget Packs" },
      { id: "setup", label: "Setup & status" },
      { id: "installer", label: "Repair & recovery" }
    ] }
  ];
  var sectionById = Object.create(null);
  var widgetSections = Object.create(null);
  var widgetIds = [];
  var configurableSectionIds = [];
  var emptyTabs = Object.freeze([]);

  sections.forEach(function (section) {
    sectionById[section.id] = section;
    if (section.id !== "settings") {
      configurableSectionIds.push(section.id);
    }
    section.tabs.forEach(function (tab) {
      if (widgetSections[tab.id]) {
        throw new Error("Duplicate navigation widget: " + tab.id);
      }
      widgetSections[tab.id] = section.id;
      widgetIds.push(tab.id);
      Object.freeze(tab);
    });
    Object.freeze(section.tabs);
    Object.freeze(section);
  });
  Object.freeze(sections);

  function canonicalWidget(id) {
    // Keep the existing ?widget=media deep link while exposing one audio tab.
    if (id === "media") {
      return "audio";
    }
    return typeof id === "string" && widgetSections[id] ? id : null;
  }

  function sectionForWidget(id) {
    var canonical = canonicalWidget(id);
    return canonical ? widgetSections[canonical] : null;
  }

  function tabsForSection(id) {
    return typeof id === "string" && sectionById[id] ? sectionById[id].tabs : emptyTabs;
  }

  function readArray(value) {
    if (typeof value === "string") {
      try {
        value = JSON.parse(value);
      } catch (_) {
        return [];
      }
    }
    return Array.isArray(value) ? value : [];
  }

  function validSectionList(value) {
    return readArray(value).filter(function (id, index, ids) {
      return configurableSectionIds.indexOf(id) !== -1 && ids.indexOf(id) === index;
    });
  }

  function normalizeSectionLayout(order, hidden) {
    var normalizedOrder = validSectionList(order);
    configurableSectionIds.forEach(function (id) {
      if (normalizedOrder.indexOf(id) === -1) {
        normalizedOrder.push(id);
      }
    });
    // Settings is permanently reachable and rendered separately from these five.
    return { order: normalizedOrder, hidden: validSectionList(hidden) };
  }

  function migrateDestination(destination, lastWidget) {
    if (destination === "scenes") {
      return "home";
    }
    if (destination === "library") {
      return sectionForWidget(lastWidget) || "pc";
    }
    return typeof destination === "string" && sectionById[destination] ? destination : null;
  }

  function resolveNavigation(options) {
    options = options && typeof options === "object" ? options : {};
    var requested = canonicalWidget(options.requestedWidget);
    if (requested) {
      return { sectionId: sectionForWidget(requested), widgetId: requested };
    }
    if (options.onboardingCompleted !== true) {
      return { sectionId: "settings", widgetId: "setup" };
    }

    var last = canonicalWidget(options.lastWidget);
    var section = migrateDestination(options.storedDestination, last) || sectionForWidget(last) || "home";
    var panels = options.sectionPanels;
    var remembered = panels && typeof panels === "object" && !Array.isArray(panels)
      && Object.prototype.hasOwnProperty.call(panels, section) ? canonicalWidget(panels[section]) : null;
    var widget = sectionForWidget(remembered) === section ? remembered
      : sectionForWidget(last) === section ? last
      : tabsForSection(section)[0].id;
    // Visibility preferences affect the rail, never route eligibility or deep links.
    return { sectionId: section, widgetId: widget };
  }

  function validateCatalog(catalogIds) {
    if (!Array.isArray(catalogIds)) {
      throw new TypeError("Navigation catalog must be an array of widget IDs");
    }
    var seen = Object.create(null);
    var duplicates = [];
    var extras = [];
    catalogIds.forEach(function (id) {
      if (typeof id !== "string") {
        extras.push("<non-string>");
        return;
      }
      if (seen[id] && duplicates.indexOf(id) === -1) {
        duplicates.push(id);
      }
      seen[id] = true;
      if (!widgetSections[id] && extras.indexOf(id) === -1) {
        extras.push(id);
      }
    });
    var missing = widgetIds.filter(function (id) { return !seen[id]; });
    var errors = [];
    if (duplicates.length) { errors.push("duplicate: " + duplicates.join(", ")); }
    if (missing.length) { errors.push("missing: " + missing.join(", ")); }
    if (extras.length) { errors.push("extra: " + extras.join(", ")); }
    if (errors.length) {
      throw new Error("Navigation catalog mismatch (" + errors.join("; ") + ")");
    }
    return true;
  }

  return Object.freeze({
    sections: sections,
    sectionForWidget: sectionForWidget,
    tabsForSection: tabsForSection,
    normalizeSectionLayout: normalizeSectionLayout,
    resolveNavigation: resolveNavigation,
    migrateDestination: migrateDestination,
    validateCatalog: validateCatalog
  });
});
