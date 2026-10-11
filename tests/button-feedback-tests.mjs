import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
const source = (
  await readFile(new URL("../frontend/ui-feedback.js", import.meta.url), "utf8")
).replaceAll("export ", "");
const preferences = new Map();
let starts = 0,
  resumes = 0,
  listener;
const param = {
  setValueAtTime() {},
  linearRampToValueAtTime() {},
  exponentialRampToValueAtTime() {},
};
class Audio {
  state = "suspended";
  currentTime = 10;
  destination = {};
  async resume() {
    resumes++;
    this.state = "running";
  }
  createOscillator() {
    return {
      frequency: param,
      connect() {},
      disconnect() {},
      start() {
        starts++;
      },
      stop() {},
    };
  }
  createGain() {
    return { gain: param, connect() {}, disconnect() {} };
  }
}
const context = vm.createContext({
  window: { AudioContext: Audio },
  localStorage: {
    getItem: (k) => preferences.get(k),
    setItem: (k, v) => preferences.set(k, v),
  },
  document: { addEventListener: (name, fn) => (listener = fn) },
});
vm.runInContext(source, context);
assert.equal(await context.playButtonSound(), true);
assert.equal(resumes, 1);
assert.equal(starts, 1);
context.setButtonSounds(false);
assert.equal(await context.playButtonSound(), false);
assert.equal(starts, 1);
assert.equal(await context.playButtonSound({ preview: true }), true);
assert.equal(starts, 2);
context.initButtonFeedback();
const button = {
  disabled: true,
  hasAttribute: () => false,
  getAttribute: () => null,
};
context.setButtonSounds(true);
listener({ isTrusted: true, target: { closest: () => button } });
assert.equal(starts, 2);
button.disabled = false;
listener({ isTrusted: false, target: { closest: () => button } });
assert.equal(starts, 2);
listener({ isTrusted: true, target: { closest: () => button } });
assert.equal(starts, 3);
console.log(
  "PASS: audio resume, trusted clicks, disabled/untrusted suppression, mute preference and explicit sound preview",
);
// The actual Create click uses local audio and a press animation, not a test button.
let plays = 0,
  animations = 0,
  clickHandler;
class Clip {
  constructor(url) {
    assert.equal(url, "/button-click.wav");
  }
  async play() {
    plays++;
  }
}
const direct = vm.createContext({
  window: { Audio: Clip, matchMedia: () => ({ matches: false }) },
  localStorage: { getItem: () => "on" },
  document: { addEventListener: (name, fn) => (clickHandler = fn) },
});
vm.runInContext(source, direct);
direct.initButtonFeedback();
const create = {
  disabled: false,
  hasAttribute: () => false,
  getAttribute: () => null,
  animate(frames, options) {
    animations++;
    assert.equal(options.duration, 180);
  },
};
clickHandler({ isTrusted: true, target: { closest: () => create } });
await Promise.resolve();
assert.equal(plays, 1);
assert.equal(animations, 1);
clickHandler({ isTrusted: true, target: { closest: () => create } });
assert.equal(plays, 2, "Repeated Create clicks replay the tap");
class UnavailableClip {
  async play() {
    throw new Error("Unsupported clip");
  }
}
const fallback = vm.createContext({
  window: { Audio: UnavailableClip, AudioContext: Audio },
  localStorage: { getItem: () => "on" },
});
vm.runInContext(source, fallback);
assert.equal(await fallback.playButtonSound(), true);
console.log(
  "PASS: actual button clicks play local tap, animate on press, replay and fall back to Web Audio",
);
