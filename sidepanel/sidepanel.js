import { extensionStorage } from "../utils/storage.js";
import { getRandomQuote, MOTIVATIONAL_QUOTES } from "../utils/quotes.js";
import { DEFAULT_REMINDERS, DEFAULT_SETTINGS, DEFAULT_SOUND_STATE, SOUND_OPTIONS, normalizeFocusState, normalizeReminders, normalizeSettings, normalizeSoundState } from "../utils/defaults.js";

const state = {
  focus: normalizeFocusState(),
  reminders: [],
  settings: structuredClone(DEFAULT_SETTINGS),
  todayMood: null,
  soundState: structuredClone(DEFAULT_SOUND_STATE)
};

let tickerId = null;

document.addEventListener("DOMContentLoaded", () => {
  void init();
});

async function init() {
  const todayKey = moodKey(new Date());
  const data = await extensionStorage.getMany([
    "focus", "reminders", "settings", "soundState", todayKey
  ]);

  state.focus = normalizeFocusState(data.focus);
  state.reminders = normalizeReminders(data.reminders ?? structuredClone(DEFAULT_REMINDERS));
  state.settings = normalizeSettings(data.settings);
  state.soundState = normalizeSoundState(data.soundState);
  state.todayMood = data[todayKey] ?? null;

  renderFocus();
  renderReminders();
  renderMood();
  renderScreenTime();
  renderWater();
  bindEvents();
  initSoundPanel();

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes.focus) {
      state.focus = normalizeFocusState(changes.focus.newValue);
      renderFocus();
    }
    if (changes.reminders) {
      state.reminders = normalizeReminders(changes.reminders.newValue ?? []);
      renderReminders();
    }
    if (changes.soundState) {
      state.soundState = normalizeSoundState(changes.soundState.newValue);
      syncSoundPanel();
    }
    const tk = moodKey(new Date());
    if (changes[tk]) {
      state.todayMood = changes[tk].newValue ?? null;
      renderMood();
    }
  });
}

function bindEvents() {
  document.getElementById("sp-open-dashboard")?.addEventListener("click", () => {
    void chrome.runtime.sendMessage({ type: "OPEN_DASHBOARD" });
  });

  document.getElementById("sp-quote-refresh")?.addEventListener("click", () => {
    document.getElementById("sp-quote").textContent =
      "\u201C" + getRandomQuote() + "\u201D";
  });

  document.querySelectorAll("#sp-presets .sp-preset").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (state.focus.status === "running" || state.focus.status === "paused") return;
      document.querySelectorAll("#sp-presets .sp-preset").forEach((b) => b.classList.remove("is-active"));
      btn.classList.add("is-active");
      const ms = Number(btn.dataset.minutes) * 60 * 1000;
      chrome.runtime.sendMessage({ type: "FOCUS_UPDATE_OPTIONS", payload: { durationMs: ms } });
    });
  });

  document.getElementById("sp-focus-start")?.addEventListener("click", async () => {
    if (state.focus.status === "paused") {
      await chrome.runtime.sendMessage({ type: "FOCUS_RESUME" });
    } else if (state.focus.status !== "running") {
      await chrome.runtime.sendMessage({ type: "FOCUS_START", payload: {
        durationMs: state.focus.durationMs,
        intention: "Deep work",
        blockedSites: state.focus.blockedSites
      }});
    }
  });

  document.getElementById("sp-focus-pause")?.addEventListener("click", async () => {
    if (state.focus.status === "running") {
      await chrome.runtime.sendMessage({ type: "FOCUS_PAUSE" });
    } else if (state.focus.status === "paused") {
      await chrome.runtime.sendMessage({ type: "FOCUS_RESET", payload: { durationMs: state.focus.durationMs } });
    }
  });

  document.querySelectorAll("#sp-mood-picker .sp-mood").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const mood = btn.dataset.mood;
      const key = moodKey(new Date());
      await extensionStorage.set({ [key]: { mood, timestamp: Date.now() } });
      state.todayMood = { mood };
      renderMood();
    });
  });
}

// Renderers

