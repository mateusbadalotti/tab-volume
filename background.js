const DEFAULT_VOLUME = 100;
const MAX_VOLUME = 200;
let creatingOffscreen;
const volumeQueues = new Map();

async function hasOffscreen() {
  return (await chrome.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"] })).length > 0;
}

async function ensureOffscreen() {
  if (await hasOffscreen()) return;
  creatingOffscreen ??= chrome.offscreen.createDocument({
    url: "offscreen.html",
    reasons: ["USER_MEDIA"],
    justification: "Adjust each tab's volume and play its audio locally."
  }).finally(() => { creatingOffscreen = undefined; });
  await creatingOffscreen;
}

async function sendAudioMessage(message) {
  const response = await chrome.runtime.sendMessage({ ...message, target: "audio" });
  if (!response || response.error) throw new Error(response?.error || "The audio controller did not respond. Try again.");
  return response;
}

async function getVolumes() {
  if (!await hasOffscreen()) return {};
  const { volumes } = await sendAudioMessage({ type: "state" });
  return volumes;
}

function volumeKey(tab) {
  try {
    if (!/^(https?|file):/.test(tab.url || "")) return;
    return `volume:${JSON.stringify([tab.title || "", new URL(tab.url).origin])}`;
  } catch { return; }
}

async function setVolume(tabId, volume, restoring = false) {
  const tab = await chrome.tabs.get(tabId);
  if (!/^(https?|file):/.test(tab.url || "")) throw new Error("Volume control is unavailable on this browser page.");
  if (tab.discarded) throw new Error("Open this tab to load it before adjusting its volume.");
  const volumes = await getVolumes();
  const isCaptured = volumes[tabId] !== undefined;
  if (restoring && isCaptured) return { volume: volumes[tabId] };
  if (restoring) {
    const key = volumeKey(tab);
    const stored = await chrome.storage.local.get(["rememberVolume", key]);
    volume = stored[key];
    if (stored.rememberVolume !== true || !Number.isFinite(volume) || volume < 0 || volume > MAX_VOLUME) return { volume: DEFAULT_VOLUME };
  }
  if (volume !== DEFAULT_VOLUME) await ensureOffscreen();
  if (volume === DEFAULT_VOLUME) {
    if (isCaptured) await sendAudioMessage({ type: "stop", tabId });
  } else if (isCaptured) {
    await sendAudioMessage({ type: "volume", tabId, volume });
  } else {
    let streamId;
    try {
      streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tabId });
    } catch (error) {
      if (/invoked|permission|activeTab/i.test(error.message)) {
        throw new Error("Open this tab, then click the extension to enable volume control.");
      }
      throw new Error("Could not start audio control. Stop other captures of this tab and try again.");
    }
    await sendAudioMessage({ type: "start", tabId, volume, streamId, muted: Boolean(tab.mutedInfo?.muted) });
  }
  if (!restoring && volume > 0 && tab.mutedInfo?.muted) await chrome.tabs.update(tabId, { muted: false });
  if (volume !== DEFAULT_VOLUME) {
    const currentTab = await chrome.tabs.get(tabId);
    await sendAudioMessage({ type: "mute", tabId, muted: Boolean(currentTab.mutedInfo?.muted) });
  }
  if (!restoring && (await chrome.storage.local.get("rememberVolume")).rememberVolume === true) {
    const key = volumeKey(tab);
    if (key) {
      if (volume === DEFAULT_VOLUME) await chrome.storage.local.remove(key);
      else await chrome.storage.local.set({ [key]: volume });
    }
  }
  return { volume };
}

async function queueVolume(tabId, volume, restoring = false) {
  const previous = volumeQueues.get(tabId) || Promise.resolve();
  const queuedRequest = previous.catch(() => {}).then(() => setVolume(tabId, volume, restoring));
  volumeQueues.set(tabId, queuedRequest);
  try {
    return await queuedRequest;
  } finally {
    if (volumeQueues.get(tabId) === queuedRequest) volumeQueues.delete(tabId);
  }
}

async function handlePopupMessage(message) {
  if (message.type === "list") {
    const [tabs, volumes, stored, active] = await Promise.all([
      chrome.tabs.query({}), getVolumes(), chrome.storage.local.get(null),
      chrome.tabs.query({ active: true, currentWindow: true })
    ]);
    const rememberVolume = stored.rememberVolume === true;
    const savedVolumes = {};
    const restoreErrors = {};
    if (rememberVolume) {
      for (const tab of tabs) {
        const saved = stored[volumeKey(tab)];
        if (Number.isFinite(saved) && saved >= 0 && saved <= MAX_VOLUME && saved !== DEFAULT_VOLUME) savedVolumes[tab.id] = saved;
      }
      const tab = active[0];
      if (tab && !tab.discarded && volumes[tab.id] === undefined && savedVolumes[tab.id] !== undefined) {
        try {
          const result = await queueVolume(tab.id, savedVolumes[tab.id], true);
          volumes[tab.id] = result.volume;
        } catch (error) { restoreErrors[tab.id] = error.message; }
      }
    }
    return { tabs, volumes, rememberVolume, savedVolumes, restoreErrors };
  }
  if (message.type === "settings") {
    if (typeof message.rememberVolume !== "boolean") throw new Error("Invalid memory setting.");
    const settings = { rememberVolume: message.rememberVolume };
    if (message.rememberVolume) {
      const [tabs, volumes] = await Promise.all([chrome.tabs.query({}), getVolumes()]);
      for (const tab of tabs) {
        const key = volumeKey(tab);
        if (key && volumes[tab.id] !== undefined) settings[key] = volumes[tab.id];
      }
    }
    await chrome.storage.local.set(settings);
    return { rememberVolume: message.rememberVolume };
  }
  if (!Number.isInteger(message.tabId) || message.tabId < 0) throw new Error("Invalid tab.");
  if (message.type === "mute") {
    if (typeof message.muted !== "boolean") throw new Error("Invalid mute state.");
    await chrome.tabs.update(message.tabId, { muted: message.muted });
    return {};
  }
  if (message.type !== "volume" || !Number.isFinite(message.volume) || message.volume < 0 || message.volume > MAX_VOLUME) {
    throw new Error("Invalid volume.");
  }
  return queueVolume(message.tabId, message.volume);
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id || sender.url !== chrome.runtime.getURL("popup.html") || message?.target !== "background") return;
  handlePopupMessage(message).then(respond, error => respond({ error: error.message }));
  return true;
});

chrome.tabs.onRemoved.addListener(tabId => {
  hasOffscreen().then(exists => exists && sendAudioMessage({ type: "stop", tabId })).catch(() => {});
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (!changeInfo.mutedInfo) return;
  hasOffscreen().then(exists => exists && sendAudioMessage({ type: "mute", tabId, muted: changeInfo.mutedInfo.muted })).catch(() => {});
});
