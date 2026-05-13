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
  assert.equal(config.autoPaste, false);
  assert.equal(config.cleanupEnabled, false);
  assert.equal(config.transcriptionModel, "whisper-large-v3-turbo");
  assert.equal(config.cleanupModel, "llama-3.3-70b-versatile");
});
