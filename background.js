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

async function setVolume(tabId, volume) {
  const tab = await chrome.tabs.get(tabId);
  if (!/^(https?|file):/.test(tab.url || "")) throw new Error("Volume control is unavailable on this browser page.");
  if (tab.discarded) throw new Error("Open this tab to load it before adjusting its volume.");
  const volumes = await getVolumes();
  const isCaptured = volumes[tabId] !== undefined;
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
    await sendAudioMessage({ type: "start", tabId, volume, streamId });
  }
  if (volume > 0 && tab.mutedInfo?.muted) await chrome.tabs.update(tabId, { muted: false });
  return { volume };
}

async function handlePopupMessage(message) {
  if (message.type === "list") {
    const [tabs, volumes] = await Promise.all([chrome.tabs.query({}), getVolumes()]);
    return { tabs, volumes };
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
  const previous = volumeQueues.get(message.tabId) || Promise.resolve();
  const queuedRequest = previous.catch(() => {}).then(() => setVolume(message.tabId, message.volume));
  volumeQueues.set(message.tabId, queuedRequest);
  try {
    return await queuedRequest;
  } finally {
    if (volumeQueues.get(message.tabId) === queuedRequest) volumeQueues.delete(message.tabId);
  }
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id || sender.url !== chrome.runtime.getURL("popup.html") || message?.target !== "background") return;
  handlePopupMessage(message).then(respond, error => respond({ error: error.message }));
  return true;
});

chrome.tabs.onRemoved.addListener(tabId => {
  hasOffscreen().then(exists => exists && sendAudioMessage({ type: "stop", tabId })).catch(() => {});
});
