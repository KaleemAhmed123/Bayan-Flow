import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { app, safeStorage } from "./electron.js";
import { parseHotkey } from "./hotkey/hotkey-parser.js";
import { logger } from "./observability/logger.js";
import { normalizeError } from "./observability/errors.js";
import { DEFAULT_CONTEXT_BLOCKLIST, parseBlocklist, serializeBlocklist } from "./context/context-rules.js";
import { isDefaultEndpoint } from "./llm/client-options.js";
import type { AppConfig } from "./types.js";

const DEFAULT_CONFIG: AppConfig = {
  groqApiKey: "",
  hotkey: "Ctrl+Shift+Space",
  inputAssistHotkey: "Ctrl+Shift+Enter",
  // Off until measured: it relies on uiohook still seeing a key the OS is
  // suppressing, which is reasoned rather than proven.
  suppressHotkeyInOtherApps: false,
  showDock: true,
  autoPaste: true,
  historyEnabled: true,
  cleanupEnabled: true,
  openAtLogin: false,
  transcriptionModel: "whisper-large-v3",
  cleanupModel: "openai/gpt-oss-120b",
  // A smaller sibling of the primary: different capacity class, so a rate limit
  // on one is unlikely to apply to the other.
  cleanupFallbackModel: "openai/gpt-oss-20b",
  transcriptionLanguage: "",
  outputLanguage: "",
  customVocabulary: "",
  // Metadata context is on by default: a window title is a small exposure and a
  // large quality win. The screenshot is the opposite trade, so it is opt-in.
  contextCaptureEnabled: true,
  contextScreenshotEnabled: false,
  contextModel: "qwen/qwen3.6-27b",
  contextBlocklist: serializeBlocklist(DEFAULT_CONTEXT_BLOCKLIST),
  // Empty base URLs mean the hosted provider; zero timeouts mean the built-in
  // defaults. Both are "unset" rather than a value we have to keep in sync.
  transcriptionBaseUrl: "",
  chatBaseUrl: "",
  transcriptionTimeoutMs: 0,
  cleanupTimeoutMs: 0,
  contextTimeoutMs: 0,
  microphoneId: "",
  preserveExactWording: false,
  instructionGuardEnabled: true,
  debugCaptureEnabled: false,
  silenceStopSeconds: 5,
  didTestMicrophone: false,
  didDictate: false,
  didRewrite: false,
};

/**
 * Language tags we accept, e.g. "en", "ur", "pt-BR". Deliberately permissive
 * about the exact tag: providers disagree on which ones they support, and a tag
 * the provider rejects produces a clear API error, whereas an over-strict
 * allowlist here silently drops a language the user actually needs.
 */
const LANGUAGE_TAG_PATTERN = /^[a-zA-Z]{2,3}(-[a-zA-Z0-9]{2,8})?$/;

/** Whole-field ceiling, so a paste accident cannot balloon every prompt we send. */
const MAX_VOCABULARY_CHARS = 2_000;
/** Per-term ceiling. A "term" longer than this is a sentence, not a vocabulary entry. */
export const MAX_VOCABULARY_TERM_CHARS = 80;
/** Term count ceiling. Beyond this the list stops helping the model and starts confusing it. */
export const MAX_VOCABULARY_TERMS = 100;

/**
 * Groq retires models and then answers them with 404 `model_not_found`, which
 * surfaces to the user as polish and rewrite silently failing. Changing the
 * default alone does not help anyone who already has the old id saved, so load
 * and save both remap through this table.
 *
 * Source: https://console.groq.com/docs/deprecations
 */
const RETIRED_MODELS = new Map<string, string>([
  ["llama-3.3-70b-versatile", "openai/gpt-oss-120b"],
  ["llama-3.1-70b-versatile", "openai/gpt-oss-120b"],
  ["llama-3.1-8b-instant", "openai/gpt-oss-20b"],
  ["qwen/qwen3-32b", "openai/gpt-oss-120b"],
  ["meta-llama/llama-4-scout-17b-16e-instruct", "openai/gpt-oss-120b"],
  ["deepseek-r1-distill-llama-70b", "openai/gpt-oss-120b"],
]);

const DEFAULT_MODEL_PATTERN = /^[a-zA-Z0-9._:/-]+$/;
const MAX_MODEL_LENGTH = 120;
const ENCRYPTED_PREFIX = "safeStorage:v1:";

