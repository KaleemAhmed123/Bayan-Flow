import assert from "node:assert/strict";
import test from "node:test";
import { MAX_VOCABULARY_TERMS, normalizeConfig, parseVocabularyTerms } from "../dist/config-store.js";

test("normalizes renderer-provided config before use", () => {
  const config = normalizeConfig({
    groqApiKey: "  gsk_test_key  ",
    hotkey: "",
    autoPaste: "yes",
    cleanupEnabled: false,
    transcriptionModel: "bad model name",
    cleanupModel: "llama-3.3-70b-versatile",
  });

  assert.equal(config.groqApiKey, "gsk_test_key");
  assert.equal(config.hotkey, "Ctrl+Shift+Space");
  assert.equal(config.inputAssistHotkey, "Ctrl+Shift+Enter");
  assert.equal(config.autoPaste, true);
  assert.equal(config.cleanupEnabled, false);
  assert.equal(config.transcriptionModel, "whisper-large-v3");
  // Groq decommissioned this model on 2026-08-16; saved configs must migrate off it.
  assert.equal(config.cleanupModel, "openai/gpt-oss-120b");
});

test("config migrates decommissioned Groq models to supported ones", () => {
  // A real user config carrying the retired id returned 404 model_not_found from
  // Groq, which broke both polish and rewrite. Load and save both run through
  // normalizeConfig, so migrating here fixes existing installs on next launch.
  for (const [retired, replacement] of [
    ["llama-3.3-70b-versatile", "openai/gpt-oss-120b"],
    ["llama-3.1-8b-instant", "openai/gpt-oss-20b"],
    ["deepseek-r1-distill-llama-70b", "openai/gpt-oss-120b"],
  ]) {
    assert.equal(normalizeConfig({ cleanupModel: retired }).cleanupModel, replacement);
  }
});

test("config leaves unknown but valid model names alone", () => {
  assert.equal(normalizeConfig({ cleanupModel: "openai/gpt-oss-120b" }).cleanupModel, "openai/gpt-oss-120b");
  assert.equal(normalizeConfig({ cleanupModel: "some/new-model-9" }).cleanupModel, "some/new-model-9");
});

/* ---------------------------------------------------------------- *
 * Language, vocabulary, and the fallback model
 * ---------------------------------------------------------------- */

test("language defaults to auto-detect, never to English", () => {
  const config = normalizeConfig({});
  // The product is multilingual by name. Defaulting to a language degrades
  // accented speech and silently breaks anyone not dictating in English.
  assert.equal(config.transcriptionLanguage, "");
  assert.equal(config.outputLanguage, "");
});

test("valid language tags are kept and junk falls back to auto-detect", () => {
  assert.equal(normalizeConfig({ transcriptionLanguage: "ur" }).transcriptionLanguage, "ur");
  assert.equal(normalizeConfig({ transcriptionLanguage: "pt-BR" }).transcriptionLanguage, "pt-BR");
  assert.equal(normalizeConfig({ outputLanguage: "  en  " }).outputLanguage, "en");

  for (const junk of ["english", "e", "12", "en_US!", 42, null]) {
    assert.equal(normalizeConfig({ transcriptionLanguage: junk }).transcriptionLanguage, "");
  }
});

test("vocabulary is de-duplicated case-insensitively, keeping the first spelling", () => {
  // "GitHub" was typed deliberately; a later "github" must not overwrite it.
  const config = normalizeConfig({ customVocabulary: "GitHub\ngithub\n  Aysha  \n\nAysha\nZubair" });
  assert.deepEqual(parseVocabularyTerms(config.customVocabulary), ["GitHub", "Aysha", "Zubair"]);
});

test("vocabulary drops blank and over-long entries", () => {
  const longTerm = "x".repeat(200);
  const config = normalizeConfig({ customVocabulary: `Aysha\n\n   \n${longTerm}\nZubair` });
  assert.deepEqual(parseVocabularyTerms(config.customVocabulary), ["Aysha", "Zubair"]);
});

test("vocabulary is capped so it cannot balloon every prompt", () => {
  const many = Array.from({ length: MAX_VOCABULARY_TERMS + 50 }, (_, index) => `term${index}`).join("\n");
  assert.equal(parseVocabularyTerms(normalizeConfig({ customVocabulary: many }).customVocabulary).length, MAX_VOCABULARY_TERMS);
});

test("an empty fallback model is respected, an invalid one is not", () => {
  // Empty means "no backup model", which is a real choice and must survive.
  assert.equal(normalizeConfig({ cleanupFallbackModel: "" }).cleanupFallbackModel, "");
  assert.equal(normalizeConfig({ cleanupFallbackModel: "   " }).cleanupFallbackModel, "");
  assert.equal(normalizeConfig({ cleanupFallbackModel: "openai/gpt-oss-20b" }).cleanupFallbackModel, "openai/gpt-oss-20b");
  assert.equal(normalizeConfig({ cleanupFallbackModel: "bad model!" }).cleanupFallbackModel, "openai/gpt-oss-20b");
});

test("a retired id in the fallback slot is remapped like any other model", () => {
  assert.equal(
    normalizeConfig({ cleanupFallbackModel: "llama-3.1-8b-instant" }).cleanupFallbackModel,
    "openai/gpt-oss-20b",
  );
});

/* ---------------------------------------------------------------- *
 * Retired-model remapping is scoped to the hosted provider
 * ---------------------------------------------------------------- */

test("a retired model id is still remapped on the hosted provider", () => {
  const config = normalizeConfig({ cleanupModel: "llama-3.3-70b-versatile" });
  assert.equal(config.cleanupModel, "openai/gpt-oss-120b");
});

test("a custom endpoint never has its model ids rewritten", () => {
  // The deprecation table describes one provider. A local runner serving a model
  // that happens to share a retired name must not be silently pointed at a
  // hosted model the user never asked for.
  const config = normalizeConfig({
    chatBaseUrl: "http://localhost:11434/v1",
    cleanupModel: "llama-3.3-70b-versatile",
    cleanupFallbackModel: "llama-3.1-8b-instant",
    contextModel: "qwen/qwen3-32b",
  });

  assert.equal(config.cleanupModel, "llama-3.3-70b-versatile");
  assert.equal(config.cleanupFallbackModel, "llama-3.1-8b-instant");
  assert.equal(config.contextModel, "qwen/qwen3-32b");
});

test("the two endpoints are scoped independently", () => {
  // Local speech-to-text with hosted cleanup is a real setup, so one custom
  // base URL must not switch remapping off for the other stage.
  const config = normalizeConfig({
    transcriptionBaseUrl: "http://localhost:8080/v1",
    cleanupModel: "llama-3.3-70b-versatile",
  });

  assert.equal(config.cleanupModel, "openai/gpt-oss-120b", "chat is still hosted, so it remaps");
});

test("timeouts default to zero and reject nonsense", () => {
  const defaults = normalizeConfig({});
  assert.equal(defaults.cleanupTimeoutMs, 0);

  const messy = normalizeConfig({ cleanupTimeoutMs: -5, contextTimeoutMs: 30_000 });
  assert.equal(messy.cleanupTimeoutMs, 0, "a negative timeout means use the default");
  assert.equal(messy.contextTimeoutMs, 30_000);
});
