import { ipcMain } from "./electron.js";

type IpcHandler = Parameters<typeof ipcMain.handle>[1];

/**
 * Registers IPC handlers and removes exactly the ones it registered.
 *
 * There used to be two hand-maintained lists — one that registered channels and
 * one that removed them — and keeping them in step was left to whoever added the
 * next handler. It drifted twice. `debug:last-case` was registered by
 * `SettingsWindow.show()` and never removed, so the second `show()` of a run hit
 * Electron's "attempted to register a second handler" throw before the window was
 * created: Settings opened once per app run and then failed silently forever.
 * `recorder:devices` had the same gap, harmless only because the recorder is
 * never re-initialised.
 *
 * One list fixes both, and the removal cannot fall behind the registration
 * because there is nothing left to keep in sync.
 */
export class IpcHandlerSet {
  private readonly channels: string[] = [];

  handle(channel: string, listener: IpcHandler): void {
    this.channels.push(channel);
    ipcMain.handle(channel, listener);
  }

  removeAll(): void {
    for (const channel of this.channels) {
      ipcMain.removeHandler(channel);
    }

    this.channels.length = 0;
  }

  /** Channels currently registered by this set. Used by the regression test. */
  get registered(): readonly string[] {
    return this.channels;
  }
}
