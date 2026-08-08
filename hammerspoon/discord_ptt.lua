-- Discord mute control on macOS, driven two ways:
--   1. Remote toggle over HTTP (phone button anywhere in the apartment).
--   2. Thumb-button push-to-talk, handled by Discord itself (see below).
--
-- Why an Accessibility click and not a Discord keybind: Discord on macOS ignores
-- synthetic/virtual keystrokes in its keybind recorder (verified — F13 fired on
-- the system bus but Discord never captured it; matches documented Karabiner /
-- Razer-macro failures). So instead of feeding Discord a key, we press its actual
-- mute control through the macOS Accessibility API — a real UI action Discord
-- handles normally. Discord exposes the bottom-left mic toggle as an AXCheckBox
-- whose AXDescription is "Mute" (AXValue 1 = muted, 0 = unmuted).
--
-- Push-to-talk is NOT implemented here. Discord's own native PTT is bound to the
-- mouse thumb button, which is silent (no mute chime) and lower-latency than
-- anything we could drive through Accessibility. The only problem is that macOS
-- and most apps also read that thumb button as "back", so all this module does is
-- swallow the button to kill the back-nav.
--
-- UNVERIFIED, and the open question for this half of the file: returning true
-- from an eventtap callback DELETES the event rather than passing it on, so
-- Discord only still hears the button if it reads input below our CGEventTap
-- (an IOHID-level tap would; another CGEventTap placed later would not). If PTT
-- turns out to be dead while the toggle is on, that is this, and the fix is to
-- stop swallowing and solve back-nav another way.

local module = {}

local PORT = 8722
-- Mouse button number for the thumb button used as push-to-talk (probed: 3).
local PTT_BUTTON = 3

-- Shared secret in the URL path so a stray LAN device can't toggle your mic by
-- guessing. It stops guesses, not sniffing: hs.httpserver runs plain HTTP on all
-- interfaces, so anyone who can capture traffic on the network reads the token
-- out of the URL and can replay it. Judged acceptable for a home LAN toggling a
-- microphone; if this ever moves to a network you don't control, it needs TLS
-- and a bound interface, not a longer token.
--
-- This repo is public, so the token lives in a gitignored sibling module that
-- returns it as a string:
--
--   -- hammerspoon/discord_ptt_secret.lua
--   return "some-long-random-string"
--
-- There is deliberately no default: a shared secret committed next to the code
-- protects nothing, and a server quietly accepting a publicly-known path would
-- look secured while being open. Missing token means the HTTP endpoint simply
-- does not start, and says so.
local function loadToken()
  local ok, token = pcall(require, "discord_ptt_secret")
  if ok and type(token) == "string" and token ~= "" then
    return token
  end
  return nil
end

-----------------------------------------------------------------------------
-- Discord mute checkbox (found via Accessibility, cached for low latency)
-----------------------------------------------------------------------------
local muteCheckbox = nil

local function findMuteCheckbox()
  local app = hs.application.get("Discord")
  if not app then return nil end
  local root = hs.axuielement.applicationElement(app)
  if not root then return nil end

  local found
  local function walk(element, depth)
    if found or depth > 40 then return end
    if element:attributeValue("AXRole") == "AXCheckBox"
      and element:attributeValue("AXDescription") == "Mute" then
      found = element
      return
    end
    local children = element:attributeValue("AXChildren")
    if children then
      for _, child in ipairs(children) do
        walk(child, depth + 1)
      end
    end
  end
  walk(root, 0)
  return found
end

-- Return a live mute checkbox, re-finding if the cached one went stale (e.g.
-- Discord was restarted). Reading AXValue is the cheap liveness probe.
local function getMuteCheckbox()
  if muteCheckbox then
    local ok, value = pcall(function() return muteCheckbox:attributeValue("AXValue") end)
    if ok and value ~= nil then return muteCheckbox end
    muteCheckbox = nil
  end
  muteCheckbox = findMuteCheckbox()
  return muteCheckbox
end

-- Returns true only if Discord actually took the press. performAction has three
-- outcomes, not two: the element when accepted, `false` when Discord rejects the
-- action, and `nil` on an Accessibility error. Both failures are real here (a
-- stale cached element, revoked Accessibility permission), so test truthiness
-- rather than comparing against nil, which would score a rejection as success
-- and make the HTTP endpoint answer 200 while the mic never moved.
local function toggleMute()
  local checkbox = getMuteCheckbox()
  if not checkbox then return false end
  local result = checkbox:performAction("AXPress")
  return result ~= nil and result ~= false
end

-----------------------------------------------------------------------------
-- 1. Remote toggle over HTTP (phone → HA → here)
-----------------------------------------------------------------------------
hs.hotkey.bind({ "cmd", "alt", "ctrl" }, "D", toggleMute) -- desk convenience

local token = loadToken()
local server = nil

if token then
  server = hs.httpserver.new(false, false)
  server:setPort(PORT)
  server:setName("hammerspoon-discord-mute")
  server:setCallback(function(method, path)
    if path == "/dm/" .. token then
      local ok = toggleMute()
      return ok and "ok" or "discord-not-found", ok and 200 or 503, {}
    end
    return "not found", 404, {}
  end)
  server:start()
else
  hs.alert.show("Discord mute: no token, remote toggle disabled")
end

-----------------------------------------------------------------------------
-- 2. Thumb-button back-nav suppression (so Discord's native PTT can use it)
-----------------------------------------------------------------------------
-- ⌃⌥⌘P is a manual on/off, not an app check: while it is on the button is
-- swallowed everywhere, including back-nav in browsers. That is deliberate, since
-- PTT has to keep working while Discord is in the background, which is exactly
-- where a frontmost-app check would break it. Toggle it off when done talking.
local pttEnabled = false

-- Assigned to the module table below, not just held in this local. hs.eventtap
-- objects stop themselves from __gc, and a local that nothing references after
-- the chunk finishes is collectable, so the tap would die at an arbitrary later
-- GC and take back-nav suppression with it. require() keeps the returned table
-- alive in package.loaded, which is what actually anchors it.
local pttTap = hs.eventtap.new(
  { hs.eventtap.event.types.otherMouseDown, hs.eventtap.event.types.otherMouseUp },
  function(event)
    if not pttEnabled then return false end
    local button = event:getProperty(hs.eventtap.event.properties.mouseEventButtonNumber)
    if button ~= PTT_BUTTON then return false end
    return true -- swallow the back-nav; Discord native PTT handles the mic
  end)
pttTap:start()

hs.hotkey.bind({ "cmd", "alt", "ctrl" }, "P", function()
  pttEnabled = not pttEnabled
  hs.alert.show("Thumb-button back-nav suppressed: " .. (pttEnabled and "ON" or "OFF"))
end)

module.server = server
module.pttTap = pttTap
module.toggleMute = toggleMute
return module