type StoredConfig = Partial<AppConfig> & {
  groqApiKeyEncrypted?: string;
};

export type SecureStorage = {
  isEncryptionAvailable(): boolean;
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
};

/**
 * Whether this machine can encrypt the stored key.
 *
 * On Windows safeStorage is DPAPI-backed and effectively always available, so
 * the false branch is a corner — but it was a silent one: the key was written to
 * config.json in plain text and the only trace was a log field nobody reads.
 */
export function isKeyEncryptionAvailable(secureStorage: SecureStorage | undefined = safeStorage): boolean {
  return Boolean(secureStorage?.isEncryptionAvailable?.());
}

export class ConfigStore {
  private readonly filePath: string;

  constructor(
    filePath = path.join(app.getPath("userData"), "config.json"),
    private readonly secureStorage: SecureStorage | undefined = safeStorage,
  ) {
    this.filePath = filePath;
  }

  async load(): Promise<AppConfig> {
    try {
      const raw = await readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as StoredConfig;
      void logger.info("config.load.success");
      return normalizeConfig({
        ...parsed,
        groqApiKey: readStoredApiKey(parsed, this.secureStorage),
      });
    } catch (error) {
      const normalized = normalizeError("config", error);
      void logger.warn("config.load.fallback", { error: normalized });
      return normalizeConfig({});
    }
  }

  async save(nextConfig: AppConfig): Promise<void> {
    const config = normalizeConfig(nextConfig);
    const encryptedApiKey = encryptApiKey(config.groqApiKey, this.secureStorage);
    const storedConfig: StoredConfig = {
      ...config,
      groqApiKey: encryptedApiKey ? "" : config.groqApiKey,
      groqApiKeyEncrypted: encryptedApiKey,
    };
    await mkdir(path.dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, `${JSON.stringify(storedConfig, null, 2)}\n`, "utf8");
    void logger.info("config.save.success", {
      hasGroqApiKey: Boolean(config.groqApiKey),
      apiKeyStorage: encryptedApiKey ? "encrypted" : config.groqApiKey ? "plaintext_fallback" : "empty",
      hotkey: config.hotkey,
      inputAssistHotkey: config.inputAssistHotkey,
      suppressHotkeyInOtherApps: config.suppressHotkeyInOtherApps,
      showDock: config.showDock,
      autoPaste: config.autoPaste,
      historyEnabled: config.historyEnabled,
      cleanupEnabled: config.cleanupEnabled,
      openAtLogin: config.openAtLogin,
      transcriptionModel: config.transcriptionModel,
      cleanupModel: config.cleanupModel,
      cleanupFallbackModel: config.cleanupFallbackModel || "none",
      transcriptionLanguage: config.transcriptionLanguage || "auto",
      outputLanguage: config.outputLanguage || "same",
      // A count, never the terms themselves: vocabulary is user content and the
      // logger's job is to stay free of it.
      vocabularyTerms: parseVocabularyTerms(config.customVocabulary).length,
      contextCaptureEnabled: config.contextCaptureEnabled,
      contextScreenshotEnabled: config.contextScreenshotEnabled,
      contextModel: config.contextModel,
      contextBlocklistPatterns: parseBlocklist(config.contextBlocklist).length,
      hasMicrophoneId: Boolean(config.microphoneId),
      preserveExactWording: config.preserveExactWording,
      instructionGuardEnabled: config.instructionGuardEnabled,
      debugCaptureEnabled: config.debugCaptureEnabled,
      silenceStopSeconds: config.silenceStopSeconds,
    });
  }
}

function readStoredApiKey(config: StoredConfig, secureStorage: SecureStorage | undefined): string {
  if (config.groqApiKeyEncrypted) {
    try {
      const decrypted = decryptApiKey(config.groqApiKeyEncrypted, secureStorage);
      if (decrypted) {
        return decrypted;
      }
    } catch (error) {
      void logger.warn("config.api_key.decrypt_failed", { error: normalizeError("config", error) });
    }
  }

  const plaintextKey = typeof config.groqApiKey === "string" ? config.groqApiKey.trim() : "";
  return plaintextKey || process.env.GROQ_API_KEY || "";
}

