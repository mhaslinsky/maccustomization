-- Re-apply the AeroSpace workspace layout when displays are attached or removed.
--
-- AeroSpace has no monitor-connect callback of its own (it offers only
-- on-focused-monitor-changed, which tracks focus, not topology), so the dock
-- and undock trigger has to come from here.

local SCRIPT = "/Users/mhaslinsky/Developer/mac-customization/scripts/dock-layout.mts"

-- hs.screen.watcher fires on resolution changes, arrangement changes and
-- spuriously on no change at all, so the monitor COUNT is what gates the sweep.
-- Without this guard the layout would be rearranged under the user at random.
local lastScreenCount = #hs.screen.allScreens()

local settleTimer = nil

local function runSweep()
  -- A login shell, because Hammerspoon inherits a minimal PATH with no node and
  -- the script's shebang is `env node`.
  local task = hs.task.new("/bin/zsh", function(exitCode, stdOut, stdErr)
    if exitCode ~= 0 then
      hs.notify.new({
        title = "Dock layout failed",
        informativeText = (stdErr ~= "" and stdErr or stdOut):gsub("\n.*", ""),
      }):send()
      print("dock-layout failed (" .. tostring(exitCode) .. "): " .. tostring(stdErr))
      return
    end
    print("dock-layout: " .. tostring(stdOut))
  end, { "-lc", SCRIPT })

  if task then
    task:start()
  else
    hs.notify.new({ title = "Dock layout failed", informativeText = "could not spawn the sweep" }):send()
  end
end

local function onScreenChange()
  local screenCount = #hs.screen.allScreens()
  if screenCount == lastScreenCount then
    return
  end
  lastScreenCount = screenCount

  -- Displays settle over a second or two; sweeping mid-transition would read a
  -- monitor list that is still changing.
  if settleTimer then
    settleTimer:stop()
  end
  settleTimer = hs.timer.doAfter(3, runSweep)
end

local screenWatcher = hs.screen.watcher.new(onScreenChange):start()

-- Manual fallback, matching the audio-priority hotkey convention above it.
hs.hotkey.bind({ "cmd", "alt", "ctrl" }, "D", runSweep)

return {
  watcher = screenWatcher,
  run = runSweep,
}
