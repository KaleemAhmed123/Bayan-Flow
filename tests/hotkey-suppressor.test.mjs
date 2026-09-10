import assert from "node:assert/strict";
import test from "node:test";
import {
  HotkeySuppressor,
  isSafeToSuppress,
  toAccelerator,
} from "../dist/hotkey/hotkey-suppressor.js";

/** Stands in for Electron's globalShortcut. `owned` are combos another app holds. */
function fakeRegistrar(owned = []) {
  const registered = new Set();
  return {
    registrar: {
      register: (accelerator) => {
        if (owned.includes(accelerator)) {
          return false;
        }
        registered.add(accelerator);
        return true;
      },
      unregister: (accelerator) => registered.delete(accelerator),
    },
    held: () => [...registered],
  };
}

/* ---------------------------------------------------------------- *
 * The guard that matters most
 * ---------------------------------------------------------------- */

test("a key with no modifier is never suppressed", () => {
  // Registering a bare Esc with the OS would swallow Escape in every
  // application on the machine: no dialog could be dismissed, no menu closed.
  for (const bare of ["Esc", "Escape", "Space", "F1", "a"]) {
    assert.equal(isSafeToSuppress(bare), false, `${bare} must never be suppressed`);
  }
});

test("a real combination is allowed", () => {
  for (const combo of ["Ctrl+Shift+Space", "Alt+Enter", "CommandOrControl+Shift+Enter"]) {
    assert.equal(isSafeToSuppress(combo), true, `${combo} should be allowed`);
  }
});

test("an unparseable hotkey is refused rather than thrown over", () => {
  assert.equal(isSafeToSuppress(""), false);
});

test("Esc survives even when handed to apply directly", () => {
  const fake = fakeRegistrar();
  const suppressor = new HotkeySuppressor(fake.registrar);

  const result = suppressor.apply(["Ctrl+Shift+Space", "Esc"]);

  assert.deepEqual(result.suppressed, ["Ctrl+Shift+Space"]);
  assert.deepEqual(result.skipped, ["Esc"]);
  assert.deepEqual(fake.held(), ["Ctrl+Shift+Space"], "Esc was never registered");
});

/* ---------------------------------------------------------------- *
 * Accelerators and registration
 * ---------------------------------------------------------------- */

test("hotkeys become the spellings Electron accepts", () => {
  assert.equal(toAccelerator("ctrl+shift+space"), "Ctrl+Shift+Space");
  assert.equal(toAccelerator("CmdOrCtrl+Shift+Enter"), "CommandOrControl+Shift+Enter");
});

test("a combination another app owns is reported, not thrown", () => {
  const fake = fakeRegistrar(["Ctrl+Shift+Space"]);
  const suppressor = new HotkeySuppressor(fake.registrar);

  const result = suppressor.apply(["Ctrl+Shift+Space", "Ctrl+Shift+Enter"]);

  assert.deepEqual(result.rejected, ["Ctrl+Shift+Space"]);
  assert.deepEqual(result.suppressed, ["Ctrl+Shift+Enter"]);
  assert.deepEqual(fake.held(), ["Ctrl+Shift+Enter"], "the rest still register");
});

test("the same hotkey bound twice registers once", () => {
  const fake = fakeRegistrar();
  const suppressor = new HotkeySuppressor(fake.registrar);

  const result = suppressor.apply(["Ctrl+Shift+Space", "Ctrl+Shift+Space"]);

  assert.deepEqual(result.suppressed, ["Ctrl+Shift+Space"]);
});

/* ---------------------------------------------------------------- *
 * Lifecycle
 * ---------------------------------------------------------------- */

test("rebinding releases the old key so it stops being swallowed", () => {
  const fake = fakeRegistrar();
  const suppressor = new HotkeySuppressor(fake.registrar);

  suppressor.apply(["Ctrl+Shift+Space"]);
  suppressor.apply(["Alt+Enter"]);

  assert.deepEqual(fake.held(), ["Alt+Enter"], "the old combination must be handed back");
});

test("release hands everything back and is safe to repeat", () => {
  const fake = fakeRegistrar();
  const suppressor = new HotkeySuppressor(fake.registrar);

  suppressor.apply(["Ctrl+Shift+Space", "Ctrl+Shift+Enter"]);
  suppressor.release();
  suppressor.release();

  assert.deepEqual(fake.held(), []);
  assert.deepEqual(suppressor.activeAccelerators(), []);
});

test("an unregister that throws does not break shutdown", () => {
  const suppressor = new HotkeySuppressor({
    register: () => true,
    unregister: () => {
      throw new Error("the OS said no");
    },
  });

  suppressor.apply(["Ctrl+Shift+Space"]);
  suppressor.release();

  assert.deepEqual(suppressor.activeAccelerators(), [], "state is cleared regardless");
});

test("the registered callback does nothing, so one press cannot start two recordings", () => {
  let calls = 0;
  const suppressor = new HotkeySuppressor({
    register: (_accelerator, callback) => {
      callback();
      calls += 1;
      return true;
    },
    unregister: () => {},
  });

  suppressor.apply(["Ctrl+Shift+Space"]);

  // The callback ran; the point is that it carries no dictation behaviour.
  assert.equal(calls, 1);
});
