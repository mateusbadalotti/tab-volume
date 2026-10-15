const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const vm = require("node:vm");

test("Per-tab volume, queued adjustments, permissions and reset", async () => {
  let listener;
  let removed;
  let offscreen = false;
  let captures = 0;
  let creations = 0;
  const volumes = {};
  const tabs = new Map([
    [1, { id: 1, url: "https://example.com", mutedInfo: { muted: false } }],
    [2, { id: 2, url: "https://example.org", mutedInfo: { muted: false } }],
    [3, { id: 3, url: "chrome://settings", mutedInfo: { muted: false } }],
    [4, { id: 4, url: "https://example.net", discarded: true }]
  ]);
  const chrome = {
    runtime: {
      id: "extension",
      getURL: path => `chrome-extension://extension/${path}`,
      getContexts: async () => offscreen ? [{}] : [],
      onMessage: { addListener: callback => { listener = callback; } },
      sendMessage: async message => {
        if (message.type === "state") return { volumes: { ...volumes } };
        if (message.type === "stop") delete volumes[message.tabId];
        else volumes[message.tabId] = message.volume;
        return {};
      }
    },
    offscreen: { createDocument: async () => { creations++; offscreen = true; } },
    tabCapture: { getMediaStreamId: async ({ targetTabId }) => {
      if (targetTabId === 2) throw new Error("Permission denied");
      captures++;
      return "stream";
    } },
    tabs: {
      get: async id => { if (!tabs.has(id)) throw new Error("Tab closed"); return tabs.get(id); },
      query: async () => [...tabs.values()],
      update: async (id, { muted }) => { tabs.get(id).mutedInfo = { muted }; },
      onRemoved: { addListener: callback => { removed = callback; } }
    }
  };
  vm.runInNewContext(readFileSync(`${__dirname}/background.js`, "utf8"), { chrome });
  const sender = { id: "extension", url: chrome.runtime.getURL("popup.html") };
  const send = message => new Promise(resolve => listener({ ...message, target: "background" }, sender, resolve));
  assert.equal(listener({ target: "background" }, { id: "other" }, () => {}), undefined);
  assert.equal((await send({ type: "list" })).tabs.length, 4);
  await Promise.all([150, 175, 200].map(volume => send({ type: "volume", tabId: 1, volume })));
  assert.equal(volumes[1], 200);
  assert.equal(captures, 1);
  assert.equal(creations, 1);
  await send({ type: "mute", tabId: 1, muted: true });
  assert.equal(tabs.get(1).mutedInfo.muted, true);
  assert.equal(volumes[1], 200);
  await send({ type: "volume", tabId: 1, volume: 30 });
  assert.equal(tabs.get(1).mutedInfo.muted, false);
  await send({ type: "volume", tabId: 1, volume: 100 });
  assert.equal(volumes[1], undefined);
  assert.match((await send({ type: "volume", tabId: 2, volume: 200 })).error, /click the extension/);
  assert.match((await send({ type: "volume", tabId: 3, volume: 200 })).error, /unavailable/);
  assert.match((await send({ type: "volume", tabId: 4, volume: 200 })).error, /load it/);
  for (const volume of [-1, 201, NaN, "200"]) assert.match((await send({ type: "volume", tabId: 1, volume })).error, /Invalid/);
  await send({ type: "volume", tabId: 1, volume: 0 });
  assert.equal(volumes[1], 0);
  removed(1);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(volumes[1], undefined);
});
