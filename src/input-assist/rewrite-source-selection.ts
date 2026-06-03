export function shouldPreferClipboardSelectionOverUiaWhole(selectionText: string, wholeText: string): boolean {
  const normalizedSelection = trimTrailingLineEndings(selectionText);
  const normalizedWhole = trimTrailingLineEndings(wholeText);

  if (!normalizedSelection.trim()) {
    return false;
  }

  if (normalizedSelection === normalizedWhole) {
    return false;
  }

  if (/[\r\n]/.test(normalizedSelection)) {
    return true;
  }

  return !getWholeTextLines(normalizedWhole).some((line) => line === normalizedSelection);
}

export function shouldPreferClipboardWholeOverUiaWhole(clipboardText: string, uiaText: string): boolean {
  const normalizedClipboard = trimTrailingLineEndings(clipboardText);
  const normalizedUia = trimTrailingLineEndings(uiaText);

  if (!normalizedClipboard.trim()) {
    return false;
  }

  if (!normalizedUia.trim()) {
    return true;
  }

  if (normalizedClipboard === normalizedUia) {
    return false;
  }

  return normalizedClipboard.length > normalizedUia.length;
}

function getWholeTextLines(text: string): string[] {
  return text.split(/\r\n|\n|\r/g);
}

function trimTrailingLineEndings(text: string): string {
  return text.replace(/[\r\n]+$/g, "");
}
