-- Checks the Auxora Companion add-on against a fake game.
-- Not part of `npm run check`: the project has no Lua runtime.
-- Run from the repository root with any Lua 5.2 or newer:
--   lua scripts/test-wow-companion-addon.lua

local ADDON = (arg and arg[1]) or "addons/AuxoraCompanion/AuxoraCompanion.lua"
local KEY = "Grimbold-Forever One"
local passed = 0
local function check(cond, label) if not cond then error("FAILED: " .. label, 2) end passed = passed + 1 end

-- A fresh fake game for each scenario.
local function world(overrides)
  local w = { printed = {}, reloads = 0, combat = false, handler = nil, events = {}, timers = {}, money = 123456 }
  local env = setmetatable({}, { __index = _G })
  env.print = function(msg) w.printed[#w.printed + 1] = msg end
  env.UnitName = function() return "Grimbold", nil end
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
  env.GetMoney = function() return w.money end
  env.GetBuildInfo = function() return "1.60.1", "70888", "Nov 4 2026", 16001 end
  env.time = function() return 1794455000 end
  env.InCombatLockdown = function() return w.combat end
  env.ReloadUI = function() w.reloads = w.reloads + 1 end
  env.SlashCmdList = {}
  env.C_Timer = { After = function(delay, fn) w.timers[#w.timers + 1] = { delay = delay, fn = fn } end }
  env.CreateFrame = function()
    return {
      RegisterEvent = function(_, e)
        if e == "HEARTHSTONE_BOUND" and w.unknownEvent then error("Attempt to register unknown event") end
        w.events[e] = true
      end,
      SetScript = function(_, _, fn) w.handler = fn end
    }
  end
  local entries = {
    { title = "Silverpine Forest", isHeader = true },
    { title = "The Dead Fields", level = 14, questID = 437, isHeader = false },
    { title = "Hidden tracker", level = 1, questID = 9, isHeader = false, isHidden = true },
    { title = "Tirisfal Glades", isHeader = true },
    { title = "A Recipe For Death", level = 12, questID = 447, isHeader = false },
  }
  env.C_QuestLog = {
    GetNumQuestLogEntries = function() return #entries, 2 end,
    GetInfo = function(i) return entries[i] end,
    IsComplete = function(id) return id == 447 end,
    GetQuestObjectives = function(id)
      if id == 437 then return { { text = "0/1 Essence of Nightlash", finished = false }, { text = "", finished = true } } end
      return { { text = "6/6 Grizzled Bear Heart", finished = true } }
    end
  }
  if overrides then overrides(env, w) end
  local chunk = assert(loadfile(ADDON, "t", env))
  chunk("AuxoraCompanion", {})
  w.env = env
  w.fire = function(event) w.handler(nil, event) end
  w.slash = function(msg) env.SlashCmdList["AUXORACOMPANION"](msg) end
  -- Runs every timer that is waiting, as the game would after the delay.
  w.runTimers = function()
    local due = w.timers
    w.timers = {}
    for _, timer in ipairs(due) do timer.fn() end
  end
  w.character = function() return env.AuxoraCompanionDB and env.AuxoraCompanionDB.characters[KEY] end
  return w
end

-- 1. During play, a change is saved a few seconds later, in full.
do
  local w = world()
  check(w.events.PLAYER_LOGIN and w.events.PLAYER_LOGOUT and w.events.PLAYER_LEAVING_WORLD, "registers login, leaving and logout")
  check(w.events.PLAYER_ENTERING_WORLD and w.events.QUEST_LOG_UPDATE and w.events.PLAYER_MONEY and w.events.PLAYER_REGEN_ENABLED, "registers change events")
  check(w.env.SLASH_AUXORACOMPANION1 == "/auxora", "slash command registered")
  w.fire("PLAYER_LOGIN")
  check(#w.printed == 1 and w.printed[1]:find("companion loaded", 1, true), "one line at login")
  check(w.env.AuxoraCompanionDB == nil and #w.timers == 0, "login alone saves nothing")
  w.fire("PLAYER_ENTERING_WORLD")
  check(w.env.AuxoraCompanionDB == nil and #w.timers == 1 and w.timers[1].delay == 5, "a change waits five seconds")
  w.runTimers()
  local db = w.env.AuxoraCompanionDB
  check(db.schema == 1 and db.addonVersion == "0.2.0" and db.last == KEY, "header fields")
  local c = w.character()
  check(c.name == "Grimbold" and c.realm == "Forever One", "name and realm")
  check(c.class == "Paladin" and c.classToken == "PALADIN" and c.race == "Undead" and c.raceToken == "Scourge", "class and race")
  check(c.faction == "Horde" and c.level == 19 and c.xp == 4200 and c.xpMax == 15000 and c.xpRested == nil, "faction, level, xp")
  check(c.zone == "Silverpine Forest" and c.subZone == "The Sepulcher" and c.home == "Undercity", "places")
  check(c.copper == 123456 and c.savedAt == 1794455000, "money and time")
  check(c.clientVersion == "1.60.1" and c.clientBuild == "70888" and c.clientInterface == 16001, "client build")
  check(c.questsRead == true and #c.quests == 2, "two visible quests, header and hidden skipped")
  check(c.quests[1].title == "The Dead Fields" and c.quests[1].zone == "Silverpine Forest" and c.quests[1].level == 14 and c.quests[1].complete == false, "first quest")
  check(#c.quests[1].objectives == 1 and c.quests[1].objectives[1].text == "0/1 Essence of Nightlash" and c.quests[1].objectives[1].done == false, "blank objective dropped")
  check(c.quests[2].zone == "Tirisfal Glades" and c.quests[2].complete == true and c.quests[2].objectives[1].done == true, "second quest")
end

-- 2. A burst of changes costs one snapshot, and a later change is picked up.
do
  local w = world()
  for _, event in ipairs({ "PLAYER_ENTERING_WORLD", "QUEST_LOG_UPDATE", "QUEST_LOG_UPDATE", "PLAYER_MONEY", "ZONE_CHANGED" }) do w.fire(event) end
  check(#w.timers == 1, "five events, one snapshot waiting")
  w.runTimers()
  check(w.character().copper == 123456, "burst saved")
  w.money = 999
  w.fire("PLAYER_MONEY")
  check(#w.timers == 1 and w.character().copper == 123456, "next change waits again")
  w.runTimers()
  check(w.character().copper == 999, "next change saved")
end

-- 3. Logout never takes a snapshot. The client has cleared money, experience
--    and quest details by then; this is what the first release saved.
do
  local w = world()
  w.fire("PLAYER_ENTERING_WORLD")
  w.runTimers()
  w.fire("PLAYER_MONEY") -- a snapshot is still waiting when the player logs out
  w.money = 0
  w.env.UnitXP = function() return 0 end
  w.env.UnitXPMax = function() return 0 end
  w.env.C_QuestLog.GetQuestObjectives = function() return {} end
  w.fire("PLAYER_LEAVING_WORLD")
  w.fire("PLAYER_LOGOUT")
  w.runTimers()
  local c = w.character()
  check(c.copper == 123456 and c.xp == 4200 and c.xpMax == 15000, "logout keeps the last good money and experience")
  check(#c.quests[1].objectives == 1, "logout keeps quest objectives")
  w.slash("")
  check(w.reloads == 0 and w.printed[#w.printed]:find("not ready", 1, true), "/auxora after leaving the world saves nothing")
end

-- 4. A loading screen pauses snapshots; arriving resumes them.
do
  local w = world()
  w.fire("PLAYER_LEAVING_WORLD")
  w.fire("QUEST_LOG_UPDATE")
  w.runTimers()
  check(w.env.AuxoraCompanionDB == nil, "nothing saved during a loading screen")
  w.fire("PLAYER_ENTERING_WORLD")
  w.runTimers()
  check(w.character().level == 19, "saved after arriving")
end

-- 5. Nothing is read in combat; leaving combat asks again.
do
  local w = world()
  w.combat = true
  w.fire("PLAYER_XP_UPDATE")
  w.runTimers()
  check(w.env.AuxoraCompanionDB == nil, "no snapshot in combat")
  w.slash("status")
  check(w.env.AuxoraCompanionDB == nil and w.printed[#w.printed]:find("leave combat", 1, true), "/auxora status refuses in combat")
  w.slash("")
  check(w.reloads == 0, "/auxora does not reload in combat")
  w.combat = false
  w.fire("PLAYER_REGEN_ENABLED")
  w.runTimers()
  check(w.character().xp == 4200, "saved after combat")
end

-- 6. /auxora status reports without reloading; /auxora saves and reloads.
do
  local w = world()
  w.slash(" Status ")
  check(w.reloads == 0 and #w.printed == 2, "status prints two lines and does not reload")
  check(w.printed[1]:find("Grimbold, level 19, Silverpine Forest, 12 gold, 2 quests", 1, true), "status line: " .. w.printed[1])
  w.slash("")
  check(w.reloads == 1 and w.env.AuxoraCompanionDB.last == KEY, "/auxora saves then reloads")
end

-- 7. The modern reload function is preferred; with none, it says how to reload.
do
  local modern = 0
  local w = world(function(env) env.C_UI = { Reload = function() modern = modern + 1 end } end)
  w.slash("")
  check(modern == 1 and w.reloads == 0, "C_UI.Reload preferred")
  local w2 = world(function(env) env.ReloadUI = nil end)
  w2.slash("")
  check(w2.printed[#w2.printed]:find("/reload", 1, true) and w2.env.AuxoraCompanionDB ~= nil, "no reload function: saved and told")
end

-- 8. No quest log API: still saves, says so.
do
  local w = world(function(env) env.C_QuestLog = nil end)
  w.slash("status")
  local c = w.character()
  check(c.questsRead == false and #c.quests == 0 and c.level == 19, "missing quest API tolerated")
end

-- 9. Game functions that throw or are missing lose only their own field.
do
  local w = world(function(env)
    env.GetMoney = function() error("blocked") end
    env.GetBindLocation = nil
    env.C_QuestLog.GetQuestObjectives = function() error("blocked") end
    env.C_QuestLog.IsComplete = nil
  end)
  w.slash("status")
  local c = w.character()
  check(c.copper == nil and c.home == nil and c.zone == "Silverpine Forest", "throwing and missing functions")
  check(#c.quests == 2 and #c.quests[1].objectives == 0 and c.quests[2].complete == false, "quests survive broken sub-calls")
end

-- 10. Secret values are dropped, not stored.
do
  local w = world(function(env)
    env.issecretvalue = function(v) return v == 123456 or v == "Silverpine Forest" end
  end)
  w.slash("status")
  local c = w.character()
  check(c.copper == nil and c.zone == nil and c.level == 19, "secret money and zone dropped")
  check(c.quests[1].zone == nil and c.quests[1].title == "The Dead Fields", "secret header dropped, quest kept")
end

-- 11. A second character is added beside the first; last points at the newest.
do
  local w = world(function(env)
    env.AuxoraCompanionDB = { schema = 1, last = "Old-Realm", characters = { ["Old-Realm"] = { name = "Old", level = 5 } } }
  end)
  w.slash("status")
  local db = w.env.AuxoraCompanionDB
  check(db.last == KEY and db.characters["Old-Realm"].level == 5 and db.characters[KEY].level == 19, "characters accumulate")
end

-- 12. A damaged saved table is replaced, not crashed on.
do
  local w = world(function(env) env.AuxoraCompanionDB = "corrupt" end)
  w.slash("status")
  check(type(w.env.AuxoraCompanionDB) == "table" and w.env.AuxoraCompanionDB.last == KEY, "corrupt table replaced")
  local w2 = world(function(env) env.AuxoraCompanionDB = { characters = 7 } end)
  w2.slash("status")
  check(type(w2.env.AuxoraCompanionDB.characters) == "table", "corrupt characters replaced")
end

-- 13. Character not ready: nothing saved, no reload, says so.
do
  local w = world(function(env) env.UnitName = function() return nil end end)
  w.fire("PLAYER_ENTERING_WORLD")
  w.runTimers()
  check(w.env.AuxoraCompanionDB == nil, "no snapshot without a name")
  w.slash("")
  check(w.reloads == 0 and w.printed[#w.printed]:find("not ready", 1, true), "not ready message")
end

-- 14. A very long quest log is capped.
do
  local w = world(function(env)
    env.C_QuestLog.GetNumQuestLogEntries = function() return 200 end
    env.C_QuestLog.GetInfo = function(i) return { title = "Quest " .. i, level = 1, questID = i } end
    env.C_QuestLog.GetQuestObjectives = function()
      local t = {} for i = 1, 30 do t[i] = { text = "step " .. i, finished = false } end return t
    end
  end)
  w.slash("status")
  local c = w.character()
  check(#c.quests == 40 and #c.quests[1].objectives == 8, "caps at 40 quests and 8 objectives")
end

-- 15. A client without timers, or one that does not know an event, still loads.
do
  local w = world(function(env) env.C_Timer = nil end)
  w.fire("PLAYER_ENTERING_WORLD")
  check(w.env.AuxoraCompanionDB == nil, "no timers: no automatic snapshot")
  w.slash("status")
  check(w.character().level == 19, "no timers: /auxora still saves")
  local w2 = world(function(_, world2) world2.unknownEvent = true end)
  check(w2.events.PLAYER_MONEY and not w2.events.HEARTHSTONE_BOUND, "an unknown event does not stop the others")
  w2.fire("PLAYER_MONEY")
  w2.runTimers()
  check(w2.character().copper == 123456, "still saves after an unknown event")
end

-- 16. With none of the newer game functions, the new fields are simply absent.
do
  local w = world()
  w.slash("status")
  local c = w.character()
  check(c.professions == nil and c.durability == nil and c.durabilityLowest == nil and c.bagFree == nil and c.bagTotal == nil,
    "no profession, durability or bag functions: nothing invented")
  check(not w.printed[#w.printed - 1]:find("professions") and not w.printed[#w.printed - 1]:find("gear"), "status does not mention what it could not read")
end

-- 17. Professions, gear wear and bag space are saved when the game offers them.
do
  local durability = { [1] = { 50, 100 }, [5] = { 30, 120 }, [16] = { 0, 0 }, [19] = { 1, 1 } }
  local w = world(function(env)
    env.GetProfessions = function() return 3, 7, nil, 9, 5 end
    env.GetProfessionInfo = function(index)
      local known = { [3] = { "Mining", 75, 150 }, [7] = { "Blacksmithing", 60, 150 }, [5] = { "Cooking", 40, 75 }, [9] = { "Fishing", 1, 75 } }
      local entry = known[index]
      return entry[1], "icon", entry[2], entry[3]
    end
    env.GetInventoryItemDurability = function(slot)
      local entry = durability[slot]
      if entry then return entry[1], entry[2] end
      return nil
    end
    env.C_Container = {
      GetContainerNumSlots = function(bag) return ({ [0] = 16, [1] = 10, [2] = 0, [3] = 8, [4] = 0 })[bag] end,
      GetContainerNumFreeSlots = function(bag) return ({ [0] = 3, [1] = 0, [2] = 99, [3] = 8, [4] = 0 })[bag] end
    }
  end)
  check(w.events.BAG_UPDATE_DELAYED and w.events.UPDATE_INVENTORY_DURABILITY and w.events.SKILL_LINES_CHANGED, "registers bag, durability and skill events")
  w.fire("BAG_UPDATE_DELAYED")
  w.runTimers()
  local c = w.character()
  check(#c.professions == 4, "four professions")
  check(c.professions[1].name == "Mining" and c.professions[1].rank == 75 and c.professions[1].maxRank == 150 and c.professions[1].primary == true, "first primary profession")
  check(c.professions[2].name == "Blacksmithing" and c.professions[2].primary == true, "second primary profession")
  check(c.professions[3].name == "Cooking" and c.professions[3].primary == false and c.professions[4].name == "Fishing", "secondary professions follow")
  -- 80 of 220 points left across the two pieces that wear; the worst is at 25%.
  check(c.durability == 36 and c.durabilityLowest == 25, "durability is the whole set and the worst piece, ignoring slots that do not wear")
  check(c.bagFree == 11 and c.bagTotal == 34, "bag space ignores empty bag slots")
  w.slash("status")
  local line = w.printed[#w.printed - 1]
  check(line:find("4 professions") and line:find("gear 36%%") and line:find("11 of 34 bag slots free"), "status reports the new fields")
end

-- 18. The older skill list and the older bag functions work too.
do
  local skills = {
    { "Class Skills", true }, { "Holy", false, 1, 1 },
    { "Professions", true }, { "Herbalism", false, 120, 150 }, { "Alchemy", false, 110, 150 },
    { "Secondary Skills", true }, { "First Aid", false, 80, 150 },
    { "Weapon Skills", true }, { "Swords", false, 95, 95 },
  }
  local w = world(function(env)
    env.GetNumSkillLines = function() return #skills end
    env.GetSkillLineInfo = function(index)
      local entry = skills[index]
      return entry[1], entry[2], true, entry[3], 0, 0, entry[4]
    end
    env.GetContainerNumSlots = function(bag) return bag == 0 and 16 or 0 end
    env.GetContainerNumFreeSlots = function(bag) return bag == 0 and 16 or 0 end
  end)
  w.slash("status")
  local c = w.character()
  check(#c.professions == 3, "only the two profession headings are read")
  check(c.professions[1].name == "Herbalism" and c.professions[1].rank == 120 and c.professions[1].primary == true, "primary from the older list")
  check(c.professions[3].name == "First Aid" and c.professions[3].primary == false, "secondary from the older list")
  check(c.bagFree == 16 and c.bagTotal == 16, "older bag functions")
end

-- 19. A profession, durability or bag function that throws loses only its own field.
do
  local w = world(function(env)
    env.GetProfessions = function() error("blocked") end
    env.GetProfessionInfo = function() return "Mining", "icon", 1, 75 end
    env.GetInventoryItemDurability = function() error("blocked") end
    env.C_Container = { GetContainerNumSlots = function() error("blocked") end, GetContainerNumFreeSlots = function() return 1 end }
  end)
  w.slash("status")
  local c = w.character()
  check(c.level == 19 and #c.quests == 2, "the rest of the snapshot is intact")
  check(c.professions == nil and c.durability == nil and c.bagFree == nil, "failed readings are left out")
end

-- 20. No gear that wears, and no professions learned.
do
  local w = world(function(env)
    env.GetProfessions = function() return nil, nil, nil, nil, nil end
    env.GetProfessionInfo = function() error("should not be asked") end
    env.GetInventoryItemDurability = function() return nil end
  end)
  w.slash("status")
  local c = w.character()
  check(type(c.professions) == "table" and #c.professions == 0, "no professions learned is an empty list, not missing")
  check(c.durability == nil and c.durabilityLowest == nil, "nothing that wears: no durability")
end

io.write("passed " .. passed .. " checks\n")
