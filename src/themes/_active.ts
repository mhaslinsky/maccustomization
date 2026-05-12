// Active theme pointer. Rewritten by `npm run theme <name>`.
// Every other consumer (widget_theme.ts, the hammerspoon codegen, and the
// borders codegen) reads the look through this file, so flipping one line
// here changes the look everywhere on the next `npm run build`.
export * from "./obsidian-glass.js";
