-- Auxora Companion
--
-- Saves a small snapshot of the character you are playing so the Auxora
-- dashboard can show it. The game writes add-on data to disk only when you
-- log out or reload the interface. /auxora takes a snapshot and reloads.
--
-- The snapshot is taken during play, a few seconds after something it records
-- changes, and never at logout: by then the client has already cleared money,
-- experience and quest details, and a snapshot taken there saves zeros.
--
-- It reads your own character only. It sends nothing anywhere: no chat, no
-- add-on messages, no network. The data stays in this add-on's saved file.

local ADDON_VERSION = "0.2.0"
local SCHEMA = 1
local MAX_QUESTS = 40
local MAX_OBJECTIVES = 8
local MAX_PROFESSIONS = 8
local LAST_GEAR_SLOT = 18 -- head to ranged; shirt and tabard have no durability
local LAST_BAG = 4 -- backpack is 0, then four bag slots
local SAVE_DELAY = 5 -- seconds; one snapshot for each burst of changes

-- Calls a game function without letting an error or a missing function stop
-- the snapshot. Returns up to four results, or nothing.
local function safe(fn, ...)
  if type(fn) ~= "function" then
    return nil
  end
  local ok, a, b, c, d = pcall(fn, ...)
  if ok then
    return a, b, c, d
  end
  return nil
end

-- The client marks some values as secret and refuses to let add-ons store
-- them. None of the values below should be, but a secret is dropped if one is.
local function plain(value)
  if type(issecretvalue) == "function" then
    local ok, secret = pcall(issecretvalue, value)
    if not ok or secret then
      return nil
    end
  end
  return value
end

local function text(value)
  value = plain(value)
  if type(value) == "string" and value ~= "" then
    return value
  end
  return nil
end

local function number(value)
  value = plain(value)
  if type(value) == "number" then
    return value
  end
  return nil
end