function encryptApiKey(apiKey: string, secureStorage: SecureStorage | undefined): string {
  if (!apiKey) {
    return "";
  }

  if (!secureStorage?.isEncryptionAvailable?.()) {
    return "";
  }

  return `${ENCRYPTED_PREFIX}${secureStorage.encryptString(apiKey).toString("base64")}`;
}

function decryptApiKey(value: string, secureStorage: SecureStorage | undefined): string {
  if (!value.startsWith(ENCRYPTED_PREFIX)) {
    return "";
  }

  if (!secureStorage?.isEncryptionAvailable?.()) {
    throw new Error("Secure credential storage is not available on this system.");
  }

  const encrypted = Buffer.from(value.slice(ENCRYPTED_PREFIX.length), "base64");
  return secureStorage.decryptString(encrypted);
}

export function normalizeConfig(input: Partial<AppConfig>): AppConfig {
  // Whether each endpoint still points at the provider whose deprecation table
  // we carry. Computed before the model fields, because they depend on it.
  const hostedTranscription = isDefaultEndpoint(input.transcriptionBaseUrl);
  const hostedChat = isDefaultEndpoint(input.chatBaseUrl);

  return {
    groqApiKey: stringOr(input.groqApiKey, process.env.GROQ_API_KEY || ""),
    hotkey: hotkeyOr(input.hotkey, DEFAULT_CONFIG.hotkey),
    inputAssistHotkey: hotkeyOr(input.inputAssistHotkey, DEFAULT_CONFIG.inputAssistHotkey),
    suppressHotkeyInOtherApps: booleanOr(input.suppressHotkeyInOtherApps, DEFAULT_CONFIG.suppressHotkeyInOtherApps),
    showDock: booleanOr(input.showDock, DEFAULT_CONFIG.showDock),
    autoPaste: booleanOr(input.autoPaste, DEFAULT_CONFIG.autoPaste),
    historyEnabled: booleanOr(input.historyEnabled, DEFAULT_CONFIG.historyEnabled),
    cleanupEnabled: booleanOr(input.cleanupEnabled, DEFAULT_CONFIG.cleanupEnabled),
    openAtLogin: booleanOr(input.openAtLogin, DEFAULT_CONFIG.openAtLogin),
    transcriptionModel: modelOr(input.transcriptionModel, DEFAULT_CONFIG.transcriptionModel, hostedTranscription),
    cleanupModel: modelOr(input.cleanupModel, DEFAULT_CONFIG.cleanupModel, hostedChat),
    // An empty fallback is a legitimate choice, so it is not replaced by the
    // default the way an invalid one is.
    cleanupFallbackModel: optionalModelOr(input.cleanupFallbackModel, DEFAULT_CONFIG.cleanupFallbackModel, hostedChat),
    transcriptionLanguage: languageOr(input.transcriptionLanguage),
    outputLanguage: languageOr(input.outputLanguage),
    customVocabulary: normalizeVocabulary(input.customVocabulary),
    contextCaptureEnabled: booleanOr(input.contextCaptureEnabled, DEFAULT_CONFIG.contextCaptureEnabled),
    contextScreenshotEnabled: booleanOr(input.contextScreenshotEnabled, DEFAULT_CONFIG.contextScreenshotEnabled),
    contextModel: modelOr(input.contextModel, DEFAULT_CONFIG.contextModel, hostedChat),
    // An empty blocklist is a real choice, but a MISSING one is not the same
    // thing: an older config that predates this setting must get the defaults,
    // not silently end up with no protection at all.
    contextBlocklist:
      typeof input.contextBlocklist === "string"
        ? serializeBlocklist(parseBlocklist(input.contextBlocklist))
        : DEFAULT_CONFIG.contextBlocklist,
    // Device ids are opaque browser strings, so the only sane validation is a
    // length cap; a stale id is handled at record time, not here.
    transcriptionBaseUrl: stringOr(input.transcriptionBaseUrl, DEFAULT_CONFIG.transcriptionBaseUrl),
    chatBaseUrl: stringOr(input.chatBaseUrl, DEFAULT_CONFIG.chatBaseUrl),
    transcriptionTimeoutMs: timeoutOr(input.transcriptionTimeoutMs, DEFAULT_CONFIG.transcriptionTimeoutMs),
    cleanupTimeoutMs: timeoutOr(input.cleanupTimeoutMs, DEFAULT_CONFIG.cleanupTimeoutMs),
    contextTimeoutMs: timeoutOr(input.contextTimeoutMs, DEFAULT_CONFIG.contextTimeoutMs),
    microphoneId: typeof input.microphoneId === "string" ? input.microphoneId.trim().slice(0, 200) : "",
    preserveExactWording: booleanOr(input.preserveExactWording, DEFAULT_CONFIG.preserveExactWording),
    instructionGuardEnabled: booleanOr(input.instructionGuardEnabled, DEFAULT_CONFIG.instructionGuardEnabled),
    debugCaptureEnabled: booleanOr(input.debugCaptureEnabled, DEFAULT_CONFIG.debugCaptureEnabled),
    silenceStopSeconds: silenceSecondsOr(input.silenceStopSeconds, DEFAULT_CONFIG.silenceStopSeconds),
    didTestMicrophone: booleanOr(input.didTestMicrophone, DEFAULT_CONFIG.didTestMicrophone),
    didDictate: booleanOr(input.didDictate, DEFAULT_CONFIG.didDictate),
    didRewrite: booleanOr(input.didRewrite, DEFAULT_CONFIG.didRewrite),
  };
}

