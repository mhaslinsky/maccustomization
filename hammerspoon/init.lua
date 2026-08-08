-- Hammerspoon entry point for Mac customization.
-- Loaded from ~/.hammerspoon/init.lua via a one-line bootstrap stub (see
-- the setup note at the bottom).
--
-- Window borders were moved to JankyBorders (`borders` daemon) in favor
-- of a native implementation — see `borders/bordersrc`.

-- Keep this directory importable for future local modules regardless of where
-- this init.lua was dofile'd from.
local scriptDir = (debug.getinfo(1, "S").source:sub(2):match("(.*/)")) or "./"
package.path = scriptDir .. "?.lua;" .. package.path

-----------------------------------------------------------------------------
-- Audio device priority
-----------------------------------------------------------------------------
-- Keep macOS audio input devices on a preferred priority order.
-- Edit these lists from highest priority to lowest priority.

local inputPriority = {
  "Scarlett Solo USB",
  "Creative Microphone",
  "Creative Speakers",
  "MacBook Pro Microphone",
}

local lastInputName = nil
local audioDebounceTimer = nil

local function findAudioDeviceByName(devices, name)
  for _, device in ipairs(devices) do
    if device:name() == name then
      return device
    end
  end

  return nil
end

local function setFirstAvailableInput()
  local inputDevices = hs.audiodevice.allInputDevices()
  for _, name in ipairs(inputPriority) do
    local device = findAudioDeviceByName(inputDevices, name)

    if device then
      device:setDefaultInputDevice()
      local defaultInput = hs.audiodevice.defaultInputDevice()
      local inputChanged = defaultInput and defaultInput:name() == name
      if inputChanged then
        if lastInputName ~= name then
          hs.notify.new({
            title = "Audio input switched",
            informativeText = name,
          }):send()
          lastInputName = name
        end

        return
      end
    end
  end
end

local function applyAudioPriority()
  setFirstAvailableInput()
end

local function scheduleAudioPriority()
  if audioDebounceTimer then
    audioDebounceTimer:stop()
  end

  audioDebounceTimer = hs.timer.doAfter(1, applyAudioPriority)
end

hs.audiodevice.watcher.setCallback(scheduleAudioPriority)
hs.audiodevice.watcher.start()
-- Manual fallback: press ctrl+alt+cmd+A to re-apply input priority.
hs.hotkey.bind({ "cmd", "alt", "ctrl" }, "A", applyAudioPriority)

-----------------------------------------------------------------------------
-- Local modules
-----------------------------------------------------------------------------
-- Discord mute over HTTP + thumb-button back-nav suppression. Loaded for its
-- side effects (hotkeys, http server, event tap). See hammerspoon/discord_ptt.lua.
require("discord_ptt")

-----------------------------------------------------------------------------
-- Auto-reload on file change
-----------------------------------------------------------------------------
-- uber_theme.lua is deliberately not watched: it is codegen output rewritten by
-- every `npm run build`, and nothing here requires it, so watching it would
-- reload Hammerspoon on every theme build for no effect.
local reloadOnChange = {
  [scriptDir .. "init.lua"] = true,
  [scriptDir .. "discord_ptt.lua"] = true,
}

local configWatcher = hs.pathwatcher
  .new(scriptDir, function(changedFiles)
    for _, changedFile in ipairs(changedFiles) do
      if reloadOnChange[changedFile] then
        hs.reload()
        return
      end
    end
  end)
  :start()

-----------------------------------------------------------------------------
-- Boot
-----------------------------------------------------------------------------
applyAudioPriority()
hs.alert.show("Hammerspoon loaded")

-----------------------------------------------------------------------------
-- Setup note (one-time)
-----------------------------------------------------------------------------
-- To load this config, put the following in ~/.hammerspoon/init.lua:
--
--   dofile("/Users/mhaslinsky/Developer/mac-customization/hammerspoon/init.lua")
--
-- That's the only line that needs to live outside this repo.
