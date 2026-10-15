const sessions = new Map();
const DEFAULT_VOLUME = 100;
const RAMP_SECONDS = 0.025;

function stopSession(tabId) {
  const session = sessions.get(tabId);
  if (!session) return;
  sessions.delete(tabId);
  session.stream.getTracks().forEach(track => track.stop());
  session.source.disconnect();
  session.gain.disconnect();
  void session.context.close();
}

function updateSessionVolume(session, volume) {
  const now = session.context.currentTime;
  session.gain.gain.cancelScheduledValues(now);
  session.gain.gain.setTargetAtTime(volume / DEFAULT_VOLUME, now, RAMP_SECONDS);
  session.volume = volume;
}

async function handleAudioMessage(message) {
  if (message.type === "state") {
    return { volumes: Object.fromEntries([...sessions].map(([id, session]) => [id, session.volume])) };
  }
  if (message.type === "stop") {
    stopSession(message.tabId);
    return {};
  }
  if (message.type === "volume") {
    const session = sessions.get(message.tabId);
    if (!session) throw new Error("Audio control has stopped. Open the extension on this tab again.");
    updateSessionVolume(session, message.volume);
    await session.context.resume();
    return {};
  }
  if (message.type !== "start") throw new Error("Invalid audio operation.");
  let stream;
  let context;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { mandatory: { chromeMediaSource: "tab", chromeMediaSourceId: message.streamId } },
      video: false
    });
    context = new AudioContext();
    const source = context.createMediaStreamSource(stream);
    const gain = context.createGain();
    gain.gain.value = message.volume / DEFAULT_VOLUME;
    source.connect(gain);
    gain.connect(context.destination);
    await context.resume();
    stopSession(message.tabId);
    sessions.set(message.tabId, { stream, context, source, gain, volume: message.volume });
    stream.getAudioTracks().forEach(track => track.addEventListener("ended", () => stopSession(message.tabId), { once: true }));
    return {};
  } catch {
    stream?.getTracks().forEach(track => track.stop());
    if (context) await context.close();
    throw new Error("Could not control audio. Stop other captures of this tab and try again.");
  }
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id || sender.url !== chrome.runtime.getURL("background.js") || message?.target !== "audio") return;
  handleAudioMessage(message).then(respond, error => respond({ error: error.message }));
  return true;
});