/**
 * Splits the stored vocabulary blob into clean terms. One place, so the Settings
 * field, the transcription prompt, and the cleanup prompt can never disagree
 * about what counts as a term.
 */
export function parseVocabularyTerms(vocabulary: string): string[] {
  const seen = new Set<string>();
  const terms: string[] = [];

  for (const line of vocabulary.split(/[\r\n]+/)) {
    const term = line.trim();
    if (!term || term.length > MAX_VOCABULARY_TERM_CHARS) {
      continue;
    }

    // Case-insensitive de-dupe, but the first spelling wins — the user typed
    // "GitHub" deliberately and we must not fold it into a later "github".
    const key = term.toLowerCase();
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    terms.push(term);
    if (terms.length >= MAX_VOCABULARY_TERMS) {
      break;
    }
  }

  return terms;
}

function normalizeVocabulary(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    return "";
  }

  return parseVocabularyTerms(value.slice(0, MAX_VOCABULARY_CHARS)).join("\n");
}

function languageOr(value: unknown): string {
  const language = typeof value === "string" ? value.trim() : "";
  // Empty is the meaningful default (auto-detect / no translation), so an
  // unrecognised tag falls back to empty rather than to a guess.
  return LANGUAGE_TAG_PATTERN.test(language) ? language : "";
}

function optionalModelOr(value: unknown, fallback: string, hosted = true): string {
  if (typeof value === "string" && !value.trim()) {
    return "";
  }

  return modelOr(value, fallback, hosted);
}

function hotkeyOr(value: unknown, fallback: string): string {
  const hotkey = stringOr(value, fallback);
  try {
    parseHotkey(hotkey);
    return hotkey;
  } catch {
    return fallback;
  }
}

/** Non-negative whole milliseconds. Anything else means "use the default". */
function timeoutOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.round(value) : fallback;
}

/**
 * Silence timeout in whole seconds.
 *
 * Floored at 2s because anything shorter clips the natural gap between
 * sentences, and capped at 30s so a mistyped 300 cannot leave the microphone
 * open for five minutes after the user has walked away.
 */
export const MIN_SILENCE_STOP_SECONDS = 2;
export const MAX_SILENCE_STOP_SECONDS = 30;

function silenceSecondsOr(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return fallback;
  }

  return Math.min(MAX_SILENCE_STOP_SECONDS, Math.max(MIN_SILENCE_STOP_SECONDS, Math.round(value)));
}

function stringOr(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function booleanOr(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

/**
 * `hosted` says whether calls still go to the provider whose deprecations this
 * table describes. On a custom endpoint the remap is switched off: a local
 * runner serving a model that happens to share a retired name must not have it
 * silently rewritten into a hosted model the user never asked for, and a name
 * we have never heard of must pass through untouched.
 */
function modelOr(value: unknown, fallback: string, hosted = true): string {
  const model = stringOr(value, fallback);
  if (model.length > MAX_MODEL_LENGTH || !DEFAULT_MODEL_PATTERN.test(model)) {
    return fallback;
  }

  return hosted ? RETIRED_MODELS.get(model) ?? model : model;
}
