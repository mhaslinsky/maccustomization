-- Hammerspoon entry point for Mac customization.
-- Loaded from ~/.hammerspoon/init.lua via a one-line bootstrap stub (see
-- the setup note at the bottom).
--
-- Window borders were moved to JankyBorders (`borders` daemon) in favor
-- of a native implementation — see `borders/bordersrc` (codegen'd from
-- the same `src/widget_theme.ts` design tokens that feed the widgets).
-- This file is now the scaffolding for future Hammerspoon-based
-- customization (hotkeys, automations, focus dim, workspace indicator,
-- etc).

-- Make this directory importable so `require("uber_theme")` resolves from
-- here regardless of where this init.lua was dofile'd from.
local scriptDir = (debug.getinfo(1, "S").source:sub(2):match("(.*/)")) or "./"
package.path = scriptDir .. "?.lua;" .. package.path

-- Load the shared theme tokens. Not currently consumed by anything in
-- this file, but loading it ensures the codegen pipeline is healthy —
-- an `npm run build` that broke `uber_theme.lua` would error here on
-- reload, which is a useful early warning.
local theme = require("uber_theme")
_ = theme -- luacheck: ignore (held so the require isn't optimized away)

-----------------------------------------------------------------------------
-- Auto-reload on file change
-----------------------------------------------------------------------------
-- Watches this directory so edits to init.lua OR regenerations of
-- uber_theme.lua (from `npm run build`) trigger an immediate reload.
local configWatcher = hs.pathwatcher
  .new(scriptDir, function(changedFiles)
    for _, f in ipairs(changedFiles) do
      if f:match("%.lua$") then
        hs.reload()
        return
      end
    end
  end)
  :start()

-----------------------------------------------------------------------------
-- Boot
-----------------------------------------------------------------------------
hs.alert.show("Hammerspoon loaded")

-----------------------------------------------------------------------------
-- Setup note (one-time)
-----------------------------------------------------------------------------
-- To load this config, put the following in ~/.hammerspoon/init.lua:
--
--   dofile("/Users/mhaslinsky/Developer/mac-customization/hammerspoon/init.lua")
--
-- That's the only line that needs to live outside this repo.
