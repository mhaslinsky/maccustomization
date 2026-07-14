declare module "uebersicht" {
  import type * as ReactNamespace from "react";
  export function run(command: string): Promise<string>;
  // Übersicht re-exports the React it bundles for the WebView. Importing it
  // here (rather than from "react", which isn't an installed runtime package)
  // gives widgets typed hooks that resolve against Übersicht's own React at
  // runtime via its Browserify pipeline.
  export const React: typeof ReactNamespace;
}
