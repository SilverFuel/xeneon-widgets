(function () {
  "use strict";

  var STORAGE_KEY = "auxora-wow-forever-v1";
  var MAX_QUESTS = 100;
  var MAX_FILE_BYTES = 256 * 1024;
  var CLASSES = ["", "Druid", "Hunter", "Mage", "Paladin", "Priest", "Rogue", "Shaman", "Warlock", "Warrior"];
  var CATEGORIES = ["Quest", "Dungeon", "Gear", "Profession", "Explore"];
  var PREPARATIONS = ["Repair equipment", "Clear bag space", "Pack food and supplies", "Check hearthstone destination"];

  function freshJournal() {
    return {
      version: 1,
      profile: { name: "", className: "", race: "", faction: "Horde", level: 1, zone: "", hearth: "", professions: "" },
      quests: [],
      notes: "",
      preparations: [false, false, false, false],
      session: { elapsedMs: 0, startedAt: null }
    };
  }

  function validateJournal(input, now) {
    now = now == null ? Date.now() : now;
    function invalid() { throw new Error("Invalid journal"); }
    function string(value, max) {
      if (typeof value !== "string" || value.length > max) invalid();
      return value;
    }
    function choice(value, choices) {
      if (choices.indexOf(value) === -1) invalid();
      return value;
    }
    function integer(value, min, max) {
      if (!Number.isSafeInteger(value) || value < min || value > max) invalid();
      return value;
    }
    if (!input || input.version !== 1 || !input.profile || !input.session || !Array.isArray(input.quests) || input.quests.length > MAX_QUESTS) invalid();
    for (var questIndex = 0; questIndex < input.quests.length; questIndex += 1) {
      if (!Object.prototype.hasOwnProperty.call(input.quests, questIndex)) invalid();
    }
    var profile = input.profile;
    // Preserve older journals while applying the owner's Horde-only preference.
    choice(profile.faction, ["Neutral", "Horde", "Alliance"]);
    var seen = new Set();
    var journal = {
      version: 1,
      profile: {
        name: string(profile.name, 64),
        className: choice(profile.className, CLASSES),
        race: string(profile.race, 40),
        faction: "Horde",
        level: integer(profile.level, 1, 60),
        zone: string(profile.zone, 80),
        hearth: string(profile.hearth, 80),
        professions: string(profile.professions, 100)
      },
      quests: input.quests.map(function (quest) {
        if (!quest || typeof quest.done !== "boolean") invalid();
        var id = string(quest.id, 80);
        if (!/^[a-zA-Z0-9_-]+$/.test(id) || seen.has(id)) invalid();
        seen.add(id);
        var title = string(quest.title, 180).trim();
        if (!title) invalid();
        return { id: id, title: title, category: choice(quest.category, CATEGORIES), done: quest.done };
      }),
      notes: string(input.notes, 20000),
      preparations: [],
      session: {
        elapsedMs: integer(input.session.elapsedMs, 0, 315360000000),
        startedAt: input.session.startedAt === null ? null : integer(input.session.startedAt, 1, now + 300000)
      }
    };
    if (!Array.isArray(input.preparations) || input.preparations.length !== PREPARATIONS.length) invalid();
    for (var prepIndex = 0; prepIndex < PREPARATIONS.length; prepIndex += 1) {
      if (!Object.prototype.hasOwnProperty.call(input.preparations, prepIndex) || typeof input.preparations[prepIndex] !== "boolean") invalid();
    }
    journal.preparations = input.preparations.slice();
    return journal;
  }

  function elapsedSession(session, now) {
    return session.elapsedMs + (session.startedAt === null ? 0 : Math.max(0, now - session.startedAt));
  }

  function formatSession(milliseconds) {
    var seconds = Math.floor(milliseconds / 1000);
    return String(Math.floor(seconds / 3600)).padStart(2, "0") + ":" + String(Math.floor(seconds / 60) % 60).padStart(2, "0") + ":" + String(seconds % 60).padStart(2, "0");
  }

  function formatCoins(copper) {
    copper = Math.floor(Number(copper));
    if (!isFinite(copper) || copper < 0) copper = 0;
    var gold = Math.floor(copper / 10000);
    var silver = Math.floor(copper / 100) % 100;
    return (gold ? gold.toLocaleString("en-US") + "g " : "") + (gold || silver ? silver + "s " : "") + (copper % 100) + "c";
  }

  function formatSavedAgo(savedAt, now) {
    var time = typeof savedAt === "string" ? Date.parse(savedAt) : NaN;
    if (!isFinite(time)) return "";
    var minutes = Math.floor(Math.max(0, now - time) / 60000);
    if (minutes < 1) return "just now";
    if (minutes < 60) return minutes + (minutes === 1 ? " minute ago" : " minutes ago");
    var hours = Math.floor(minutes / 60);
    if (hours < 24) return hours + (hours === 1 ? " hour ago" : " hours ago");
    var days = Math.floor(hours / 24);
    return days + (days === 1 ? " day ago" : " days ago");
  }

  // The character the Auxora Companion add-on saved in game, in the shape the
  // panel shows, or null when the host has none. The host's reply is checked
  // field by field; nothing in it is trusted to have the right type.
  function gameCharacter(payload) {
    var source = payload && payload.available === true ? payload.character : null;
    if (!source || typeof source !== "object" || typeof source.name !== "string" || !source.name) return null;
    function text(value) { return typeof value === "string" ? value : ""; }
    function whole(value) { value = Number(value); return isFinite(value) && value > 0 ? Math.floor(value) : 0; }
    // A reading the add-on may not have: a whole number from 0 to max, or null.
    function optional(value, max) { return typeof value === "number" && isFinite(value) && value >= 0 ? Math.min(max, Math.floor(value)) : null; }
    var xp = whole(source.xp);
    var xpMax = whole(source.xpMax);
    var bagTotal = optional(source.bagTotal, 2000);
    var bagFree = optional(source.bagFree, 2000);
    if (!bagTotal || bagFree === null || bagFree > bagTotal) { bagTotal = null; bagFree = null; }
    return {
      name: text(source.name),
      race: text(source.race),
      className: text(source.class),
      faction: source.faction === "Alliance" ? "Alliance" : "Horde",
      level: whole(source.level),
      zone: text(source.zone),
      subZone: text(source.subZone),
      hearth: text(source.home),
      xp: xp,
      xpMax: xpMax,
      xpPercent: xpMax > 0 ? Math.min(100, xp / xpMax * 100) : 0,
      rested: whole(source.xpRested),
      coins: formatCoins(source.copper),
      savedAt: text(source.savedAt),
      professions: (Array.isArray(source.professions) ? source.professions : []).filter(function (profession) {
        return profession && typeof profession === "object" && typeof profession.name === "string" && profession.name;
      }).slice(0, 8).map(function (profession) {
        return { name: profession.name, rank: whole(profession.rank), maxRank: whole(profession.maxRank), primary: profession.primary === true };
      }),
      durability: optional(source.durability, 100),
      durabilityLowest: optional(source.durabilityLowest, 100),
      bagFree: bagFree,
      bagTotal: bagTotal,
      quests: (Array.isArray(source.quests) ? source.quests : []).filter(function (quest) {
        return quest && typeof quest === "object" && typeof quest.title === "string" && quest.title;
      }).slice(0, 40).map(function (quest) {
        return {
          title: quest.title,
          zone: text(quest.zone),
          level: whole(quest.level),
          complete: quest.complete === true,
          objectives: (Array.isArray(quest.objectives) ? quest.objectives : []).filter(function (objective) {
            return objective && typeof objective === "object" && typeof objective.text === "string" && objective.text;
          }).slice(0, 8).map(function (objective) {
            return { text: objective.text, done: objective.done === true };
          })
        };
      })
    };
  }

  // The character's professions in one short line: the two main ones when the
  // game marks them, otherwise the first three. "" when there are none.
  function formatProfessions(game) {
    var all = game && Array.isArray(game.professions) ? game.professions : [];
    var main = all.filter(function (profession) { return profession.primary; });
    return (main.length ? main : all.slice(0, 3)).map(function (profession) {
      return profession.name + (profession.rank ? " " + profession.rank : "");
    }).join(", ");
  }

  // What the game last said about gear wear and bag space, as { text, low }.
  // text is "" when the add-on did not say. low marks a piece close to
  // breaking, or bags with almost no room.
  function gearSummary(game) {
    if (!game || typeof game.durability !== "number") return { text: "", low: false };
    var worst = typeof game.durabilityLowest === "number" ? game.durabilityLowest : game.durability;
    return {
      text: game.durability + "%" + (worst < game.durability ? ", worst piece " + worst + "%" : ""),
      low: worst < 25
    };
  }

  function bagSummary(game) {
    if (!game || typeof game.bagFree !== "number" || typeof game.bagTotal !== "number") return { text: "", low: false };
    return {
      text: game.bagFree === 0 ? "Full" : game.bagFree + " of " + game.bagTotal + " free",
      low: game.bagFree < 4
    };
  }

  // The short list of views for the game's quest log, so a long log is never
  // shown all at once: the zone the character is standing in first, then the
  // quests ready to hand in, then the other zones in the game's own order, then
  // everything. Each view is { id, label, count }.
  function questViews(game) {
    var quests = game && Array.isArray(game.quests) ? game.quests : [];
    var zones = [];
    var counts = {};
    quests.forEach(function (quest) {
      var zone = quest.zone || "Other";
      if (!counts[zone]) { counts[zone] = 0; zones.push(zone); }
      counts[zone] += 1;
    });
    var here = game && counts[game.zone] ? game.zone : "";
    var ready = quests.filter(function (quest) { return quest.complete; }).length;
    var views = [];
    if (here) views.push({ id: "zone:" + here, label: here, count: counts[here], here: true });
    if (ready) views.push({ id: "ready", label: "Ready to turn in", count: ready });
    zones.forEach(function (zone) {
      if (zone !== here) views.push({ id: "zone:" + zone, label: zone, count: counts[zone] });
    });
    if (zones.length > 1 || ready) views.push({ id: "all", label: "All", count: quests.length });
    return views;
  }

  // The view to show: the one asked for when it still exists, else the first.
  function questViewId(game, wanted) {
    var views = questViews(game);
    for (var index = 0; index < views.length; index += 1) {
      if (views[index].id === wanted) return wanted;
    }
    return views.length ? views[0].id : "all";
  }

  function questsInView(game, viewId) {
    var quests = game && Array.isArray(game.quests) ? game.quests : [];
    if (viewId === "ready") return quests.filter(function (quest) { return quest.complete; });
    if (typeof viewId === "string" && viewId.indexOf("zone:") === 0) {
      var zone = viewId.slice(5);
      return quests.filter(function (quest) { return (quest.zone || "Other") === zone; });
    }
    return quests.slice();
  }

  // Pure state helpers are also available to the Node regression tests.
  if (typeof module === "object" && module.exports) {
    module.exports = {
      freshJournal: freshJournal, validateJournal: validateJournal, elapsedSession: elapsedSession, formatSession: formatSession,
      formatCoins: formatCoins, formatSavedAgo: formatSavedAgo, gameCharacter: gameCharacter,
      questViews: questViews, questViewId: questViewId, questsInView: questsInView,
      formatProfessions: formatProfessions, gearSummary: gearSummary, bagSummary: bagSummary
    };
    return;
  }

  var runtime = window.InlineWidgets && window.InlineWidgets.runtime;
  if (!runtime || typeof runtime.registerRenderer !== "function") return;
  var escapeHtml = runtime.escapeHtml;

  var resources = [
    { label: "Enter the world", detail: "Official Forever overview", url: "https://worldofwarcraft.blizzard.com/en-us/forever/" },
    { label: "Prepare your adventure", detail: "Blizzard's getting-started guide", url: "https://news.blizzard.com/en-us/article/24315820/world-of-warcraft-forever-now-live" },
    { label: "Find your next dungeon", detail: "Official new dungeon guide", url: "https://worldofwarcraft.blizzard.com/en-us/news/24301455/explore-the-new-dungeons-of-world-of-warcraft-forever" },
    { label: "Know your hero", detail: "Classes and races in Forever", url: "https://news.blizzard.com/en-gb/article/24304075/create-the-hero-you-want-to-be-in-world-of-warcraft-forever" }
  ];

  function button(action, label, style) {
    return '<button type="button" class="wow-button' + (style ? ' wow-button--' + style : '') + '" data-wow-action="' + action + '">' + label + '</button>';
  }

  function options(values, selected, emptyLabel) {
    return values.map(function (value) {
      return '<option value="' + escapeHtml(value) + '"' + (value === selected ? ' selected' : '') + '>' + escapeHtml(value || emptyLabel || "Choose") + '</option>';
    }).join("");
  }

  function mountAdventure(widget, container, env) {
    var cleanups = [];
    var journal = freshJournal();
    var activeFilter = "active";
    var filterChosen = false;
    // On the EDGE at full resolution the text is large and the panel is two
    // pages: the character and quests, or the timer, checklist, notes and guides.
    var page = "quests";
    var storageProblem = "";
    var notice = "";
    var undo = null;
    var pendingImport = null;
    var importRequestId = 0;
    var readingImport = false;
    var originalUnreadable = null;
    var disposed = false;
    var storageWritable = true;
    var downloadUrls = [];
    // The character saved in game by the Auxora Companion add-on, when there is one.
    var game = null;
    var gameMessage = "";
    var gameSignature = "";
    var gameRequestId = 0;
    var gameTicks = 0;
    // The view of the game's quest log the user picked; "" follows the character's zone.
    var gameView = "";

    try {
      var saved = window.localStorage.getItem(STORAGE_KEY);
      if (saved !== null) {
        try { journal = validateJournal(JSON.parse(saved)); }
        catch (error) {
          originalUnreadable = saved;
          storageWritable = false;
          storageProblem = "Your saved journal could not be read. Export a recovery copy, then import a valid backup or start a new journal.";
        }
      }
    } catch (error) {
      storageProblem = "Local saving is unavailable. Keep this tab open and export your journal before leaving.";
    }

    function query(selector) { return container.querySelector(selector); }

    function showNotice() {
      var node = query(".wow-notice");
      if (!node) return;
      if (pendingImport) {
        node.innerHTML = '<span>Replace this journal with the backup for ' + escapeHtml(pendingImport.profile.name || "an unnamed adventurer") + ' (' + pendingImport.quests.length + ' entries)?</span>' + button("confirm-import", "Replace journal", "primary") + button("cancel-import", "Cancel", "quiet");
      } else {
        node.innerHTML = '<span>' + escapeHtml(notice) + '</span>' + (undo ? button("undo", "Undo", "quiet") : "");
      }
      node.hidden = !notice && !pendingImport;
      var status = query(".wow-save-status");
      status.textContent = storageProblem || "Saved on this device";
      status.dataset.state = storageProblem ? "error" : "saved";
    }

    function save(message, keepUndo) {
      if (!keepUndo) undo = null;
      var importCancelled = Boolean(pendingImport) || readingImport;
      importRequestId += 1;
      readingImport = false;
      pendingImport = null;
      notice = (importCancelled ? "Import cancelled because the journal changed. " : "") + (message || "");
      if (storageWritable) {
        try {
          window.localStorage.setItem(STORAGE_KEY, JSON.stringify(journal));
          storageProblem = "";
          // Keep the original recovery export until its replacement is durable.
          if (originalUnreadable !== null) {
            originalUnreadable = null;
            var recovery = query(".wow-recovery");
            if (recovery) recovery.remove();
          }
        } catch (error) {
          storageProblem = "Changes are not saved. Local storage is unavailable or full. Export your journal before leaving.";
        }
      }
      showNotice();
    }

    // A row the game may not have reported; nothing is shown then.
    function gameRow(label, summary) {
      return summary.text ? '<div' + (summary.low ? ' data-state="low"' : '') + '><dt>' + label + '</dt><dd>' + escapeHtml(summary.text) + '</dd></div>' : '';
    }

    function profileMarkup() {
      var p = journal.profile;
      var emblem = '<div class="wow-emblem" aria-hidden="true"><svg viewBox="0 0 100 100" fill="none"><path d="M50 5 83 24v38L50 94 17 62V24Z" stroke="currentColor" stroke-width="2"/><path d="m50 16 23 14v27L50 80 27 57V30Z" stroke="currentColor" opacity=".45"/><path d="m50 24 7 20 19 6-19 7-7 20-7-20-19-7 19-6Z" fill="currentColor"/><path d="M50 5v11M83 24l-10 6M17 24l10 6M50 80v14" stroke="currentColor"/></svg></div>';
      if (game) {
        return emblem +
          '<div class="wow-level-badge">Level <strong>' + game.level + '</strong></div>' +
          '<h3 class="wow-character-name">' + escapeHtml(game.name) + '</h3>' +
          '<p class="wow-character-meta"><b class="wow-meta-level">Level ' + game.level + ' </b>' + escapeHtml([game.race, game.className].filter(Boolean).join(" ")) + ' <span>For the ' + game.faction + '</span></p>' +
          '<div class="wow-location"><span class="wow-eyebrow">Current location</span><strong>' + escapeHtml([game.subZone, game.zone].filter(Boolean).join(", ") || "Unknown") + '</strong></div>' +
          '<div class="wow-progress-track" role="progressbar" aria-label="Experience this level" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + Math.round(game.xpPercent) + '"><span style="width:' + game.xpPercent.toFixed(2) + '%"></span></div>' +
          '<p class="wow-character-meta">' + (game.xpMax ? game.xp.toLocaleString("en-US") + " / " + game.xpMax.toLocaleString("en-US") + " XP" + (game.rested ? ", rested" : "") : "Experience not reported") + '</p>' +
          '<dl class="wow-profile-summary"><div><dt>Coin</dt><dd>' + escapeHtml(game.coins) + '</dd></div><div><dt>Hearthstone</dt><dd>' + escapeHtml(game.hearth || "Not set") + '</dd></div><div><dt>Professions</dt><dd>' + escapeHtml(formatProfessions(game) || p.professions || "Choose your crafts") + '</dd></div>' + gameRow("Gear", gearSummary(game)) + gameRow("Bags", bagSummary(game)) + '</dl>';
      }
      return emblem +
        '<div class="wow-level-badge">Level <strong>' + p.level + '</strong></div>' +
        '<h3 class="wow-character-name">' + escapeHtml(p.name || "Your story begins") + '</h3>' +
        '<p class="wow-character-meta"><b class="wow-meta-level">Level ' + p.level + ' </b>' + escapeHtml([p.race, p.className].filter(Boolean).join(" ") || "Create your adventurer") + ' <span>For the Horde</span></p>' +
        '<div class="wow-location"><span class="wow-eyebrow">Current chapter</span><strong>' + escapeHtml(p.zone || "A world waiting to be explored") + '</strong></div>' +
        '<div class="wow-progress-track" role="progressbar" aria-label="Level journey" aria-valuemin="1" aria-valuemax="60" aria-valuenow="' + p.level + '"><span style="width:' + ((p.level - 1) / 59 * 100).toFixed(2) + '%"></span></div>' +
        '<p class="wow-character-meta">' + (p.level === 60 ? "Level 60 reached. A new chapter awaits." : "Your journey to level 60") + '</p>' +
        '<dl class="wow-profile-summary"><div><dt>Hearthstone</dt><dd>' + escapeHtml(p.hearth || "Set your home") + '</dd></div><div><dt>Professions</dt><dd>' + escapeHtml(p.professions || "Choose your crafts") + '</dd></div></dl>';
    }

    function renderProfile() {
      query(".wow-adventure").dataset.faction = journal.profile.faction;
      query(".wow-character-content").innerHTML = profileMarkup();
      // The editor changes the hand-kept character, which the game's replaces.
      var edit = query('[data-wow-action="profile"]');
      edit.hidden = Boolean(game);
      if (game && !query(".wow-editor").hidden) {
        query(".wow-editor").hidden = true;
        edit.setAttribute("aria-expanded", "false");
      }
    }

    function editorMarkup() {
      var p = journal.profile;
      function field(label, key, max, placeholder) {
        return '<label>' + label + '<input name="' + key + '" maxlength="' + max + '" value="' + escapeHtml(p[key]) + '" placeholder="' + escapeHtml(placeholder || "") + '"></label>';
      }
      return '<div class="wow-card-heading"><h3>Your adventurer</h3><small>Update as your story unfolds</small></div><div class="wow-fields">' +
        field("Character name", "name", 64, "First and last name") +
        '<label>Class<select name="className">' + options(CLASSES, p.className, "Choose a class") + '</select></label>' +
        field("Race", "race", 40, "e.g. Troll") +
        '<label>Allegiance<input value="Horde" readonly></label>' +
        '<label>Level<input name="level" type="number" min="1" max="60" step="1" required value="' + p.level + '"></label>' +
        field("Current zone", "zone", 80, "Where are you exploring?") +
        field("Hearthstone destination", "hearth", 80, "Your home away from home") +
        field("Professions", "professions", 100, "Your trades and current skill levels") +
        '</div><div class="wow-timer-actions"><button class="wow-button wow-button--primary" type="submit">Save character</button>' + button("cancel-profile", "Cancel", "quiet") + '</div>';
    }

    // The game's own quest log, read-only and one view at a time.
    function gameQuestsMarkup(viewId) {
      var showZone = viewId === "ready" || viewId === "all";
      return questsInView(game, viewId).map(function (quest) {
        var progress = quest.complete ? "Ready to turn in" : quest.objectives.map(function (objective) { return objective.text; }).join(" / ");
        return '<li class="wow-quest wow-quest--game' + (quest.complete ? ' is-ready' : '') + '"><span class="wow-quest-copy"><strong>' + escapeHtml(quest.title) + '</strong>' +
          (progress ? '<span class="wow-quest-objectives">' + escapeHtml(progress) + '</span>' : '') +
          (showZone && quest.zone ? '<small>' + escapeHtml(quest.zone) + '</small>' : '') + '</span>' +
          (quest.level ? '<span class="wow-quest-level" aria-label="Level ' + quest.level + '">' + quest.level + '</span>' : '') + '</li>';
      }).join("");
    }

    function gameViewsMarkup(viewId) {
      return questViews(game).map(function (view) {
        return '<button type="button" data-wow-view="' + escapeHtml(view.id) + '" aria-pressed="' + String(view.id === viewId) + '">' +
          escapeHtml(view.label) + ' <span>' + view.count + '</span></button>';
      }).join("");
    }

    function renderQuests() {
      var done = journal.quests.filter(function (quest) { return quest.done; }).length;
      var gameTab = query('[data-wow-filter="game"]');
      gameTab.hidden = !game;
      if (!game && activeFilter === "game") activeFilter = "active";
      container.querySelectorAll("[data-wow-filter]").forEach(function (tab) { tab.setAttribute("aria-pressed", String(tab.dataset.wowFilter === activeFilter)); });
      var list = query(".wow-quest-list");
      var views = query(".wow-quest-views");
      // The game's log is read-only: no add form, and one view of it at a time.
      query(".wow-quest-form").hidden = activeFilter === "game";
      views.hidden = activeFilter !== "game";
      list.classList.toggle("wow-quest-list--game", activeFilter === "game");
      if (activeFilter === "game") {
        var viewId = questViewId(game, gameView);
        var ready = game.quests.filter(function (quest) { return quest.complete; }).length;
        query(".wow-quest-count").textContent = game.quests.length + " in game / " + ready + " ready";
        views.innerHTML = gameViewsMarkup(viewId);
        list.innerHTML = gameQuestsMarkup(viewId);
        var none = query(".wow-empty");
        none.hidden = game.quests.length > 0;
        none.innerHTML = '<strong>An empty quest log.</strong><p>Quests you accept in game appear here after the next save.</p>';
        return;
      }
      views.innerHTML = "";
      query(".wow-quest-count").textContent = (journal.quests.length - done) + " active / " + done + " complete";
      var entries = journal.quests.filter(function (quest) { return activeFilter === "all" || (activeFilter === "completed" ? quest.done : !quest.done); });
      list.innerHTML = entries.map(function (quest) {
        return '<li class="wow-quest' + (quest.done ? ' is-complete' : '') + '"><label><input type="checkbox" data-wow-quest="' + quest.id + '"' + (quest.done ? ' checked' : '') + '><span class="wow-quest-copy"><small>' + escapeHtml(quest.category) + '</small><strong>' + escapeHtml(quest.title) + '</strong></span></label><button type="button" class="wow-icon-button" data-wow-remove="' + quest.id + '" aria-label="Remove ' + escapeHtml(quest.title) + '" title="Remove entry">' +
          '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M5 7h14M9 7V4h6v3M7 7l1 13h8l1-13M10 10v7m4-7v7"/></svg></button></li>';
      }).join("");
      var empty = query(".wow-empty");
      empty.hidden = entries.length > 0;
      empty.innerHTML = activeFilter === "completed" ? '<strong>Stories still in the making.</strong><p>Completed entries will be kept here.</p>' : journal.quests.length ? '<strong>A moment at the campfire.</strong><p>No active entries. Choose your next adventure above.</p>' : '<strong>Every adventure starts with a plan.</strong><p>Add a quest, a piece of gear to hunt, or a place you want to discover.</p>';
    }

    function renderGameStatus() {
      var node = query(".wow-game-status");
      if (!node) return;
      var saved = game ? formatSavedAgo(game.savedAt, Date.now()) : "";
      node.textContent = game
        ? "Character and quests from the game" + (saved ? ", saved " + saved : "") + ". Type /auxora in game to update."
        : "Manual tracking. " + (gameMessage || "Not connected to game data.");
    }

    function applyGame(payload) {
      var next = gameCharacter(payload);
      var message = payload && typeof payload.message === "string" ? payload.message.slice(0, 200) : "";
      var signature = JSON.stringify([next, message]);
      if (signature === gameSignature) {
        renderGameStatus();
        return;
      }
      var firstGame = !game && Boolean(next);
      gameSignature = signature;
      game = next;
      gameMessage = message;
      // The game's quest log is the useful view, unless a tab was already picked.
      if (firstGame && !filterChosen) activeFilter = "game";
      renderProfile();
      renderQuests();
      renderGameStatus();
    }

    // The host reads what the add-on saved; the game writes it at logout or /reload.
    function loadGame() {
      if (!env || !env.bridgeOrigin || typeof runtime.requestJson !== "function" || typeof runtime.buildBridgeUrl !== "function") return;
      var requestId = ++gameRequestId;
      runtime.requestJson(runtime.buildBridgeUrl(env, "/api/wow/companion"), undefined, 4000).then(function (payload) {
        if (!disposed && requestId === gameRequestId) applyGame(payload);
      }, function () {
        // No companion data from this host. The journal stays manual.
      });
    }

    function tick() {
      updateTimer();
      gameTicks += 1;
      if (gameTicks % 15 === 0) loadGame();
    }

    function updateTimer() {
      if (disposed) return;
      query(".wow-timer-value").textContent = formatSession(elapsedSession(journal.session, Date.now()));
      query('[data-wow-action="toggle-session"]').textContent = journal.session.startedAt === null ? (journal.session.elapsedMs ? "Resume" : "Begin session") : "Pause";
      query(".wow-timer-label").textContent = journal.session.startedAt === null ? "Time at the campfire" : "Adventure in progress";
    }

    function render() {
      container.innerHTML = '<section class="wow-adventure" data-page="quests" data-faction="' + journal.profile.faction + '" aria-label="World of Warcraft Forever adventure journal">' +
        '<header class="wow-masthead"><div class="wow-brand"><p class="wow-eyebrow">World of Warcraft / Forever</p><h2>The Adventure Journal</h2><p class="wow-subtitle">Your next quest. Your unfolding story.</p></div></header>' +
        '<form class="wow-editor wow-card" hidden aria-label="Edit character"></form>' +
        '<div class="wow-notice" role="status" hidden></div>' +
        (originalUnreadable !== null ? '<div class="wow-recovery wow-card"><p>Your existing saved data is protected until you choose how to recover it.</p>' + button("export-recovery", "Export recovery copy") + button("new-journal", "Start new journal", "quiet") + '</div>' : '') +
        '<div class="wow-grid"><article class="wow-card wow-character"><div class="wow-card-heading"><span class="wow-eyebrow">The adventurer</span><span class="wow-eyebrow">Chapter I</span></div><div class="wow-character-content"></div>' + button("profile", "Edit character") + '</article>' +
        '<article class="wow-card wow-quests"><div class="wow-card-heading"><h3>Quest ledger</h3><small class="wow-quest-count"></small></div><div class="wow-quest-tabs" role="group" aria-label="Filter quest ledger"><button type="button" data-wow-filter="game" aria-pressed="false" hidden>In game</button><button type="button" data-wow-filter="active" aria-pressed="true">Active</button><button type="button" data-wow-filter="completed" aria-pressed="false">Completed</button><button type="button" data-wow-filter="all" aria-pressed="false">All entries</button></div>' +
        '<form class="wow-quest-form" aria-label="Add adventure entry"><label class="wow-sr-only" for="wow-quest-title">Your next objective</label><input id="wow-quest-title" name="title" placeholder="What will you pursue next?" maxlength="180" required autocomplete="off"><label class="wow-sr-only" for="wow-quest-category">Entry type</label><select id="wow-quest-category" name="category">' + options(CATEGORIES, "Quest") + '</select><button class="wow-button wow-button--primary" type="submit">Add entry</button></form><div class="wow-quest-views" role="group" aria-label="Quest log views" hidden></div><ul class="wow-quest-list"></ul><div class="wow-empty"></div></article>' +
        '<aside class="wow-card wow-camp"><div class="wow-card-heading"><h3>At the campfire</h3></div><p class="wow-timer-label"></p><div class="wow-timer-value" role="timer" aria-label="Session elapsed time">00:00:00</div><div class="wow-timer-actions">' + button("toggle-session", "Begin session", "primary") + button("reset-session", "Reset", "quiet") + '</div><p class="wow-timer-help">Keeps running when you leave this tab.</p><div class="wow-card-heading"><h3>Before you set out</h3></div><div class="wow-prep-list">' + PREPARATIONS.map(function (label, index) { return '<label><input type="checkbox" data-wow-prep="' + index + '"' + (journal.preparations[index] ? ' checked' : '') + '><span>' + label + '</span></label>'; }).join("") + '</div></aside>' +
        '<article class="wow-card wow-journal"><div class="wow-card-heading"><h3>Field notes</h3><small>Saved as you write</small></div><label class="wow-sr-only" for="wow-field-notes">Field notes</label><textarea id="wow-field-notes" maxlength="20000" placeholder="A hidden path. A helpful stranger. The materials you still need. Leave a note for your next session.">' + escapeHtml(journal.notes) + '</textarea></article>' +
        '<aside class="wow-card wow-resources"><div class="wow-card-heading"><h3>The wayfinder</h3><small>Official field guides</small></div><div class="wow-resource-links">' + resources.map(function (resource) { return '<a href="' + resource.url + '" target="_blank" rel="noopener noreferrer"><strong>' + resource.label + '</strong><small>' + resource.detail + '</small></a>'; }).join("") + '</div></aside></div>' +
        '<footer class="wow-footer"><span class="wow-pages" role="group" aria-label="Panel page"><button type="button" class="wow-button" data-wow-page="quests" aria-pressed="true">Quests</button><button type="button" class="wow-button" data-wow-page="camp" aria-pressed="false">Camp and notes</button></span><span class="wow-save-status" role="status"></span><span class="wow-game-status" role="status"></span><span class="wow-footer-actions">' + button("export", "Export journal", "quiet") + button("import", "Import backup", "quiet") + '</span></footer><input class="wow-backup-file" type="file" accept=".json,application/json" hidden aria-label="Import journal backup"></section>';
      query('[data-wow-action="profile"]').setAttribute("aria-expanded", "false");
      renderProfile();
      renderQuests();
      renderGameStatus();
      updateTimer();
      showNotice();
    }

    function download(contents, filename) {
      var url = URL.createObjectURL(new Blob([contents], { type: "application/json" }));
      downloadUrls.push(url);
      var anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      container.appendChild(anchor);
      anchor.click();
      anchor.remove();
      notice = "Journal export requested. Keep the file with your backups.";
      showNotice();
    }

    function closeProfile() {
      query(".wow-editor").hidden = true;
      query('[data-wow-action="profile"]').setAttribute("aria-expanded", "false");
      query('[data-wow-action="profile"]').focus();
    }

    render();
    runtime.addListener(cleanups, container, "submit", function (event) {
      if (event.target.matches(".wow-editor")) {
        event.preventDefault();
        var fields = new FormData(event.target);
        journal.profile = {
          name: String(fields.get("name")).trim(), className: String(fields.get("className")), race: String(fields.get("race")).trim(),
          faction: "Horde", level: Number(fields.get("level")), zone: String(fields.get("zone")).trim(),
          hearth: String(fields.get("hearth")).trim(), professions: String(fields.get("professions")).trim()
        };
        save("Character updated.");
        renderProfile();
        closeProfile();
      } else if (event.target.matches(".wow-quest-form")) {
        event.preventDefault();
        var title = event.target.elements.title;
        if (!title.value.trim()) { title.setCustomValidity("Give your next objective a name."); title.reportValidity(); return; }
        if (journal.quests.length >= MAX_QUESTS) { notice = "Your ledger holds 100 entries. Export it and remove an entry before adding another."; showNotice(); return; }
        journal.quests.push({ id: window.crypto && typeof window.crypto.randomUUID === "function" ? window.crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2), title: title.value.trim(), category: event.target.elements.category.value, done: false });
        activeFilter = "active";
        title.value = "";
        save("Entry added to your ledger.");
        renderQuests();
        title.focus();
      }
    });

    runtime.addListener(cleanups, container, "input", function (event) {
      if (event.target.id === "wow-quest-title") event.target.setCustomValidity("");
      if (event.target.id === "wow-field-notes") {
        journal.notes = event.target.value;
        save("");
      }
    });

    runtime.addListener(cleanups, container, "change", function (event) {
      var target = event.target;
      if (target.hasAttribute("data-wow-quest")) {
        var quest = journal.quests.find(function (entry) { return entry.id === target.dataset.wowQuest; });
        if (!quest) return;
        quest.done = target.checked;
        save(quest.done ? "Entry completed. Find it in Completed." : "Entry returned to your active ledger.");
        renderQuests();
        var remaining = query('[data-wow-quest="' + quest.id + '"]') || query('[data-wow-filter="' + activeFilter + '"]');
        remaining.focus();
      } else if (target.hasAttribute("data-wow-prep")) {
        journal.preparations[Number(target.dataset.wowPrep)] = target.checked;
        save("");
      } else if (target.matches(".wow-backup-file")) {
        var file = target.files && target.files[0];
        target.value = "";
        if (!file) return;
        var requestId = ++importRequestId;
        pendingImport = null;
        readingImport = false;
        if (file.size > MAX_FILE_BYTES) { notice = "This file is too large. Choose an exported journal smaller than 256 KB."; showNotice(); return; }
        readingImport = true;
        notice = "Reading journal backup.";
        showNotice();
        file.text().then(function (contents) {
          if (disposed || requestId !== importRequestId) return;
          readingImport = false;
          try {
            pendingImport = validateJournal(JSON.parse(contents));
            notice = "Review your backup before replacing the current journal.";
            showNotice();
            query('[data-wow-action="confirm-import"]').focus();
          } catch (error) {
            pendingImport = null;
            notice = "This is not a valid version 1 journal backup. Your current journal has not changed.";
            showNotice();
          }
        }).catch(function () {
          if (!disposed && requestId === importRequestId) {
            readingImport = false;
            pendingImport = null;
            notice = "The backup could not be read. Choose the file again.";
            showNotice();
          }
        });
      }
    });

    runtime.addListener(cleanups, container, "keydown", function (event) {
      if (event.key === "Escape" && !query(".wow-editor").hidden) { event.preventDefault(); closeProfile(); }
    });

    runtime.addListener(cleanups, container, "click", function (event) {
      var target = event.target.closest("[data-wow-action], [data-wow-filter], [data-wow-remove], [data-wow-view], [data-wow-page]");
      if (!target || !container.contains(target)) return;
      if (target.hasAttribute("data-wow-view")) {
        gameView = target.dataset.wowView;
        renderQuests();
        // The buttons were redrawn; keep keyboard focus on the one just chosen.
        var chosen = query('.wow-quest-views [aria-pressed="true"]');
        if (chosen) chosen.focus();
        return;
      }
      if (target.hasAttribute("data-wow-page")) {
        page = target.dataset.wowPage === "camp" ? "camp" : "quests";
        query(".wow-adventure").dataset.page = page;
        container.querySelectorAll("[data-wow-page]").forEach(function (choice) { choice.setAttribute("aria-pressed", String(choice.dataset.wowPage === page)); });
        return;
      }
      if (target.hasAttribute("data-wow-filter")) {
        activeFilter = target.dataset.wowFilter;
        filterChosen = true;
        renderQuests();
        return;
      }
      if (target.hasAttribute("data-wow-remove")) {
        var index = journal.quests.findIndex(function (entry) { return entry.id === target.dataset.wowRemove; });
        if (index < 0) return;
        var removed = journal.quests.splice(index, 1)[0];
        undo = function () { journal.quests.splice(index, 0, removed); };
        save("Entry removed.", true);
        renderQuests();
        query('[data-wow-action="undo"]').focus();
        return;
      }
      switch (target.dataset.wowAction) {
        case "profile":
          var editor = query(".wow-editor");
          if (!editor.hidden) { closeProfile(); break; }
          editor.innerHTML = editorMarkup();
          editor.hidden = false;
          target.setAttribute("aria-expanded", "true");
          editor.querySelector("input").focus();
          break;
        case "cancel-profile": closeProfile(); break;
        case "toggle-session":
          if (journal.session.startedAt === null) journal.session.startedAt = Date.now();
          else { journal.session.elapsedMs = elapsedSession(journal.session, Date.now()); journal.session.startedAt = null; }
          save(journal.session.startedAt === null ? "Session paused." : "Session started. Pause it when you finish playing.");
          updateTimer();
          break;
        case "reset-session":
          var oldSession = { elapsedMs: elapsedSession(journal.session, Date.now()), startedAt: journal.session.startedAt === null ? null : Date.now() };
          journal.session = { elapsedMs: 0, startedAt: null };
          undo = function () { journal.session = oldSession; };
          save("Session timer reset.", true);
          updateTimer();
          break;
        case "undo":
          if (undo) {
            undo();
            undo = null;
            save("Change undone.");
            renderProfile();
            renderQuests();
            updateTimer();
            query("#wow-field-notes").value = journal.notes;
            container.querySelectorAll("[data-wow-prep]").forEach(function (checkbox) { checkbox.checked = journal.preparations[Number(checkbox.dataset.wowPrep)]; });
            query('[data-wow-filter="' + activeFilter + '"]').focus();
          }
          break;
        case "export": download(JSON.stringify(journal, null, 2), "wow-forever-journal-" + new Date().toISOString().slice(0, 10) + ".json"); break;
        case "import": query(".wow-backup-file").click(); break;
        case "cancel-import": importRequestId += 1; readingImport = false; pendingImport = null; notice = "Import cancelled. Your journal is unchanged."; showNotice(); query('[data-wow-action="import"]').focus(); break;
        case "confirm-import":
          if (!pendingImport) break;
          var previous = journal;
          var wasRecovery = originalUnreadable !== null;
          journal = pendingImport;
          pendingImport = null;
          storageWritable = true;
          undo = wasRecovery ? null : function () { journal = previous; };
          save("Backup imported.", true);
          render();
          (query('[data-wow-action="undo"]') || query('[data-wow-action="profile"]')).focus();
          break;
        case "export-recovery": download(originalUnreadable, "wow-forever-recovery.json"); break;
        case "new-journal":
          if (target.dataset.confirm !== "true") { target.dataset.confirm = "true"; target.textContent = "Confirm replacement"; notice = "This replaces unreadable saved data. Export a recovery copy first if you want to keep it."; showNotice(); break; }
          storageWritable = true;
          journal = freshJournal();
          save("New journal started.");
          render();
          break;
      }
    });

    var loop = runtime.createTimerLoop(tick, 1000);
    loop.start();
    loadGame();
    return {
      refresh: function () { return loop.refresh(); },
      destroy: function () {
        disposed = true;
        loop.destroy();
        runtime.runCleanups(cleanups);
        downloadUrls.forEach(function (url) { URL.revokeObjectURL(url); });
      }
    };
  }

  runtime.registerRenderer("wow-forever", mountAdventure);
}());
