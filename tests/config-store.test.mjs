import assert from "node:assert/strict";
import test from "node:test";
import { normalizeConfig } from "../dist/config-store.js";

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
