export type InputAssistSpeechReadiness =
  | "ready"
  | "cancel_active_recording"
  | "blocked_processing"
  | "blocked_missing_api_key";

export function getInputAssistSpeechReadiness(state: {
  hasGroqApiKey: boolean;
  isRecording: boolean;
  isProcessing: boolean;
}): InputAssistSpeechReadiness {
  if (!state.hasGroqApiKey) {
    return "blocked_missing_api_key";
  }

  if (state.isProcessing) {
    return "blocked_processing";
  }

  if (state.isRecording) {
    return "cancel_active_recording";
  }

  return "ready";
}
