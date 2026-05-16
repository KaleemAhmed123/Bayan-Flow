import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ConfigStore } from "../dist/config-store.js";

function fakeStorage({ available = true } = {}) {
  return {
    isEncryptionAvailable: () => available,
    encryptString: (value) => Buffer.from(`enc:${value}`, "utf8"),
    decryptString: (value) => {
      const raw = value.toString("utf8");
      if (!raw.startsWith("enc:")) {
        throw new Error("bad encrypted value");
      }
      return raw.slice(4);
    },
  };
}

test("config store loads old plaintext key and saves encrypted key", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "bayan-config-"));
  const configPath = path.join(dir, "config.json");
  await writeFile(configPath, JSON.stringify({ groqApiKey: "gsk_plain", hotkey: "Ctrl+Shift+Space" }), "utf8");

  const store = new ConfigStore(configPath, fakeStorage());
  const loaded = await store.load();
  assert.equal(loaded.groqApiKey, "gsk_plain");

  await store.save(loaded);
  const saved = JSON.parse(await readFile(configPath, "utf8"));
  assert.equal(saved.groqApiKey, "");
  assert.match(saved.groqApiKeyEncrypted, /^safeStorage:v1:/);
  assert.equal(JSON.stringify(saved).includes("gsk_plain"), false);
});

test("config store loads encrypted key", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "bayan-config-"));
  const configPath = path.join(dir, "config.json");
  const encrypted = `safeStorage:v1:${Buffer.from("enc:gsk_secret", "utf8").toString("base64")}`;
  await writeFile(configPath, JSON.stringify({ groqApiKeyEncrypted: encrypted }), "utf8");

  const loaded = await new ConfigStore(configPath, fakeStorage()).load();
  assert.equal(loaded.groqApiKey, "gsk_secret");
});

test("config store saves plaintext fallback when encryption is unavailable", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "bayan-config-"));
  const configPath = path.join(dir, "config.json");
  await writeFile(configPath, "original", "utf8");

  const store = new ConfigStore(configPath, fakeStorage({ available: false }));
  await store.save({
    groqApiKey: "gsk_secret",
    hotkey: "Ctrl+Shift+Space",
    autoPaste: true,
    cleanupEnabled: true,
    openAtLogin: false,
    transcriptionModel: "whisper-large-v3",
    cleanupModel: "llama-3.3-70b-versatile",
  });

  const saved = JSON.parse(await readFile(configPath, "utf8"));
  assert.equal(saved.groqApiKey, "gsk_secret");
  assert.equal(saved.groqApiKeyEncrypted, "");
});

test("config store falls back to plaintext key when encrypted blob is invalid", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "bayan-config-"));
  const configPath = path.join(dir, "config.json");
  await writeFile(
    configPath,
    JSON.stringify({ groqApiKeyEncrypted: "safeStorage:v1:YmFk", groqApiKey: "gsk_plain" }),
    "utf8",
  );

  const loaded = await new ConfigStore(configPath, fakeStorage()).load();
  assert.equal(loaded.groqApiKey, "gsk_plain");
});

test("config store falls back to env key when encrypted blob is invalid and plaintext is empty", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "bayan-config-"));
  const configPath = path.join(dir, "config.json");
  await writeFile(configPath, JSON.stringify({ groqApiKeyEncrypted: "safeStorage:v1:YmFk", groqApiKey: "" }), "utf8");

  const previous = process.env.GROQ_API_KEY;
  process.env.GROQ_API_KEY = "gsk_env";
  try {
    const loaded = await new ConfigStore(configPath, fakeStorage()).load();
    assert.equal(loaded.groqApiKey, "gsk_env");
  } finally {
    if (previous === undefined) {
      delete process.env.GROQ_API_KEY;
    } else {
      process.env.GROQ_API_KEY = previous;
    }
  }
});
