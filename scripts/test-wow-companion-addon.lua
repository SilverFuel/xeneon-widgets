-- Checks the Auxora Companion add-on against a fake game.
-- Not part of `npm run check`: the project has no Lua runtime.
-- Run from the repository root with any Lua 5.2 or newer:
--   lua scripts/test-wow-companion-addon.lua

local ADDON = (arg and arg[1]) or "addons/AuxoraCompanion/AuxoraCompanion.lua"
local passed = 0
local function check(cond, label) if not cond then error("FAILED: " .. label, 2) end passed = passed + 1 end

-- A fresh fake game for each scenario.
local function world(overrides)
  local w = { printed = {}, reloads = 0, combat = false, handler = nil, events = {} }
  local env = setmetatable({}, { __index = _G })
  env.print = function(msg) w.printed[#w.printed + 1] = msg end
  env.UnitName = function(unit) return "Grimbold", nil end
  env.GetRealmName = function() return "Forever One" end
  env.UnitClass = function() return "Paladin", "PALADIN", 2 end
  env.UnitRace = function() return "Undead", "Scourge", 5 end
  env.UnitFactionGroup = function() return "Horde", "Horde" end
  env.UnitLevel = function() return 19 end
  env.UnitXP = function() return 4200 end
  env.UnitXPMax = function() return 15000 end
  env.GetXPExhaustion = function() return nil end
  env.GetRealZoneText = function() return "Silverpine Forest" end
  env.GetSubZoneText = function() return "The Sepulcher" end
  env.GetBindLocation = function() return "Undercity" end
  env.GetMoney = function() return 123456 end
  env.GetBuildInfo = function() return "1.60.1", "70450", "Oct 21 2026", 16001 end
  env.time = function() return 1794455000 end
  env.InCombatLockdown = function() return w.combat end
  env.ReloadUI = function() w.reloads = w.reloads + 1 end
  env.SlashCmdList = {}
  env.CreateFrame = function()
    return {
      RegisterEvent = function(_, e) w.events[e] = true end,
      SetScript = function(_, _, fn) w.handler = fn end
    }
  end
  local entries = {
    { title = "Silverpine Forest", isHeader = true },
    { title = "The Dead Fields", level = 11, questID = 437, isHeader = false },
    { title = "Hidden tracker", level = 1, questID = 9, isHeader = false, isHidden = true },
    { title = "Tirisfal Glades", isHeader = true },
    { title = "A Recipe For Death", level = 12, questID = 447, isHeader = false },
  }
  env.C_QuestLog = {
    GetNumQuestLogEntries = function() return #entries, 2 end,
    GetInfo = function(i) return entries[i] end,
    IsComplete = function(id) return id == 447 end,
    GetQuestObjectives = function(id)
      if id == 437 then return { { text = "Nightlash slain: 0/1", finished = false }, { text = "", finished = true } } end
      return { { text = "Grizzled Bear Heart: 6/6", finished = true } }
    end
  }
  if overrides then overrides(env, w) end
  local chunk = assert(loadfile(ADDON, "t", env))
  chunk("AuxoraCompanion", {})
  w.env = env
  w.fire = function(event) w.handler(nil, event) end
  w.slash = function(msg) env.SlashCmdList["AUXORACOMPANION"](msg) end
  return w
end

-- 1. A normal logout saves the full snapshot.
do
  local w = world()
  check(w.events.PLAYER_LOGIN and w.events.PLAYER_LOGOUT, "registers login and logout")
  check(w.env.SLASH_AUXORACOMPANION1 == "/auxora", "slash command registered")
  w.fire("PLAYER_LOGIN")
  check(#w.printed == 1 and w.printed[1]:find("companion loaded", 1, true), "one line at login")
  check(w.env.AuxoraCompanionDB == nil, "nothing saved before logout")
  w.fire("PLAYER_LOGOUT")
  local db = w.env.AuxoraCompanionDB
  check(db.schema == 1 and db.addonVersion == "0.1.0" and db.last == "Grimbold-Forever One", "header fields")
  local c = db.characters["Grimbold-Forever One"]
  check(c.name == "Grimbold" and c.realm == "Forever One", "name and realm")
  check(c.class == "Paladin" and c.classToken == "PALADIN" and c.race == "Undead" and c.raceToken == "Scourge", "class and race")
  check(c.faction == "Horde" and c.level == 19 and c.xp == 4200 and c.xpMax == 15000 and c.xpRested == nil, "faction, level, xp")
  check(c.zone == "Silverpine Forest" and c.subZone == "The Sepulcher" and c.home == "Undercity", "places")
  check(c.copper == 123456 and c.savedAt == 1794455000, "money and time")
  check(c.clientVersion == "1.60.1" and c.clientBuild == "70450" and c.clientInterface == 16001, "client build")
  check(c.questsRead == true and #c.quests == 2, "two visible quests, header and hidden skipped")
  check(c.quests[1].title == "The Dead Fields" and c.quests[1].zone == "Silverpine Forest" and c.quests[1].level == 11 and c.quests[1].complete == false, "first quest")
  check(#c.quests[1].objectives == 1 and c.quests[1].objectives[1].text == "Nightlash slain: 0/1" and c.quests[1].objectives[1].done == false, "blank objective dropped")
  check(c.quests[2].title == "A Recipe For Death" and c.quests[2].zone == "Tirisfal Glades" and c.quests[2].complete == true and c.quests[2].objectives[1].done == true, "second quest")
  check(w.reloads == 0, "logout does not reload")
end

-- 2. No quest log API: still saves, says so.
do
  local w = world(function(env) env.C_QuestLog = nil end)
  w.fire("PLAYER_LOGOUT")
  local c = w.env.AuxoraCompanionDB.characters["Grimbold-Forever One"]
  check(c.questsRead == false and #c.quests == 0 and c.level == 19, "missing quest API tolerated")
end

-- 3. Game functions that throw or are missing lose only their own field.
do
  local w = world(function(env)
    env.GetMoney = function() error("blocked") end
    env.GetBindLocation = nil
    env.C_QuestLog.GetQuestObjectives = function() error("blocked") end
    env.C_QuestLog.IsComplete = nil
  end)
  w.fire("PLAYER_LOGOUT")
  local c = w.env.AuxoraCompanionDB.characters["Grimbold-Forever One"]
  check(c.copper == nil and c.home == nil and c.zone == "Silverpine Forest", "throwing and missing functions")
  check(#c.quests == 2 and #c.quests[1].objectives == 0 and c.quests[2].complete == false, "quests survive broken sub-calls")
end

-- 4. Secret values are dropped, not stored.
do
  local w = world(function(env)
    env.issecretvalue = function(v) return v == 123456 or v == "Silverpine Forest" end
  end)
  w.fire("PLAYER_LOGOUT")
  local c = w.env.AuxoraCompanionDB.characters["Grimbold-Forever One"]
  check(c.copper == nil and c.zone == nil and c.level == 19, "secret money and zone dropped")
  check(c.quests[1].zone == nil and c.quests[1].title == "The Dead Fields", "secret header dropped, quest kept")
end

-- 5. /auxora status reports without reloading; /auxora saves and reloads; not in combat.
do
  local w = world()
  w.slash(" Status ")
  check(w.reloads == 0 and #w.printed == 2, "status prints two lines and does not reload")
  check(w.printed[1]:find("Grimbold, level 19, Silverpine Forest, 12 gold, 2 quests", 1, true), "status line: " .. w.printed[1])
  w.slash("")
  check(w.reloads == 1 and w.env.AuxoraCompanionDB.last == "Grimbold-Forever One", "/auxora saves then reloads")
  w.combat = true
  w.slash(nil)
  check(w.reloads == 1 and w.printed[#w.printed]:find("leave combat", 1, true), "no reload in combat")
end

-- 6. The modern reload function is preferred; with none, it says how to reload.
do
  local modern = 0
  local w = world(function(env) env.C_UI = { Reload = function() modern = modern + 1 end } end)
  w.slash("")
  check(modern == 1 and w.reloads == 0, "C_UI.Reload preferred")
  local w2 = world(function(env) env.ReloadUI = nil end)
  w2.slash("")
  check(w2.printed[#w2.printed]:find("/reload", 1, true) and w2.env.AuxoraCompanionDB ~= nil, "no reload function: saved and told")
end

-- 7. A second character is added beside the first; last points at the newest.
do
  local w = world(function(env)
    env.AuxoraCompanionDB = { schema = 1, last = "Old-Realm", characters = { ["Old-Realm"] = { name = "Old", level = 5 } } }
  end)
  w.fire("PLAYER_LOGOUT")
  local db = w.env.AuxoraCompanionDB
  check(db.last == "Grimbold-Forever One" and db.characters["Old-Realm"].level == 5 and db.characters["Grimbold-Forever One"].level == 19, "characters accumulate")
end

-- 8. A damaged saved table is replaced, not crashed on.
do
  local w = world(function(env) env.AuxoraCompanionDB = "corrupt" end)
  w.fire("PLAYER_LOGOUT")
  check(type(w.env.AuxoraCompanionDB) == "table" and w.env.AuxoraCompanionDB.last == "Grimbold-Forever One", "corrupt table replaced")
  local w2 = world(function(env) env.AuxoraCompanionDB = { characters = 7 } end)
  w2.fire("PLAYER_LOGOUT")
  check(type(w2.env.AuxoraCompanionDB.characters) == "table", "corrupt characters replaced")
end

-- 9. Character not ready: nothing saved, no reload, says so.
do
  local w = world(function(env) env.UnitName = function() return nil end end)
  w.fire("PLAYER_LOGOUT")
  check(w.env.AuxoraCompanionDB == nil, "no snapshot without a name")
  w.slash("")
  check(w.reloads == 0 and w.printed[#w.printed]:find("not ready", 1, true), "not ready message")
end

-- 10. A very long quest log is capped.
do
  local w = world(function(env)
    env.C_QuestLog.GetNumQuestLogEntries = function() return 200 end
    env.C_QuestLog.GetInfo = function(i) return { title = "Quest " .. i, level = 1, questID = i } end
    env.C_QuestLog.GetQuestObjectives = function()
      local t = {} for i = 1, 30 do t[i] = { text = "step " .. i, finished = false } end return t
    end
  end)
  w.fire("PLAYER_LOGOUT")
  local c = w.env.AuxoraCompanionDB.characters["Grimbold-Forever One"]
  check(#c.quests == 40 and #c.quests[1].objectives == 8, "caps at 40 quests and 8 objectives")
end

io.write("passed " .. passed .. " checks\n")
