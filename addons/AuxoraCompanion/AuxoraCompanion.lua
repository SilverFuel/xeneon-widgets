-- Auxora Companion
--
-- Saves a small snapshot of the character you are playing so the Auxora
-- dashboard can show it. The game writes add-on data to disk only when you
-- log out or reload the interface, so the snapshot is taken at that moment
-- and nothing runs while you play. /auxora takes a snapshot and reloads.
--
-- It reads your own character only. It sends nothing anywhere: no chat, no
-- add-on messages, no network. The data stays in this add-on's saved file.

local ADDON_VERSION = "0.1.0"
local SCHEMA = 1
local MAX_QUESTS = 40
local MAX_OBJECTIVES = 8

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
    savedAt = number(safe(time)),
    clientVersion = text(clientVersion),
    clientBuild = text(clientBuild),
    clientInterface = number(clientInterface)
  }
end

-- Takes a snapshot into the saved table. Returns the snapshot, or nil when the
-- character is not available yet.
local function save()
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

local function say(message)
  print("|cff35d7c7Auxora|r: " .. message)
end

local function describe(snapshot)
  local gold = math.floor((snapshot.copper or 0) / 10000)
  return string.format("%s, level %s, %s, %d gold, %d quests",
    snapshot.name,
    tostring(snapshot.level or "?"),
    snapshot.zone or "unknown zone",
    gold,
    #snapshot.quests)
end

SLASH_AUXORACOMPANION1 = "/auxora"
SlashCmdList["AUXORACOMPANION"] = function(message)
  local command = string.lower((message or ""):match("^%s*(.-)%s*$") or "")
  local snapshot = save()
  if not snapshot then
    say("your character is not ready yet. Try again in a moment.")
    return
  end
  if command == "status" then
    say(describe(snapshot))
    say("this is saved for Auxora when you log out or type /auxora.")
    return
  end
  if type(InCombatLockdown) == "function" and InCombatLockdown() then
    say("leave combat first, then type /auxora again.")
    return
  end
  local reload = (type(C_UI) == "table" and C_UI.Reload) or ReloadUI
  if type(reload) ~= "function" then
    say("saved. Type /reload to send it to Auxora.")
    return
  end
  reload()
end

local frame = CreateFrame("Frame")
frame:RegisterEvent("PLAYER_LOGIN")
frame:RegisterEvent("PLAYER_LOGOUT")
frame:SetScript("OnEvent", function(_, event)
  if event == "PLAYER_LOGOUT" then
    -- The last event before the game writes saved data to disk.
    save()
  elseif event == "PLAYER_LOGIN" then
    say("companion loaded. /auxora saves and reloads; /auxora status shows what is saved.")
  end
end)
