export type AppStatus = "idle" | "listening" | "processing" | "confirm" | "pasting" | "error";
export type RuntimeState =
  | "setup"
  | "ready"
  | "recording"
  | "processing"
  | "input-assist"
  | "hotkey-unavailable"
  | "error";

export type CleanupMode = "default";

export type AppConfig = {
  groqApiKey: string;
  hotkey: string;
  inputAssistHotkey: string;
  inputAssistEnabledOnStartup: boolean;
  autoPaste: boolean;
  cleanupEnabled: boolean;
  openAtLogin: boolean;
  transcriptionModel: string;
  cleanupModel: string;
};

export type StatusMessage = {
  status: AppStatus;
  message: string;
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