function renderFocus() {
  const f = state.focus;
  const timeEl = document.getElementById("sp-focus-time");
  const labelEl = document.getElementById("sp-focus-label");
  const statusEl = document.getElementById("sp-focus-status");
  const startBtn = document.getElementById("sp-focus-start");
  const pauseBtn = document.getElementById("sp-focus-pause");

  const remaining = f.status === "running" && f.endTime
    ? Math.max(0, f.endTime - Date.now())
    : f.status === "paused" ? (f.remainingMs ?? f.durationMs)
    : f.durationMs;

  timeEl.textContent = formatClock(remaining);

  const labels = { idle: "Ready to focus", running: "Focusing", paused: "Paused", completed: "Done!" };
  statusEl.textContent = labels[f.status] ?? "Ready to focus";

  labelEl.textContent = f.status === "running" ? f.intention + " in progress"
    : f.status === "paused" ? "Paused"
    : f.status === "completed" ? f.intention
    : f.intention;

  startBtn.textContent = f.status === "paused" ? "Resume" : "Start focus";
  startBtn.disabled = f.status === "running";
  pauseBtn.textContent = f.status === "paused" ? "Reset" : "Pause";
  pauseBtn.disabled = f.status !== "running" && f.status !== "paused";

  // Presets
  document.querySelectorAll("#sp-presets .sp-preset").forEach((btn) => {
    btn.classList.toggle("is-active", Number(btn.dataset.minutes) * 60 * 1000 === f.durationMs);
  });

  syncTicker();
}

function syncTicker() {
  if (tickerId) { clearInterval(tickerId); tickerId = null; }
  if (state.focus.status !== "running") return;
  tickerId = setInterval(() => {
    if (state.focus.status !== "running") return;
    const rem = Math.max(0, (state.focus.endTime ?? Date.now()) - Date.now());
    document.getElementById("sp-focus-time").textContent = formatClock(rem);
  }, 1000);
}

function renderReminders() {
  const list = document.getElementById("sp-reminder-list");
  const count = document.getElementById("sp-reminder-count");
  const enabled = state.reminders.filter((r) => r.enabled);
  count.textContent = enabled.length + " active";

  if (enabled.length === 0) {
    list.innerHTML = '<div style="font-size:11px;color:var(--muted);padding:6px 0;">No active reminders.</div>';
    return;
  }

  list.innerHTML = enabled.slice(0, 4).map((r) => `
    <div class="sp-reminder-item">
      <div>
        <div class="sp-reminder-name">${esc(r.name)}</div>
        <div class="sp-reminder-meta">Every ${r.interval} min</div>
      </div>
    </div>
  `).join("");
}

function renderMood() {
  const pill = document.getElementById("sp-mood-pill");
  document.querySelectorAll("#sp-mood-picker .sp-mood").forEach((btn) => {
    btn.classList.toggle("is-selected", btn.dataset.mood === state.todayMood?.mood);
  });
  pill.textContent = state.todayMood ? "Logged" : "Tap to log";
}

async function renderScreenTime() {
  const key = "screentime_" + isoDate(new Date());
  const entry = await extensionStorage.get(key, { total: 0, sites: {} });
  document.getElementById("sp-screentime").textContent = formatDuration(entry.total);

  let productive = 0;
  for (const info of Object.values(entry.sites ?? {})) {
    if (info.category === "productivity") productive += info.time ?? 0;
  }
  const pct = entry.total > 0 ? Math.round((productive / entry.total) * 100) : 0;
  document.getElementById("sp-productive").textContent =
    entry.total > 60000 ? pct + "% productive" : "Start browsing to track";
}

async function renderWater() {
  try {
    const alarm = await chrome.alarms.get("reminder_water");
    if (alarm) {
      const mins = Math.max(1, Math.round((alarm.scheduledTime - Date.now()) / 60000));
      document.getElementById("sp-water-time").textContent = mins + "m";
      document.getElementById("sp-water-meta").textContent = "Next in " + mins + " min";
    }
  } catch { /* alarm API may not be available */ }
}

// Sound panel

