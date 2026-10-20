const DEFAULT_VOLUME = 100;
const rows = new Map();
const pending = new Map();
const list = document.getElementById("tabs");
let currentTabId;
let refreshing;
let refreshAgain = false;

async function sendBackgroundMessage(message) {
  const response = await chrome.runtime.sendMessage({ ...message, target: "background" });
  if (!response || response.error) throw new Error(response?.error || "Could not load tabs. Close and reopen the extension.");
  return response;
}

function siteOf(tab) {
  try {
    const url = new URL(tab.url);
    return url.protocol === "file:" ? "Local file" : url.hostname || "Browser page";
  }
  catch { return "Browser page"; }
}

function paint(row, tab, volume) {
  const muted = tab.mutedInfo?.muted || volume === 0;
  row.dataset.muted = String(muted);
  row.dataset.boost = String(volume > DEFAULT_VOLUME);
  row.dataset.audible = String(Boolean(tab.audible && !muted));
  let status = "";
  if (muted) status = "Muted";
  else if (tab.audible) status = "Playing";
  else if (tab.id === currentTabId) status = "Current";
  row.querySelector(".status").textContent = status;
  const value = row.querySelector(".volume-value");
  value.textContent = `${muted ? 0 : volume}%`;
  value.setAttribute("aria-label", `Reset volume for ${tab.title} to 100%`);
  const slider = row.querySelector(".volume-slider");
  slider.value = muted ? 0 : volume;
  slider.style.setProperty("--fill", `${Number(slider.value) / Number(slider.max) * 100}%`);
  slider.setAttribute("aria-valuetext", `${slider.value}% of the original volume`);
  const mute = row.querySelector(".mute");
  mute.setAttribute("aria-label", `${muted ? "Unmute" : "Mute"} ${tab.title}`);
  mute.title = muted ? "Unmute tab" : "Mute tab";
  mute.setAttribute("aria-pressed", String(muted));
}

function note(row, text, error = false) {
  const element = row.querySelector(".tab-note");
  element.textContent = text;
  element.hidden = !text;
  element.dataset.error = String(error);
  element.setAttribute("role", error ? "alert" : "status");
}

async function changeVolume(id, volume) {
  const state = rows.get(id);
  pending.set(id, volume);
  paint(state.row, { ...state.tab, mutedInfo: { muted: false } }, volume);
  if (state.saving) return;
  state.saving = true;
  try {
    while (pending.has(id)) {
      const next = pending.get(id);
      pending.delete(id);
      try {
        await sendBackgroundMessage({ type: "volume", tabId: id, volume: next });
        state.volume = next;
        if (next > 0) state.tab.mutedInfo = { muted: false };
        note(state.row, "");
      } catch (error) {
        pending.delete(id);
        note(state.row, error.message, true);
      }
    }
  } finally {
    state.saving = false;
    paint(state.row, state.tab, state.volume);
    updateVisibility();
  }
}

function createRow(tab) {
  const row = document.getElementById("tab-template").content.firstElementChild.cloneNode(true);
  row.querySelector(".tab-link").addEventListener("click", async () => {
    try {
      await chrome.tabs.update(tab.id, { active: true });
      await chrome.windows.update(tab.windowId, { focused: true });
      window.close();
    } catch (error) { note(row, error.message, true); }
  });
  row.querySelector(".volume-slider").addEventListener("input", event => void changeVolume(tab.id, Number(event.target.value)));
  row.querySelector(".volume-value").addEventListener("click", () => void changeVolume(tab.id, DEFAULT_VOLUME));
  row.querySelector(".mute").addEventListener("click", async () => {
    const state = rows.get(tab.id);
    if (state.saving) return;
    try {
      if (state.volume === 0) {
        await changeVolume(tab.id, DEFAULT_VOLUME);
        return;
      }
      const muted = !state.tab.mutedInfo?.muted;
      await sendBackgroundMessage({ type: "mute", tabId: tab.id, muted });
      state.tab.mutedInfo = { muted };
      paint(row, state.tab, state.volume);
      note(row, "");
      updateVisibility();
    } catch (error) { note(row, error.message, true); }
  });
  return row;
}

