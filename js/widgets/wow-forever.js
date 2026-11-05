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

  // Pure state helpers are also available to the Node regression tests.
  if (typeof module === "object" && module.exports) {
    module.exports = { freshJournal: freshJournal, validateJournal: validateJournal, elapsedSession: elapsedSession, formatSession: formatSession };
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

  function mountAdventure(widget, container) {
    var cleanups = [];
    var journal = freshJournal();
    var activeFilter = "active";
    var storageProblem = "";
    var notice = "";
    var undo = null;
    var pendingImport = null;
    var originalUnreadable = null;
    var disposed = false;
    var storageWritable = true;
    var downloadUrls = [];

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
      var importCancelled = Boolean(pendingImport);
      pendingImport = null;
      notice = (importCancelled ? "Import cancelled because the journal changed. " : "") + (message || "");
      if (storageWritable) {
        try {
          window.localStorage.setItem(STORAGE_KEY, JSON.stringify(journal));
          storageProblem = "";
        } catch (error) {
          storageProblem = "Changes are not saved. Local storage is unavailable or full. Export your journal before leaving.";
        }
      }
      showNotice();
    }

    function profileMarkup() {
      var p = journal.profile;
      return '<div class="wow-emblem" aria-hidden="true"><svg viewBox="0 0 100 100" fill="none"><path d="M50 5 83 24v38L50 94 17 62V24Z" stroke="currentColor" stroke-width="2"/><path d="m50 16 23 14v27L50 80 27 57V30Z" stroke="currentColor" opacity=".45"/><path d="m50 24 7 20 19 6-19 7-7 20-7-20-19-7 19-6Z" fill="currentColor"/><path d="M50 5v11M83 24l-10 6M17 24l10 6M50 80v14" stroke="currentColor"/></svg></div>' +
        '<div class="wow-level-badge">Level <strong>' + p.level + '</strong></div>' +
        '<h3 class="wow-character-name">' + escapeHtml(p.name || "Your story begins") + '</h3>' +
        '<p class="wow-character-meta">' + escapeHtml([p.race, p.className].filter(Boolean).join(" ") || "Create your adventurer") + ' <span>For the Horde</span></p>' +
        '<div class="wow-location"><span class="wow-eyebrow">Current chapter</span><strong>' + escapeHtml(p.zone || "A world waiting to be explored") + '</strong></div>' +
        '<div class="wow-progress-track" role="progressbar" aria-label="Level journey" aria-valuemin="1" aria-valuemax="60" aria-valuenow="' + p.level + '"><span style="width:' + ((p.level - 1) / 59 * 100).toFixed(2) + '%"></span></div>' +
        '<p class="wow-character-meta">' + (p.level === 60 ? "Level 60 reached. A new chapter awaits." : "Your journey to level 60") + '</p>' +
        '<dl class="wow-profile-summary"><div><dt>Hearthstone</dt><dd>' + escapeHtml(p.hearth || "Set your home") + '</dd></div><div><dt>Professions</dt><dd>' + escapeHtml(p.professions || "Choose your crafts") + '</dd></div></dl>';
    }

    function renderProfile() {
      query(".wow-adventure").dataset.faction = journal.profile.faction;
      query(".wow-character-content").innerHTML = profileMarkup();
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

    function renderQuests() {
      var done = journal.quests.filter(function (quest) { return quest.done; }).length;
      query(".wow-quest-count").textContent = (journal.quests.length - done) + " active / " + done + " complete";
      container.querySelectorAll("[data-wow-filter]").forEach(function (tab) { tab.setAttribute("aria-pressed", String(tab.dataset.wowFilter === activeFilter)); });
      var entries = journal.quests.filter(function (quest) { return activeFilter === "all" || (activeFilter === "completed" ? quest.done : !quest.done); });
      query(".wow-quest-list").innerHTML = entries.map(function (quest) {
        return '<li class="wow-quest' + (quest.done ? ' is-complete' : '') + '"><label><input type="checkbox" data-wow-quest="' + quest.id + '"' + (quest.done ? ' checked' : '') + '><span class="wow-quest-copy"><small>' + escapeHtml(quest.category) + '</small><strong>' + escapeHtml(quest.title) + '</strong></span></label><button type="button" class="wow-icon-button" data-wow-remove="' + quest.id + '" aria-label="Remove ' + escapeHtml(quest.title) + '" title="Remove entry">' +
          '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M5 7h14M9 7V4h6v3M7 7l1 13h8l1-13M10 10v7m4-7v7"/></svg></button></li>';
      }).join("");
      var empty = query(".wow-empty");
      empty.hidden = entries.length > 0;
      empty.innerHTML = activeFilter === "completed" ? '<strong>Stories still in the making.</strong><p>Completed entries will be kept here.</p>' : journal.quests.length ? '<strong>A moment at the campfire.</strong><p>No active entries. Choose your next adventure above.</p>' : '<strong>Every adventure starts with a plan.</strong><p>Add a quest, a piece of gear to hunt, or a place you want to discover.</p>';
    }

    function updateTimer() {
      if (disposed) return;
      query(".wow-timer-value").textContent = formatSession(elapsedSession(journal.session, Date.now()));
      query('[data-wow-action="toggle-session"]').textContent = journal.session.startedAt === null ? (journal.session.elapsedMs ? "Resume" : "Begin session") : "Pause";
      query(".wow-timer-label").textContent = journal.session.startedAt === null ? "Time at the campfire" : "Adventure in progress";
    }

    function render() {
      container.innerHTML = '<section class="wow-adventure" data-faction="' + journal.profile.faction + '" aria-label="World of Warcraft Forever adventure journal">' +
        '<header class="wow-masthead"><div class="wow-brand"><p class="wow-eyebrow">World of Warcraft / Forever</p><h2>The Adventure Journal</h2><p class="wow-subtitle">Your next quest. Your unfolding story.</p></div><div class="wow-masthead-actions">' + button("profile", "Edit character") + button("export", "Export journal", "quiet") + button("import", "Import backup", "quiet") + '</div></header>' +
        '<form class="wow-editor wow-card" hidden aria-label="Edit character"></form>' +
        '<div class="wow-notice" role="status" hidden></div>' +
        (originalUnreadable !== null ? '<div class="wow-recovery wow-card"><p>Your existing saved data is protected until you choose how to recover it.</p>' + button("export-recovery", "Export recovery copy") + button("new-journal", "Start new journal", "quiet") + '</div>' : '') +
        '<div class="wow-grid"><article class="wow-card wow-character"><div class="wow-card-heading"><span class="wow-eyebrow">The adventurer</span><span class="wow-eyebrow">Chapter I</span></div><div class="wow-character-content"></div></article>' +
        '<article class="wow-card wow-quests"><div class="wow-card-heading"><h3>Quest ledger</h3><small class="wow-quest-count"></small></div><div class="wow-quest-tabs" role="group" aria-label="Filter quest ledger"><button type="button" data-wow-filter="active" aria-pressed="true">Active</button><button type="button" data-wow-filter="completed" aria-pressed="false">Completed</button><button type="button" data-wow-filter="all" aria-pressed="false">All entries</button></div>' +
        '<form class="wow-quest-form" aria-label="Add adventure entry"><label class="wow-sr-only" for="wow-quest-title">Your next objective</label><input id="wow-quest-title" name="title" placeholder="What will you pursue next?" maxlength="180" required autocomplete="off"><label class="wow-sr-only" for="wow-quest-category">Entry type</label><select id="wow-quest-category" name="category">' + options(CATEGORIES, "Quest") + '</select><button class="wow-button wow-button--primary" type="submit">Add entry</button></form><ul class="wow-quest-list"></ul><div class="wow-empty"></div></article>' +
        '<aside class="wow-card wow-camp"><div class="wow-card-heading"><h3>At the campfire</h3></div><p class="wow-timer-label"></p><div class="wow-timer-value" role="timer" aria-label="Session elapsed time">00:00:00</div><div class="wow-timer-actions">' + button("toggle-session", "Begin session", "primary") + button("reset-session", "Reset", "quiet") + '</div><p class="wow-timer-help">Runs until you pause, even when you leave this tab.</p><div class="wow-card-heading"><h3>Before you set out</h3></div><div class="wow-prep-list">' + PREPARATIONS.map(function (label, index) { return '<label><input type="checkbox" data-wow-prep="' + index + '"' + (journal.preparations[index] ? ' checked' : '') + '><span>' + label + '</span></label>'; }).join("") + '</div></aside>' +
        '<article class="wow-card wow-journal"><div class="wow-card-heading"><h3>Field notes</h3><small>Saved as you write</small></div><label class="wow-sr-only" for="wow-field-notes">Field notes</label><textarea id="wow-field-notes" maxlength="20000" placeholder="A hidden path. A helpful stranger. The materials you still need. Leave a note for your next session.">' + escapeHtml(journal.notes) + '</textarea></article>' +
        '<aside class="wow-card wow-resources"><div class="wow-card-heading"><h3>The wayfinder</h3><small>Official field guides</small></div><div class="wow-resource-links">' + resources.map(function (resource) { return '<a href="' + resource.url + '" target="_blank" rel="noopener noreferrer"><strong>' + resource.label + '</strong><small>' + resource.detail + '</small></a>'; }).join("") + '</div></aside></div>' +
        '<footer class="wow-footer"><span class="wow-save-status" role="status"></span><span>Personal companion / Manual tracking / Not connected to game data</span></footer><input class="wow-backup-file" type="file" accept=".json,application/json" hidden aria-label="Import journal backup"></section>';
      query('[data-wow-action="profile"]').setAttribute("aria-expanded", "false");
      renderProfile();
      renderQuests();
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
        if (file.size > MAX_FILE_BYTES) { notice = "This file is too large. Choose an exported journal smaller than 256 KB."; showNotice(); return; }
        file.text().then(function (contents) {
          if (disposed) return;
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
          if (!disposed) { notice = "The backup could not be read. Choose the file again."; showNotice(); }
        });
      }
    });

    runtime.addListener(cleanups, container, "keydown", function (event) {
      if (event.key === "Escape" && !query(".wow-editor").hidden) { event.preventDefault(); closeProfile(); }
    });

    runtime.addListener(cleanups, container, "click", function (event) {
      var target = event.target.closest("[data-wow-action], [data-wow-filter], [data-wow-remove]");
      if (!target || !container.contains(target)) return;
      if (target.hasAttribute("data-wow-filter")) {
        activeFilter = target.dataset.wowFilter;
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
        case "cancel-import": pendingImport = null; notice = "Import cancelled. Your journal is unchanged."; showNotice(); query('[data-wow-action="import"]').focus(); break;
        case "confirm-import":
          if (!pendingImport) break;
          var previous = journal;
          var wasRecovery = originalUnreadable !== null;
          journal = pendingImport;
          pendingImport = null;
          storageWritable = true;
          originalUnreadable = null;
          undo = wasRecovery ? null : function () { journal = previous; };
          save("Backup imported.", true);
          render();
          (query('[data-wow-action="undo"]') || query('[data-wow-action="profile"]')).focus();
          break;
        case "export-recovery": download(originalUnreadable, "wow-forever-recovery.json"); break;
        case "new-journal":
          if (target.dataset.confirm !== "true") { target.dataset.confirm = "true"; target.textContent = "Confirm replacement"; notice = "This replaces unreadable saved data. Export a recovery copy first if you want to keep it."; showNotice(); break; }
          storageWritable = true;
          originalUnreadable = null;
          journal = freshJournal();
          save("New journal started.");
          render();
          break;
      }
    });

    var loop = runtime.createTimerLoop(updateTimer, 1000);
    loop.start();
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
