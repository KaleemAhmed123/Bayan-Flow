export type RuntimeState =
  | "setup"
  | "ready"
  | "recording"
  | "processing"
  | "hotkey-unavailable"
  | "error";

/**
 * "default" cleans the transcript. "verbatim" keeps the speaker's exact wording
 * and only translates, which is the one job left for the model when the user has
 * asked for exact wording AND an output language.
 */
export type CleanupMode = "default" | "verbatim";

export type AppConfig = {
  groqApiKey: string;
  hotkey: string;
  inputAssistHotkey: string;
  /** Ask the OS to swallow our hotkeys so they do not also reach the focused app. */
  suppressHotkeyInOtherApps: boolean;
  showDock: boolean;
  autoPaste: boolean;
  historyEnabled: boolean;
  cleanupEnabled: boolean;
  openAtLogin: boolean;
  transcriptionModel: string;
  cleanupModel: string;
  /**
   * Used when the primary cleanup model fails or is rate limited. Empty disables
   * the fallback, in which case a failed cleanup falls back to the raw transcript
   * exactly as it did before.
   */
  cleanupFallbackModel: string;
  /**
   * BCP-47-ish language tag the speech model should listen for. Empty means
   * auto-detect, which is the default: forcing a language degrades accented
   * speech and makes the app useless to anyone not dictating in English.
   */
  transcriptionLanguage: string;
  /** Translate the final text into this language before pasting. Empty disables. */
  outputLanguage: string;
  /**
   * Newline-separated names, jargon, and product terms. Used two ways: as a
   * recognition bias on the speech model, and as a spelling reference during
   * cleanup. Never as content the model may introduce on its own.
   */
  customVocabulary: string;
  /**
   * Send the focused app name and window title with the cleanup request, so the
   * model can spell names it can see. Metadata only — no picture of the screen.
   */
  contextCaptureEnabled: boolean;
  /**
   * Additionally send a JPEG of the ACTIVE WINDOW to a vision model.
   *
   * Off by default and deliberately so: this is the only setting in the app that
   * sends a picture of the user's screen anywhere. See the capability audit.
   */
  contextScreenshotEnabled: boolean;
  /** Vision-capable model used to summarise what the user is doing. */
  contextModel: string;
  /** Newline-separated window-title substrings that are never looked at. */
  contextBlocklist: string;
  /**
   * OpenAI-compatible endpoint for speech-to-text. Empty means the hosted
   * provider. Set this to point at a local runner.
   */
  transcriptionBaseUrl: string;
  /** OpenAI-compatible endpoint for cleanup, rewrite and context. */
  chatBaseUrl: string;
  /** Per-stage request ceilings in milliseconds. Zero means use the default. */
  transcriptionTimeoutMs: number;
  cleanupTimeoutMs: number;
  contextTimeoutMs: number;
  /** Chosen audio input. Empty means the system default. */
  microphoneId: string;
  /** Skip cleanup and keep the speaker's exact words. Translation still applies. */
  preserveExactWording: boolean;
  /** Fall back to the raw transcript when cleanup looks like it answered the dictation. */
  instructionGuardEnabled: boolean;
  /**
   * Keep the last dictation's audio and prompts in memory so it can be exported
   * as a reproducible test case.
   *
   * Off by default. This is the one setting that deliberately retains what the
   * rest of the app refuses to store, so it exists only for debugging a specific
   * complaint and is never on by accident.
   */
  debugCaptureEnabled: boolean;
  /**
   * Onboarding steps the user has genuinely completed.
   *
   * These exist because the Home checklist used to infer "done" from the absence
   * of failure — `!lastMicError` is true on a fresh install where no test has
   * ever run, and `inputAssistHotkey` always has a default — so a brand new user
   * saw three of four steps already ticked. A checklist is a promise; it has to
   * record what actually happened, not what has not gone wrong yet.
   */
  /**
   * Seconds of silence that end a recording on their own.
   *
   * A setting rather than a constant because the right value depends on the
   * person, not the code: five seconds is fine for a chat reply and far too
   * short for composing an email, where pausing to think is the normal case.
   * Latched recordings feel this most — the whole point of latching is that the
   * user's finger is not the timer.
   */
  silenceStopSeconds: number;
  didTestMicrophone: boolean;
  didDictate: boolean;
  didRewrite: boolean;
};

export type DictationResult = {
  rawText: string;
  finalText: string;
  cleanupFallback?: boolean;
};

export type OperationContext = {
  sessionId?: string;
  requestId?: string;
};
