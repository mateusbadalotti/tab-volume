const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const vm = require("node:vm");

test("Capture, gain, continuity, cleanup and failure recovery", async () => {
  let listener;
  let constraints;
  let ended;
  let fail = false;
  let resumed = 0;
  let closed = 0;
  let stopped = 0;
  let target;
  const connections = [];
  const track = { stop: () => { stopped++; }, addEventListener: (type, callback) => { ended = callback; } };
  const gain = { gain: { value: 1, cancelScheduledValues: () => {}, setTargetAtTime: value => { target = value; } }, connect: destination => connections.push(destination), disconnect: () => {} };
  const source = { connect: node => connections.push(node), disconnect: () => {} };
  const chrome = { runtime: {
    id: "extension",
    getURL: path => `chrome-extension://extension/${path}`,
    onMessage: { addListener: callback => { listener = callback; } }
  } };
  class AudioContext {
    currentTime = 1;
    destination = "speakers";
    createGain() { return gain; }
    createMediaStreamSource() { return source; }
    async resume() { resumed++; if (fail) throw new Error("Resume failed"); }
    async close() { closed++; }
  }
  const navigator = { mediaDevices: { getUserMedia: async value => {
    constraints = value;
    return { getTracks: () => [track], getAudioTracks: () => [track] };
  } } };
  vm.runInNewContext(readFileSync(`${__dirname}/offscreen.js`, "utf8"), { chrome, navigator, AudioContext });
  const sender = { id: "extension", url: chrome.runtime.getURL("background.js") };
  const send = message => new Promise(resolve => listener({ ...message, target: "audio" }, sender, resolve));
  assert.equal(listener({ target: "audio" }, { id: "extension", url: "https://example.com" }, () => {}), undefined);
  await send({ type: "start", tabId: 1, streamId: "stream", volume: 200 });
  assert.equal(constraints.audio.mandatory.chromeMediaSourceId, "stream");
  assert.equal(constraints.video, false);
  assert.equal(gain.gain.value, 2);
  assert.equal(connections[0], gain);
  assert.equal(connections[1], "speakers");
  assert.equal(resumed, 1);
  await send({ type: "volume", tabId: 1, volume: 150 });
  assert.equal(target, 1.5);
  assert.equal((await send({ type: "state" })).volumes[1], 150);
  ended();
  assert.equal(stopped, 1);
  assert.equal(closed, 1);
  assert.equal((await send({ type: "state" })).volumes[1], undefined);
  await send({ type: "start", tabId: 2, streamId: "second", volume: 0 });
  assert.equal(gain.gain.value, 0);
  await send({ type: "stop", tabId: 2 });
  assert.equal(closed, 2);
  fail = true;
  assert.match((await send({ type: "start", tabId: 3, streamId: "failed", volume: 200 })).error, /Could not/);
  assert.equal(stopped, 3);
  assert.equal(closed, 3);
  assert.equal((await send({ type: "state" })).volumes[3], undefined);
});
