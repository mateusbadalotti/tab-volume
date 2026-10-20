const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const vm = require("node:vm");

test("Per-tab volume, queued adjustments, permissions and reset", async () => {
  let listener;
  let removed;
  let updated;
  let offscreen = false;
  let captures = 0;
  let creations = 0;
  const volumes = {};
  const muted = {};
  const tabs = new Map([
    [1, { id: 1, url: "https://example.com", mutedInfo: { muted: false } }],
    [2, { id: 2, url: "https://example.org", mutedInfo: { muted: false } }],
    [3, { id: 3, url: "chrome://settings", mutedInfo: { muted: false } }],
    [4, { id: 4, url: "https://example.net", discarded: true }]
  ]);
  const chrome = {
    storage: { local: { get: async () => ({}) } },
    runtime: {
      id: "extension",
      getURL: path => `chrome-extension://extension/${path}`,
      getContexts: async () => offscreen ? [{}] : [],
      onMessage: { addListener: callback => { listener = callback; } },
      sendMessage: async message => {
        if (message.type === "state") return { volumes: { ...volumes } };
        if (message.type === "stop") delete volumes[message.tabId];
        else if (message.type === "mute") muted[message.tabId] = message.muted;
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
      update: async (id, { muted }) => {
        tabs.get(id).mutedInfo = { muted };
        updated(id, { mutedInfo: { muted } });
      },
      onUpdated: { addListener: callback => { updated = callback; } },
      onRemoved: { addListener: callback => { removed = callback; } }
    }
  };
  vm.runInNewContext(readFileSync(`${__dirname}/background.js`, "utf8"), { chrome, URL });
  const sender = { id: "extension", url: chrome.runtime.getURL("popup.html") };
  const send = message => new Promise(resolve => listener({ ...message, target: "background" }, sender, resolve));
  assert.equal(listener({ target: "background" }, { id: "other" }, () => {}), undefined);
  assert.equal((await send({ type: "list" })).tabs.length, 4);
  await Promise.all([150, 175, 200].map(volume => send({ type: "volume", tabId: 1, volume })));
  assert.equal(volumes[1], 200);
  assert.equal(captures, 1);
  assert.equal(creations, 1);
  await send({ type: "mute", tabId: 1, muted: true });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(tabs.get(1).mutedInfo.muted, true);
  assert.equal(muted[1], true);
  assert.equal(volumes[1], 200);
  tabs.get(1).mutedInfo = { muted: false };
  updated(1, { mutedInfo: { muted: false } });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(muted[1], false);
  assert.equal(volumes[1], 200);
  tabs.get(1).mutedInfo = { muted: true };
  updated(1, { mutedInfo: { muted: true } });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(muted[1], true);
  await send({ type: "volume", tabId: 1, volume: 30 });
  assert.equal(tabs.get(1).mutedInfo.muted, false);
  assert.equal(muted[1], false);
  await send({ type: "volume", tabId: 1, volume: 100 });
  assert.equal(volumes[1], undefined);
  assert.match((await send({ type: "volume", tabId: 2, volume: 200 })).error, /click the extension/);
  assert.match((await send({ type: "volume", tabId: 3, volume: 200 })).error, /unavailable/);
  assert.match((await send({ type: "volume", tabId: 4, volume: 200 })).error, /load it/);
  for (const volume of [-1, 201, NaN, "200"]) assert.match((await send({ type: "volume", tabId: 1, volume })).error, /Invalid/);
  tabs.get(1).mutedInfo = { muted: true };
  await send({ type: "volume", tabId: 1, volume: 0 });
  assert.equal(volumes[1], 0);
  assert.equal(muted[1], true);
  removed(1);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(volumes[1], undefined);
});

test("Opt-in volume memory survives browser restarts and matches exact titles and URL origins", async () => {
  const stored = {};
  let tabs = [{ id: 1, title: "Music", url: "https://example.com/first?track=1#playing", mutedInfo: { muted: false } }];
  let activeId = 1;
  let denied = false;
  let failStorage = false;
  function restart() {
    let listener;
    let offscreen = false;
    const volumes = {};
    const muted = {};
    const chrome = {
      storage: { local: {
        get: async key => key === null ? { ...stored } : Object.fromEntries((Array.isArray(key) ? key : [key]).map(name => [name, stored[name]])),
        set: async values => { if (failStorage) throw new Error("Storage unavailable"); Object.assign(stored, values); },
        remove: async key => { delete stored[key]; }
      } },
      runtime: {
        id: "extension",
        getURL: path => `chrome-extension://extension/${path}`,
        getContexts: async () => offscreen ? [{}] : [],
        onMessage: { addListener: callback => { listener = callback; } },
        sendMessage: async message => {
          if (message.type === "state") return { volumes: { ...volumes } };
          if (message.type === "stop") delete volumes[message.tabId];
          else if (message.type === "mute") muted[message.tabId] = message.muted;
          else volumes[message.tabId] = message.volume;
          return {};
        }
      },
      offscreen: { createDocument: async () => { offscreen = true; } },
      tabCapture: { getMediaStreamId: async () => {
        if (denied) throw new Error("Permission denied");
        return "stream";
      } },
      tabs: {
        get: async id => tabs.find(tab => tab.id === id),
        query: async query => query.active ? tabs.filter(tab => tab.id === activeId) : tabs,
        update: async (id, update) => { tabs.find(tab => tab.id === id).mutedInfo = { muted: update.muted }; },
        onUpdated: { addListener() {} },
        onRemoved: { addListener() {} }
      }
    };
    vm.runInNewContext(readFileSync(`${__dirname}/background.js`, "utf8"), { chrome, URL });
    const sender = { id: "extension", url: chrome.runtime.getURL("popup.html") };
    return {
      volumes, muted,
      send: message => new Promise(resolve => listener({ ...message, target: "background" }, sender, resolve))
    };
  }
  let browser = restart();
  assert.equal((await browser.send({ type: "list" })).rememberVolume, false);
  await browser.send({ type: "volume", tabId: 1, volume: 65 });
  assert.deepEqual(stored, {});
  assert.match((await browser.send({ type: "settings", rememberVolume: "yes" })).error, /Invalid/);
  await browser.send({ type: "settings", rememberVolume: true });
  const key = 'volume:["Music","https://example.com"]';
  assert.equal(stored[key], 65);
  await browser.send({ type: "volume", tabId: 1, volume: 150 });
  assert.equal(stored[key], 150);
  tabs = [{ ...tabs[0], id: 20, url: "https://example.com/second?track=2#paused", mutedInfo: { muted: true } }];
  activeId = 20;
  browser = restart();
  let listed = await browser.send({ type: "list" });
  assert.equal(listed.rememberVolume, true);
  assert.equal(listed.volumes[20], 150);
  assert.equal(browser.muted[20], true);
  assert.equal(tabs[0].mutedInfo.muted, true);
  await browser.send({ type: "volume", tabId: 20, volume: 0 });
  assert.equal(stored[key], 0);
  browser = restart();
  assert.equal((await browser.send({ type: "list" })).volumes[20], 0);
  await browser.send({ type: "volume", tabId: 20, volume: 100 });
  assert.equal(stored[key], undefined);
  assert.equal((await browser.send({ type: "list" })).volumes[20], undefined);
  await browser.send({ type: "volume", tabId: 20, volume: 80 });
  for (const change of [
    { title: "Other music" }, { url: "https://other.example.com/second" },
    { url: "http://example.com/second" }, { url: "https://example.com:8443/second" }
  ]) {
    const original = tabs[0];
    tabs = [{ ...original, ...change }];
    assert.equal((await restart().send({ type: "list" })).volumes[20], undefined);
    tabs = [original];
  }
  activeId = undefined;
  listed = await restart().send({ type: "list" });
  assert.equal(listed.savedVolumes[20], 80);
  assert.equal(listed.volumes[20], undefined);
  activeId = 20;
  denied = true;
  browser = restart();
  listed = await browser.send({ type: "list" });
  assert.match(listed.restoreErrors[20], /click the extension/);
  assert.equal(listed.volumes[20], undefined);
  assert.equal(stored[key], 80);
  assert.match((await browser.send({ type: "volume", tabId: 20, volume: 45 })).error, /click the extension/);
  assert.equal(stored[key], 80);
  denied = false;
  assert.equal((await browser.send({ type: "list" })).volumes[20], 80);
  await browser.send({ type: "settings", rememberVolume: false });
  browser = restart();
  listed = await browser.send({ type: "list" });
  assert.equal(listed.volumes[20], undefined);
  assert.equal(listed.savedVolumes[20], undefined);
  await browser.send({ type: "volume", tabId: 20, volume: 60 });
  assert.equal(stored[key], 80);
  failStorage = true;
  assert.match((await browser.send({ type: "settings", rememberVolume: true })).error, /Storage unavailable/);
  assert.equal(stored.rememberVolume, false);
  failStorage = false;
  await browser.send({ type: "settings", rememberVolume: true });
  browser = restart();
  await Promise.all([
    browser.send({ type: "volume", tabId: 20, volume: 100 }),
    browser.send({ type: "list" })
  ]);
  assert.equal(browser.volumes[20], undefined);
  assert.equal(stored[key], undefined);
  await browser.send({ type: "volume", tabId: 20, volume: 70 });
  browser = restart();
  await Promise.all([
    browser.send({ type: "list" }),
    browser.send({ type: "settings", rememberVolume: false })
  ]);
  assert.equal(browser.volumes[20], undefined);
});