local function collectObjectives(questID)
  local objectives = {}
  local list = questID and C_QuestLog and safe(C_QuestLog.GetQuestObjectives, questID)
  if type(list) ~= "table" then
    return objectives
  end
  for index = 1, math.min(#list, MAX_OBJECTIVES) do
    local objective = list[index]
    local label = type(objective) == "table" and text(objective.text)
    if label then
      objectives[#objectives + 1] = { text = label, done = plain(objective.finished) == true }
    end
  end
  return objectives
end

-- Returns the quest list and whether the quest log could be read at all.
local function collectQuests()
  local quests = {}
  local log = C_QuestLog
  if type(log) ~= "table" or type(log.GetNumQuestLogEntries) ~= "function" or type(log.GetInfo) ~= "function" then
    return quests, false
  end
  local count = number(safe(log.GetNumQuestLogEntries)) or 0
  local zone
  for index = 1, count do
    if #quests >= MAX_QUESTS then
      break
    end
    local info = safe(log.GetInfo, index)
    if type(info) == "table" then
      local title = text(info.title)
      if plain(info.isHeader) == true then
        zone = title
      elseif title and plain(info.isHidden) ~= true then
        local questID = number(info.questID)
        quests[#quests + 1] = {
          title = title,
          level = number(info.level),
          zone = zone,
          complete = questID ~= nil and plain(safe(log.IsComplete, questID)) == true,
          objectives = collectObjectives(questID)
        }
      end
    end
  end
  return quests, true
end

-- Professions with their skill. The client offers one of two ways to ask;
-- whichever exists is used. Returns nil when neither does.
local function collectProfessions()
  local professions = {}
  if type(GetProfessions) == "function" and type(GetProfessionInfo) == "function" then
    local ok, first, second, archaeology, fishing, cooking = pcall(GetProfessions)
    if not ok then
      return nil
    end
    local slots = { { first, true }, { second, true }, { cooking, false }, { fishing, false }, { archaeology, false } }
    for _, slot in ipairs(slots) do
      local index = number(slot[1])
      if index then
        local name, _, rank, maxRank = safe(GetProfessionInfo, index)
        name = text(name)
        if name and #professions < MAX_PROFESSIONS then
          professions[#professions + 1] = { name = name, rank = number(rank) or 0, maxRank = number(maxRank) or 0, primary = slot[2] }
        end
      end
    end
    return professions
  end
  if type(GetNumSkillLines) == "function" and type(GetSkillLineInfo) == "function" then
    -- The older skill list. Professions sit under their own two headings,
    -- named in the game's language; only the English names are recognised.
    local count = number(safe(GetNumSkillLines)) or 0
    local primary
    for index = 1, count do
      local ok, name, isHeader, _, rank, _, _, maxRank = pcall(GetSkillLineInfo, index)
      name = ok and text(name) or nil
      if name and plain(isHeader) then
        if name == "Professions" then
          primary = true
        elseif name == "Secondary Skills" then
          primary = false
        else
          primary = nil
        end
      elseif name and primary ~= nil and #professions < MAX_PROFESSIONS then
        professions[#professions + 1] = { name = name, rank = number(rank) or 0, maxRank = number(maxRank) or 0, primary = primary }
      end
    end
    return professions
  end
  return nil
end

-- How worn the equipped gear is, as whole percentages: all of it together,
-- and the most worn piece. Returns nothing when no piece reports durability.
local function collectDurability()
  if type(GetInventoryItemDurability) ~= "function" then
    return nil
  end
  local current, maximum, lowest = 0, 0, nil
  for slot = 1, LAST_GEAR_SLOT do
    local now, full = safe(GetInventoryItemDurability, slot)
    now, full = number(now), number(full)
    if now and full and full > 0 then
      current = current + now
      maximum = maximum + full
      local percent = math.floor(now / full * 100)
      if lowest == nil or percent < lowest then
        lowest = percent
      end
    end
  end
  if maximum == 0 then
    return nil
  end
  return math.floor(current / maximum * 100), lowest
end

-- Free and total bag slots across the backpack and the four bags.
local function collectBags()
  local container = type(C_Container) == "table" and C_Container or nil
  local slotsIn = (container and container.GetContainerNumSlots) or GetContainerNumSlots
  local freeIn = (container and container.GetContainerNumFreeSlots) or GetContainerNumFreeSlots
  if type(slotsIn) ~= "function" or type(freeIn) ~= "function" then
    return nil
  end
  local free, total = 0, 0
  for bag = 0, LAST_BAG do
    local slots = number(safe(slotsIn, bag)) or 0
    if slots > 0 then
      total = total + slots
      free = free + (number(safe(freeIn, bag)) or 0)
    end
  end
  if total == 0 then
    return nil
  end
  return free, total
end

local function collectSnapshot()
  local name = text(safe(UnitName, "player"))
  if not name then
    return nil
  end
  local realm = text(safe(GetRealmName)) or ""
  local className, classToken = safe(UnitClass, "player")
  local raceName, raceToken = safe(UnitRace, "player")
  local clientVersion, clientBuild, _, clientInterface = safe(GetBuildInfo)
  local quests, questsRead = collectQuests()
  local durability, durabilityLowest = collectDurability()
  local bagFree, bagTotal = collectBags()
  return {
    name = name,
    realm = realm,
    class = text(className),
    classToken = text(classToken),
    race = text(raceName),
    raceToken = text(raceToken),
    faction = text(safe(UnitFactionGroup, "player")),
    level = number(safe(UnitLevel, "player")),
    xp = number(safe(UnitXP, "player")),
    xpMax = number(safe(UnitXPMax, "player")),
    xpRested = number(safe(GetXPExhaustion)),
    zone = text(safe(GetRealZoneText)),
    subZone = text(safe(GetSubZoneText)),
    home = text(safe(GetBindLocation)),
    copper = number(safe(GetMoney)),
    quests = quests,
    questsRead = questsRead,
    professions = collectProfessions(),
    durability = durability,
    durabilityLowest = durabilityLowest,
    bagFree = bagFree,
    bagTotal = bagTotal,
    savedAt = number(safe(time)),
    clientVersion = text(clientVersion),
    clientBuild = text(clientBuild),
    clientInterface = number(clientInterface)
  }
end

local leavingWorld = false
local saveQueued = false

local function inCombat()
  return type(InCombatLockdown) == "function" and InCombatLockdown() == true
end

-- Takes a snapshot into the saved table. Returns the snapshot, or nil when the
-- character cannot be read right now: before it has loaded, in combat, or
-- while the client is leaving the world.
local function save()
  if leavingWorld or inCombat() then
    return nil
  end
  local snapshot = collectSnapshot()
  if not snapshot then
    return nil
  end
  local db = type(AuxoraCompanionDB) == "table" and AuxoraCompanionDB or {}
  local key = snapshot.name .. "-" .. snapshot.realm
  db.schema = SCHEMA
  db.addonVersion = ADDON_VERSION
  db.last = key
  db.characters = type(db.characters) == "table" and db.characters or {}
  db.characters[key] = snapshot
  AuxoraCompanionDB = db
  return snapshot
end

-- Asks for one snapshot a few seconds from now. Requests made while one is
-- already waiting are dropped, so a burst of quest or money updates costs one
-- snapshot.
local function saveSoon()
  if saveQueued or type(C_Timer) ~= "table" or type(C_Timer.After) ~= "function" then
    return
  end
  saveQueued = true
  C_Timer.After(SAVE_DELAY, function()
    saveQueued = false
    save()
  end)
end

local function say(message)
  print("|cff35d7c7Auxora|r: " .. message)
end

local function describe(snapshot)
  local gold = math.floor((snapshot.copper or 0) / 10000)
  local line = string.format("%s, level %s, %s, %d gold, %d quests",
    snapshot.name,
    tostring(snapshot.level or "?"),
    snapshot.zone or "unknown zone",
    gold,
    #snapshot.quests)
  if snapshot.professions then
    line = line .. string.format(", %d professions", #snapshot.professions)
  end
  if snapshot.durability then
    line = line .. string.format(", gear %d%%", snapshot.durability)
  end
  if snapshot.bagFree then
    line = line .. string.format(", %d of %d bag slots free", snapshot.bagFree, snapshot.bagTotal)
  end
  return line
end

SLASH_AUXORACOMPANION1 = "/auxora"
SlashCmdList["AUXORACOMPANION"] = function(message)
  local command = string.lower((message or ""):match("^%s*(.-)%s*$") or "")
  if inCombat() then
    say("leave combat first, then type /auxora again.")
    return
  end
  local snapshot = save()
  if not snapshot then
    say("your character is not ready yet. Try again in a moment.")
    return
  end
  if command == "status" then
    say(describe(snapshot))
    say("this reaches Auxora when you log out or type /auxora.")
    return
  end
  local reload = (type(C_UI) == "table" and C_UI.Reload) or ReloadUI
  if type(reload) ~= "function" then
    say("saved. Type /reload to send it to Auxora.")
    return
  end
  reload()
end

-- Anything that changes what the snapshot records asks for a new one.
local CHANGE_EVENTS = {
  "PLAYER_ENTERING_WORLD",
  "ZONE_CHANGED_NEW_AREA",
  "ZONE_CHANGED",
  "PLAYER_LEVEL_UP",
  "PLAYER_XP_UPDATE",
  "PLAYER_MONEY",
  "QUEST_LOG_UPDATE",
  "HEARTHSTONE_BOUND",
  "PLAYER_REGEN_ENABLED",
  "BAG_UPDATE_DELAYED",
  "UPDATE_INVENTORY_DURABILITY",
  "SKILL_LINES_CHANGED"
}

local frame = CreateFrame("Frame")
for _, event in ipairs({ "PLAYER_LOGIN", "PLAYER_LEAVING_WORLD", "PLAYER_LOGOUT" }) do
  frame:RegisterEvent(event)
end
for _, event in ipairs(CHANGE_EVENTS) do
  -- A client that does not know an event refuses to register it.
  pcall(frame.RegisterEvent, frame, event)
end
frame:SetScript("OnEvent", function(_, event)
  if event == "PLAYER_LOGIN" then
    say("companion loaded. /auxora saves and reloads; /auxora status shows what is saved.")
  elseif event == "PLAYER_LEAVING_WORLD" or event == "PLAYER_LOGOUT" then
    -- Loading screens and logout: the character's data is being cleared.
    leavingWorld = true
  else
    if event == "PLAYER_ENTERING_WORLD" then
      leavingWorld = false
    end
    saveSoon()
  end
end)
