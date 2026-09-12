import { BrowserWindow } from "./electron.js";

/**
 * The security defaults every BayanFlow window gets.
 *
 * This used to be copy-pasted, byte for byte, into three files — and one of the
 * copies lived in the audio recorder, so two windows imported their hardening
 * from a module about microphones. Three copies that happen to agree is not the
 * same as three copies that must agree: the next protection added here would
 * have landed in one file and been silently missed in the other two.
 *
 * Nothing in this app ever opens a second window or navigates away from its own
 * loaded file, so both are denied outright rather than filtered.
 */
export function hardenWindow(window: InstanceType<typeof BrowserWindow>): void {
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event) => event.preventDefault());
}
