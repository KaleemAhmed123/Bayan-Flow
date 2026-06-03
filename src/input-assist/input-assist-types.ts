export type InputAssistBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type InputAssistTarget = {
  targetId: string;
  windowHandle: number;
  controlType: string;
  bounds: InputAssistBounds;
  canReadText: boolean;
  canWriteText: boolean;
};

export type TextSourceScope = "selection" | "whole";

export type InputAssistTextSource = {
  target: InputAssistTarget;
  scope: TextSourceScope;
  text: string;
};

export type IconPosition = {
  x: number;
  y: number;
};

const MIN_INPUT_WIDTH = 24;
const MIN_INPUT_HEIGHT = 12;

export function normalizeInputAssistTarget(value: unknown): InputAssistTarget | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Partial<InputAssistTarget>;
  const bounds = normalizeBounds(candidate.bounds);
  if (
    !bounds ||
    typeof candidate.targetId !== "string" ||
    !candidate.targetId ||
    typeof candidate.windowHandle !== "number" ||
    !Number.isFinite(candidate.windowHandle) ||
    typeof candidate.controlType !== "string"
  ) {
    return null;
  }

  return {
    targetId: candidate.targetId,
    windowHandle: candidate.windowHandle,
    controlType: candidate.controlType,
    bounds,
    canReadText: candidate.canReadText === true,
    canWriteText: candidate.canWriteText === true,
  };
}

export function normalizeBounds(value: unknown): InputAssistBounds | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Partial<InputAssistBounds>;
  const x = Number(candidate.x);
  const y = Number(candidate.y);
  const width = Number(candidate.width);
  const height = Number(candidate.height);
  if (![x, y, width, height].every(Number.isFinite) || width < MIN_INPUT_WIDTH || height < MIN_INPUT_HEIGHT) {
    return null;
  }

  return {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.round(width),
    height: Math.round(height),
  };
}

export function iconPositionForBounds(
  bounds: InputAssistBounds,
  iconSize: number,
  workArea: InputAssistBounds,
): IconPosition {
  const margin = 8;
  const preferredX = bounds.x + bounds.width - iconSize - margin;
  const preferredY = bounds.y + Math.max(0, Math.round((bounds.height - iconSize) / 2));

  return {
    x: clamp(preferredX, workArea.x + margin, workArea.x + workArea.width - iconSize - margin),
    y: clamp(preferredY, workArea.y + margin, workArea.y + workArea.height - iconSize - margin),
  };
}

function clamp(value: number, min: number, max: number): number {
  if (max < min) {
    return min;
  }

  return Math.min(max, Math.max(min, value));
}