function initSoundPanel() {
  const panel = document.getElementById("sp-sound-panel");
  const btn = document.getElementById("sp-sound-toggle");
  const grid = document.getElementById("sp-sound-grid");
  const volumeSlider = document.getElementById("sp-sound-volume-slider");
  const volumeLabel = document.getElementById("sp-sound-volume-label");

  if (!panel || !btn || !grid) return;

  // Render 8 sound tiles with unique icons
  const SOUND_ICONS = {
    white:     `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M4 12h16"/><path d="M4 8h16"/><path d="M4 16h16"/></svg>`,
    pink:      `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M2 12c2-3 4-5 6-5s4 5 6 5 4-5 6-5"/></svg>`,
    brown:     `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M3 17c2-1 3-5 5-5s3 4 5 4 3-6 5-6 3 3 3 3"/></svg>`,
    dark:      `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M3 12c2.5 0 2.5-4 5-4s2.5 8 5 8 2.5-12 5-12 2.5 6 3 8"/></svg>`,
    rain:      `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M8 19v2"/><path d="M12 17v2"/><path d="M16 19v2"/><path d="M20 9.5A5.5 5.5 0 0 0 9.2 7.2 4 4 0 1 0 4 12h16a3 3 0 0 0 0-6"/></svg>`,
    forest:    `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3L4 14h5l-2 7 10-11h-5l2-7z"/></svg>`,
    cafe:      `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M17 8h1a4 4 0 0 1 0 8h-1"/><path d="M3 8h14v9a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4V8z"/><path d="M6 2v2"/><path d="M10 2v2"/><path d="M14 2v2"/></svg>`,
    ocean:     `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M2 12c2-2 4-2 6 0s4 2 6 0 4-2 6 0"/><path d="M2 17c2-2 4-2 6 0s4 2 6 0 4-2 6 0"/><path d="M2 7c2-2 4-2 6 0s4 2 6 0 4-2 6 0"/></svg>`
  };

  grid.innerHTML = SOUND_OPTIONS.map(s => `
    <button class="sp-sound-tile" type="button" data-sound-id="${s.id}">
      ${SOUND_ICONS[s.id] ?? ''}
      ${s.label}
    </button>
  `).join("");

  // Toggle panel open/close
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    panel.hidden = !panel.hidden;
  });

  // Close panel on outside click
  document.addEventListener("click", (e) => {
    if (!panel.hidden && !panel.contains(e.target) && !btn.contains(e.target)) {
      panel.hidden = true;
    }
  });

  // Sound tile clicks
  grid.addEventListener("click", async (e) => {
    const tile = e.target.closest(".sp-sound-tile");
    if (!tile) return;

    const soundId = tile.dataset.soundId;

    if (state.soundState.playing && state.soundState.type === soundId) {
      // Stop current sound
      await chrome.runtime.sendMessage({ type: "STOP_NOISE", payload: { fadeOutMs: 500 } });
    } else {
      // Play new sound (or switch sound)
      await chrome.runtime.sendMessage({
        type: "PLAY_NOISE",
        payload: {
          noiseType: soundId,
          preset: "deep-focus",
          masterVolume: state.soundState.volume ?? 0.65
        }
      });
    }
  });

  // Volume slider — smooth change, no engine rebuild
  if (volumeSlider) {
    volumeSlider.addEventListener("input", async (e) => {
      const vol = Number(e.target.value) / 100;
      if (volumeLabel) volumeLabel.textContent = `${e.target.value}%`;
      state.soundState.volume = vol;
      if (state.soundState.playing && !state.soundState.paused) {
        await chrome.runtime.sendMessage({
          type: "SET_VOLUME",
          payload: { volume: vol }
        });
      }
    });
  }

  // Initial UI sync
  syncSoundPanel();
}

function syncSoundPanel() {
  const btn = document.getElementById("sp-sound-toggle");
  const nowPlaying = document.getElementById("sp-sound-now-playing");
  const nowPlayingName = document.getElementById("sp-sound-now-playing-name");
  const volumeSlider = document.getElementById("sp-sound-volume-slider");
  const volumeLabel = document.getElementById("sp-sound-volume-label");

  if (!btn) return;

  const { playing, paused, type, volume } = state.soundState;

  // Header icon state
  btn.classList.toggle("is-playing", playing && !paused);
  btn.classList.toggle("is-paused", playing && paused);
  btn.title = playing
    ? (paused ? `${type} paused` : `Playing: ${type}`)
    : "Open sounds";

  // Now playing pill
  if (nowPlaying) {
    nowPlaying.hidden = !playing;
    if (playing && nowPlayingName) {
      const opt = SOUND_OPTIONS.find(s => s.id === type);
      nowPlayingName.textContent = paused
        ? `${opt?.label ?? type} (paused)`
        : (opt?.label ?? type);
    }
  }

  // Grid tiles
  document.querySelectorAll(".sp-sound-tile").forEach(tile => {
    tile.classList.toggle("is-playing", playing && !paused && tile.dataset.soundId === type);
    tile.classList.toggle("is-paused", playing && paused && tile.dataset.soundId === type);
  });

  // Volume
  if (volumeSlider) {
    const pct = Math.round((volume ?? 0.65) * 100);
    volumeSlider.value = pct;
    if (volumeLabel) volumeLabel.textContent = `${pct}%`;
  }
}

// Helpers

function formatClock(ms) {
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0");
}

function formatDuration(ms) {
  if (!ms || ms <= 0) return "0m";
  const min = Math.round(ms / 60000);
  if (min < 1) return "<1m";
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h > 0 ? h + "h " + String(m).padStart(2, "0") + "m" : m + "m";
}

function moodKey(date) {
  return "mood_" + isoDate(date);
}

function isoDate(d) {
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}

function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
