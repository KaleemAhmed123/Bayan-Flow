const MAX_ID_LENGTH = 160;
const MAX_MESSAGE_LENGTH = 500;

export type RecorderStartedPayload = {
  ok: true;
  sessionId: string;
};

export type RecorderStoppedPayload = {
  sessionId: string;
  audio: ArrayBuffer;
  stopReason: RecorderStopReason;
};

export type RecorderErrorPayload = {
  sessionId: string;
  message: string;
};

export type RecorderMicTestedPayload = {
  ok: boolean;
  requestId: string;
  message?: string;
};

export type RecorderStopReason = "manual" | "silence" | "max_duration" | "unknown";

export function validateRecorderStartedPayload(payload: unknown, activeSessionId: string | null): RecorderStartedPayload {
  const value = objectPayload(payload);
  const sessionId = requiredId(value.sessionId, "sessionId");
  if (sessionId !== activeSessionId) {
    throw new Error("Invalid recorder session id.");
  }

  if (value.ok !== true) {
    throw new Error("Invalid recorder started payload.");
  }

  return { ok: true, sessionId };
}

export function validateRecorderStoppedPayload(
  payload: unknown,
  activeSessionId: string | null,
  maxAudioBytes: number,
): RecorderStoppedPayload {
  const value = objectPayload(payload);
  const sessionId = requiredId(value.sessionId, "sessionId");
  if (sessionId !== activeSessionId) {
    throw new Error("Invalid recorder session id.");
  }

  if (!(value.audio instanceof ArrayBuffer)) {
    throw new Error("Invalid recorder audio payload.");
  }

  if (maxAudioBytes > 0 && value.audio.byteLength > maxAudioBytes) {
    throw new Error("Recording is too large. Try a shorter dictation.");
  }

  return { sessionId, audio: value.audio, stopReason: optionalStopReason(value.stopReason) };
}

export function validateRecorderErrorPayload(payload: unknown, activeSessionId: string | null): RecorderErrorPayload {
  const value = objectPayload(payload);
  const sessionId = requiredId(value.sessionId, "sessionId");
  if (sessionId !== activeSessionId) {
    throw new Error("Invalid recorder session id.");
  }

  return {
    sessionId,
    message: optionalMessage(value.message, "Recording failed."),
  };
}

export function validateRecorderMicTestedPayload(payload: unknown, activeRequestId: string | null): RecorderMicTestedPayload {
  const value = objectPayload(payload);
  const requestId = requiredId(value.requestId, "requestId");
  if (requestId !== activeRequestId) {
    throw new Error("Invalid microphone test request id.");
  }

  if (typeof value.ok !== "boolean") {
    throw new Error("Invalid microphone test payload.");
  }

  return {
    ok: value.ok,
    requestId,
    message: optionalMessage(value.message),
  };
}

function objectPayload(payload: unknown): Record<string, unknown> {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("Invalid recorder IPC payload.");
  }

  return payload as Record<string, unknown>;
}

function requiredId(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim() || value.length > MAX_ID_LENGTH) {
    throw new Error(`Invalid recorder ${field}.`);
  }

  return value;
}

function optionalMessage(value: unknown, fallback = ""): string {
  if (value === undefined || value === null) {
    return fallback;
  }

  if (typeof value !== "string") {
    throw new Error("Invalid recorder message.");
  }

  const trimmed = value.trim();
  return trimmed.slice(0, MAX_MESSAGE_LENGTH) || fallback;
}

function optionalStopReason(value: unknown): RecorderStopReason {
  if (value === undefined || value === null) {
    return "unknown";
  }

  if (value === "manual" || value === "silence" || value === "max_duration") {
    return value;
  }

  return "unknown";
}
