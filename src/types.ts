export type RuntimeState =
  | "setup"
  | "ready"
  | "recording"
  | "processing"
  | "hotkey-unavailable"
  | "error";

export type CleanupMode = "default";

export type AppConfig = {
  groqApiKey: string;
  hotkey: string;
  inputAssistHotkey: string;
  showDock: boolean;
  autoPaste: boolean;
  cleanupEnabled: boolean;
  openAtLogin: boolean;
  transcriptionModel: string;
  cleanupModel: string;
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