function updateVisibility() {
  let visible = 0;
  let playing = 0;
  for (const { row, volume } of rows.values()) {
    const audible = row.dataset.audible === "true";
    row.hidden = !audible && row.dataset.muted !== "true" && volume === DEFAULT_VOLUME;
    if (!row.hidden) visible++;
    if (audible) playing++;
  }
  document.getElementById("count").textContent = `${visible} ${visible === 1 ? "tab" : "tabs"}`;
  document.getElementById("empty").hidden = visible > 0;
  const indicator = document.getElementById("playing");
  indicator.textContent = playing ? `${playing} playing` : "No audio";
  indicator.dataset.active = String(playing > 0);
}

async function refresh() {
  if (refreshing) { refreshAgain = true; return; }
  refreshing = true;
  try {
    const [{ tabs, volumes }, active] = await Promise.all([sendBackgroundMessage({ type: "list" }), chrome.tabs.query({ active: true, currentWindow: true })]);
    currentTabId = active[0]?.id;
    const ids = new Set(tabs.map(tab => tab.id));
    for (const [id, { row }] of rows) {
      if (!ids.has(id)) {
        row.remove();
        rows.delete(id);
        pending.delete(id);
      }
    }
    for (const tab of tabs) {
      let state = rows.get(tab.id);
      if (!state) {
        state = { row: createRow(tab), tab, volume: DEFAULT_VOLUME, saving: false };
        rows.set(tab.id, state);
        list.append(state.row);
      }
      state.tab = tab;
      const { row } = state;
      const actionTitle = tab.title || "tab";
      const site = siteOf(tab);
      const fallbackIcon = site.charAt(0).toUpperCase();
      row.querySelector(".tab-title").textContent = tab.title || "Untitled";
      row.querySelector(".tab-link").title = `Open ${actionTitle}`;
      row.querySelector(".tab-site").textContent = site;
      row.querySelector(".volume-slider").setAttribute("aria-label", `Volume for ${actionTitle}`);
      const favicon = row.querySelector(".favicon");
      if (favicon.dataset.url !== (tab.favIconUrl || "")) {
        favicon.dataset.url = tab.favIconUrl || "";
        favicon.textContent = fallbackIcon;
        if (/^(https?:|data:image\/)/.test(tab.favIconUrl || "")) {
          const img = document.createElement("img");
          img.alt = "";
          img.referrerPolicy = "no-referrer";
          img.src = tab.favIconUrl;
          img.addEventListener("error", () => { favicon.textContent = fallbackIcon; }, { once: true });
          favicon.replaceChildren(img);
        }
      } else if (!favicon.textContent && !favicon.firstElementChild) {
        favicon.textContent = fallbackIcon;
      }
      const disabled = !/^(https?|file):/.test(tab.url || "") || Boolean(tab.discarded);
      row.dataset.disabled = String(disabled);
      row.querySelectorAll(".volume-slider, .volume-value").forEach(control => { control.disabled = disabled; });
      if (!state.saving) {
        state.volume = volumes[tab.id] ?? DEFAULT_VOLUME;
        paint(row, tab, state.volume);
        if (row.querySelector(".tab-note").dataset.error !== "true") {
          let message = "";
          if (disabled) message = tab.discarded ? "Open this tab to load it." : "Volume unavailable on this page.";
          note(row, message);
        }
      }
    }
    document.getElementById("error").hidden = true;
    updateVisibility();
  } catch (error) {
    const element = document.getElementById("error");
    element.textContent = error.message;
    element.hidden = false;
  } finally {
    refreshing = false;
    list.setAttribute("aria-busy", "false");
    if (refreshAgain) {
      refreshAgain = false;
      void refresh();
    }
  }
}

chrome.tabs.onUpdated.addListener(() => void refresh());
chrome.tabs.onCreated.addListener(() => void refresh());
chrome.tabs.onRemoved.addListener(() => void refresh());
chrome.tabs.onActivated.addListener(() => void refresh());
chrome.tabCapture.onStatusChanged.addListener(() => void refresh());
void refresh();
