import {
  DEFAULT_QUICK_NOTES,
  DEFAULT_REMINDERS,
  DEFAULT_SETTINGS,
  DEFAULT_SOUND_STATE,
  DEFAULT_UI,
  DEFAULT_VAULT,
  SOUND_OPTIONS,
  normalizeFocusState,
  normalizeQuickNotes,
  normalizeReminders,
  normalizeSettings,
  normalizeSoundState,
  normalizeVault
} from "../utils/defaults.js";
import { getRandomQuote } from "../utils/quotes.js";
import { extensionStorage } from "../utils/storage.js";
import { categorizeDomain } from "../utils/categories.js";
import { getLocale, setLocale, t, tf } from "../utils/i18n.js";

const PAGE_IDS = [
  "home",
  "focus",
  "mind",
  "reminders",
  "screentime",
  "journal",
  "vault",
  "journey",
  "settings"
];

const MOOD_META = {
  rough: {
    label: "Rough",
    value: 1,
    color: "#E24B4A",
    background: "#FCEBEB"
  },
  okay: {
    label: "Okay",
    value: 2,
    color: "#854F0B",
    background: "#FAEEDA"
  },
  good: {
    label: "Good",
    value: 3,
    color: "#185FA5",
    background: "#E6F1FB"
  },
  great: {
    label: "Great",
    value: 4,
    color: "#0F6E56",
    background: "#E1F5EE"
  }
};

const SETTING_LABELS = {
  quotesEnabled: {
    name: "Quotes in notifications",
    meta: "Append a motivational line to reminder notifications."
  },
  moodPromptEnabled: {
    name: "Mood prompts",
    meta: "Keep mood check-ins visible on the dashboard."
  },
  fadeOutEnabled: {
    name: "Fade sound after focus session",
    meta: "Gradually stop ambient sound when timer ends."
  },
};

const SCREENTIME_KEY_PREFIX = "screentime_";

const CATEGORY_COLORS = {
  productivity: { pill: "pill--teal-solid", bar: "site-item__bar-fill--productivity", label: "Productive" },
  social: { pill: "pill--coral", bar: "site-item__bar-fill--social", label: "Social" },
  other: { pill: "pill--muted", bar: "site-item__bar-fill--other", label: "Other" }
};

const state = {
  reminders: [],
  quickNotes: structuredClone(DEFAULT_QUICK_NOTES),
  settings: structuredClone(DEFAULT_SETTINGS),
  journal: [],
  vault: structuredClone(DEFAULT_VAULT),
  todayMood: null,
  focus: normalizeFocusState(),
  focusHistory: [],
  screentimePeriod: "today",
  soundState: structuredClone(DEFAULT_SOUND_STATE),
  captureTab: "quick-note",
  journalDraft: "",
  reminderAttention: {
    pendingCount: 0,
    lastReminderName: null
  }
};

let focusTickerId = null;
const THEME_CYCLE = ["light", "dark", "system"];
const LANGUAGE_CYCLE = ["auto", "en", "vi"];

document.addEventListener("DOMContentLoaded", () => {
  void initializePopup();
});

async function initializePopup() {
  applySurfaceMode();
  bindNavigation();
  bindReminderForm();
  bindJournalForm();
  bindExportButton();
  bindFocusControls();
  bindDashboardFocusControls();
  bindSidePanelButton();
  bindDashboardButton();
  bindHomePreferenceButtons();

  const todayKey = buildMoodStorageKey(new Date());
  const initial = await extensionStorage.getMany([
    "reminders",
    "quickNotes",
    "settings",
    "journal",
    "vault",
    "ui",
    "focus",
    "focusHistory",
    "soundState",
    "reminderAttention",
    todayKey
  ]);

  state.reminders = normalizeReminders(initial.reminders);
  state.quickNotes = normalizeQuickNotes(initial.quickNotes);
  state.settings = normalizeSettings(initial.settings);
  // Migrate old darkMode boolean to new theme string
  if (state.settings.darkMode !== undefined && state.settings.theme === undefined) {
    state.settings.theme = state.settings.darkMode ? "dark" : "light";
    delete state.settings.darkMode;
    await extensionStorage.set({ settings: state.settings });
  }
  state.journal = initial.journal ?? [];
  state.vault = normalizeVault(initial.vault);
  state.todayMood = initial[todayKey] ?? null;
  state.focus = normalizeFocusState(initial.focus);
  state.focusHistory = Array.isArray(initial.focusHistory) ? initial.focusHistory : [];
  state.soundState = normalizeSoundState(initial.soundState);
  state.reminderAttention = normalizeReminderAttention(initial.reminderAttention);

  if (JSON.stringify(state.reminders) !== JSON.stringify(initial.reminders)) {
    await extensionStorage.set({ reminders: state.reminders });
    await chrome.runtime.sendMessage({ type: "SYNC_REMINDERS" });
  }

  if (JSON.stringify(state.quickNotes) !== JSON.stringify(initial.quickNotes)) {
    await extensionStorage.set({ quickNotes: state.quickNotes });
  }

  if (JSON.stringify(state.settings) !== JSON.stringify(initial.settings)) {
    await extensionStorage.set({ settings: state.settings });
  }

  if (JSON.stringify(state.vault) !== JSON.stringify(initial.vault)) {
    await extensionStorage.set({ vault: state.vault });
  }

  if (JSON.stringify(state.soundState) !== JSON.stringify(initial.soundState)) {
    await extensionStorage.set({ soundState: state.soundState });
  }

  applyTheme();
  applyLocale();
  renderFeaturedQuote();
  routeTo(initial.ui?.lastPage ?? DEFAULT_UI.lastPage);
  initCaptureWorkspace();
  renderReminders();
  renderDashboardReminders();
  renderReminderAttention();
  void acknowledgeReminderAttention();
  renderQuickNotes();
  renderMoodSelection();
  await renderMindPage();
  renderJournalEntries();
  renderVaultEntries();
  renderSettings();
  renderFocusState();
  renderDashboardFocus();
  renderFocusHistory();
  renderBlockedSites();
  await renderScreenTimePage();
  initSoundPanel();

  chrome.storage.onChanged.addListener(handleStorageChanged);

  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    if ((state.settings.theme ?? "system") === "system") {
      applyTheme();
    }
  });
}

function bindNavigation() {
  document.querySelectorAll("[data-page]").forEach((button) => {
    button.addEventListener("click", () => {
      routeTo(button.dataset.page);
    });
  });

  document.querySelectorAll("[data-route]").forEach((button) => {
    button.addEventListener("click", () => {
      routeTo(button.dataset.route);
    });
  });

  document.querySelectorAll("[data-action]").forEach((button) => {
    button.addEventListener("click", () => {
      void handleQuickAction(button.dataset.action);
    });
  });

  document.querySelectorAll("[data-period]").forEach((button) => {
    button.addEventListener("click", () => {
      state.screentimePeriod = button.dataset.period;
      document.querySelectorAll("[data-period]").forEach((btn) => {
        btn.classList.toggle("is-selected", btn.dataset.period === state.screentimePeriod);
      });
      void renderScreenTimePage();
    });
  });

  document.querySelectorAll("#mood-picker .mood-option").forEach((button) => {
    button.addEventListener("click", () => {
      void saveMood(button.dataset.mood);
    });
  });
}

function initCaptureWorkspace() {
  const form = document.getElementById("quick-note-form");
  const input = document.getElementById("quick-note-input");

  document.querySelectorAll("[data-capture-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      state.captureTab = button.dataset.captureTab;
      renderCaptureWorkspace();
    });
  });

  form?.addEventListener("submit", async (event) => {
    event.preventDefault();

    const text = input?.value.trim() ?? "";
    if (!text) {
      return;
    }

    const now = Date.now();
    state.quickNotes = [
      {
        id: `n_${now}`,
        createdAt: now,
        updatedAt: now,
        text,
        archived: false,
        pinned: false
      },
      ...state.quickNotes
    ].slice(0, 30);

    await extensionStorage.set({ quickNotes: state.quickNotes });
    input.value = "";
    renderQuickNotes();
    updateQuickNoteStatus(t("savedToInbox"));
  });
}

function bindReminderForm() {
  const form = document.getElementById("custom-reminder-form");
  if (!form) {
    return;
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    const formData = new FormData(form);
    const reminder = {
      id: `custom_${Date.now()}`,
      name: String(formData.get("name")).trim(),
      interval: Number(formData.get("interval")),
      enabled: true,
      type: "custom",
      icon: String(formData.get("icon"))
    };

    if (!reminder.name || Number.isNaN(reminder.interval)) {
      return;
    }

    state.reminders = [reminder, ...state.reminders];
    await persistReminders(t("customReminderCreated"));
    form.reset();
  });
}

function bindJournalForm() {
  const form = document.getElementById("journal-form");
  if (!form) {
    return;
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    const formData = new FormData(form);
    const text = String(formData.get("text")).trim();

    if (!text) {
      return;
    }

    const entry = {
      id: `j_${Date.now()}`,
      date: formatIsoDate(new Date()),
      text,
      mood: state.todayMood?.mood ?? null
    };

    state.journal = [entry, ...state.journal].slice(0, 12);
    await extensionStorage.set({ journal: state.journal });
    renderJournalEntries();
    renderCaptureWorkspace();
    state.journalDraft = "";
    updateJournalStatus(t("entrySaved"));
    form.reset();
  });
}

function bindExportButton() {
  const button = document.getElementById("export-data-button");
  if (!button) {
    return;
  }

  button.addEventListener("click", async () => {
      const payload = await extensionStorage.getAll();
      const blob = new Blob([JSON.stringify(payload, null, 2)], {
        type: "application/json"
      });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `remindmethat-export-${formatIsoDate(new Date())}.json`; // keep lowercase in filenames
      anchor.click();
      URL.revokeObjectURL(url);
    });
}

function bindSidePanelButton() {
  const button = document.getElementById("btn-pin-side");
  if (!button) return;

  button.addEventListener("click", async () => {
    try {
      button.disabled = true;
      button.title = t("openingSidePanel");
      await chrome.runtime.sendMessage({ type: "OPEN_SIDE_PANEL" });
      window.close();
    } catch (_error) {
      button.disabled = false;
      button.title = t("couldNotOpenSidePanel");
      button.setAttribute("aria-label", t("couldNotOpenSidePanel"));
      window.setTimeout(() => {
        button.title = t("openCompactSidePanel");
        button.setAttribute("aria-label", t("openCompactSidePanel"));
      }, 2500);
    }
  });
}

function bindDashboardButton() {
  const button = document.getElementById("btn-open-dashboard");
  if (!button) return;

  button.addEventListener("click", async () => {
    try {
      await chrome.runtime.sendMessage({ type: "OPEN_DASHBOARD" });
      if (document.body.dataset.surface === "popup") {
        window.close();
      }
    } catch (_error) {
      button.title = t("couldNotOpenWideDashboard");
      window.setTimeout(() => {
        button.title = t("openWideDashboard");
      }, 2500);
    }
  });
}

function bindHomePreferenceButtons() {
  const themeButton = document.getElementById("home-theme-toggle");
  const languageButton = document.getElementById("home-language-toggle");

  themeButton?.addEventListener("click", async () => {
    const current = state.settings.theme ?? "system";
    const next = THEME_CYCLE[(THEME_CYCLE.indexOf(current) + 1) % THEME_CYCLE.length];
    state.settings = { ...state.settings, theme: next };
    await extensionStorage.set({ settings: state.settings });
    applyTheme();
    applyLocale();
    renderSettings();
  });

  languageButton?.addEventListener("click", async () => {
    const current = state.settings.language ?? "auto";
    const next = LANGUAGE_CYCLE[(LANGUAGE_CYCLE.indexOf(current) + 1) % LANGUAGE_CYCLE.length];
    state.settings = { ...state.settings, language: next };
    await extensionStorage.set({ settings: state.settings });
    applyLocale();
    renderSettings();
  });
}

function initSoundPanel() {
  const panel = document.getElementById("sound-panel");
  const btn = document.getElementById("nav-sound-toggle");
  const grid = document.getElementById("sound-grid");
  const volumeSlider = document.getElementById("sound-volume-slider");
  const volumeLabel = document.getElementById("sound-volume-label");

  if (!panel || !btn || !grid) return;

  // Render 8 sound tiles with unique icons
  const SOUND_ICONS = {
    white:     `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M4 12h16"/><path d="M4 8h16"/><path d="M4 16h16"/></svg>`,
    pink:      `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M2 12c2-3 4-5 6-5s4 5 6 5 4-5 6-5"/></svg>`,
    brown:     `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M3 17c2-1 3-5 5-5s3 4 5 4 3-6 5-6 3 3 3 3"/></svg>`,
    dark:      `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M3 12c2.5 0 2.5-4 5-4s2.5 8 5 8 2.5-12 5-12 2.5 6 3 8"/></svg>`,
    rain:      `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M8 19v2"/><path d="M12 17v2"/><path d="M16 19v2"/><path d="M20 9.5A5.5 5.5 0 0 0 9.2 7.2 4 4 0 1 0 4 12h16a3 3 0 0 0 0-6"/></svg>`,
    forest:    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3L4 14h5l-2 7 10-11h-5l2-7z"/></svg>`,
    cafe:      `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M17 8h1a4 4 0 0 1 0 8h-1"/><path d="M3 8h14v9a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4V8z"/><path d="M6 2v2"/><path d="M10 2v2"/><path d="M14 2v2"/></svg>`,
    ocean:     `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M2 12c2-2 4-2 6 0s4 2 6 0 4-2 6 0"/><path d="M2 17c2-2 4-2 6 0s4 2 6 0 4-2 6 0"/><path d="M2 7c2-2 4-2 6 0s4 2 6 0 4-2 6 0"/></svg>`
  };

  grid.innerHTML = SOUND_OPTIONS.map(s => `
    <button class="sound-tile" type="button" data-sound-id="${s.id}">
      <span class="sound-tile__icon">${SOUND_ICONS[s.id] ?? ''}</span>
      <span class="sound-tile__label">${getSoundLabel(s.id)}</span>
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
    const tile = e.target.closest(".sound-tile");
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

  // Volume slider: smooth change, no engine rebuild
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

  // Play/pause button
  const playBtn = document.getElementById("sound-play-btn");
  if (playBtn) {
    playBtn.addEventListener("click", async () => {
      const { playing, paused, type, volume } = state.soundState;
      if (playing && !paused) {
        // Pause
        await chrome.runtime.sendMessage({ type: "PAUSE_NOISE" });
      } else if (playing && paused) {
        // Resume
        await chrome.runtime.sendMessage({ type: "RESUME_NOISE" });
      } else if (type) {
        // Replay last sound
        await chrome.runtime.sendMessage({
          type: "PLAY_NOISE",
          payload: { noiseType: type, preset: "deep-focus", masterVolume: volume ?? 0.65 }
        });
      }
    });
  }

  // Stop button
  const stopBtn = document.getElementById("sound-stop-btn");
  if (stopBtn) {
    stopBtn.addEventListener("click", async () => {
      await chrome.runtime.sendMessage({ type: "STOP_NOISE", payload: { fadeOutMs: 500 } });
    });
  }

  // Initial UI sync
  syncSoundPanel();
}

function syncSoundPanel() {
  const btn = document.getElementById("nav-sound-toggle");
  const nowPlaying = document.getElementById("sound-now-playing");
  const nowPlayingName = document.getElementById("sound-now-playing-name");
  const volumeSlider = document.getElementById("sound-volume-slider");
  const volumeLabel = document.getElementById("sound-volume-label");

  if (!btn) return;

  const { playing, paused, type, volume } = state.soundState;

  // Sidebar icon state
  btn.classList.toggle("is-playing", playing && !paused);
  btn.classList.toggle("is-paused", playing && paused);
  btn.title = playing
    ? (paused ? `${getSoundLabel(type)} paused` : `${getSoundLabel(type)} ${t("isPlaying")}`)
    : t("openSounds");
  btn.setAttribute("aria-label", btn.title);

  // Now playing pill
  if (nowPlaying) {
    nowPlaying.hidden = !playing;
    if (playing && nowPlayingName) {
      nowPlayingName.textContent = paused
        ? `${getSoundLabel(type)} (paused)`
        : getSoundLabel(type);
    }
  }

  // Grid tiles
  document.querySelectorAll(".sound-tile").forEach(tile => {
    tile.classList.toggle("is-playing", playing && !paused && tile.dataset.soundId === type);
    tile.classList.toggle("is-paused", playing && paused && tile.dataset.soundId === type);
  });

  // Volume
  if (volumeSlider) {
    const pct = Math.round((volume ?? 0.65) * 100);
    volumeSlider.value = pct;
    if (volumeLabel) volumeLabel.textContent = `${pct}%`;
  }

  // Play/stop controls bar
  const controls = document.getElementById("sound-controls");
  const playBtn = document.getElementById("sound-play-btn");
  const controlsLabel = document.getElementById("sound-controls-label");

  if (controls) {
    // Show controls when a sound has been selected (playing or has a type)
    controls.hidden = !playing && !type;

    if (playBtn) {
      const iconPlay = playBtn.querySelector(".sound-icon-play");
      const iconPause = playBtn.querySelector(".sound-icon-pause");
      playBtn.classList.toggle("is-paused", playing && paused);

      if (playing && !paused) {
        // Show pause icon
        if (iconPlay) iconPlay.style.display = "none";
        if (iconPause) iconPause.style.display = "";
      } else {
        // Show play icon
        if (iconPlay) iconPlay.style.display = "";
        if (iconPause) iconPause.style.display = "none";
      }
    }

    if (controlsLabel) {
      if (playing && paused) {
        controlsLabel.textContent = `${getSoundLabel(type)} paused`;
      } else if (playing) {
        controlsLabel.textContent = `${getSoundLabel(type)}`;
      } else {
        controlsLabel.textContent = "Not playing";
      }
    }
  }
}

// Dashboard Focus Widget

function bindDashboardFocusControls() {
  const startBtn = document.getElementById("home-focus-start");
  const moreBtn = document.getElementById("home-focus-more");

  if (!startBtn) return;

  // Duration presets
  document.querySelectorAll("[data-home-duration]").forEach((btn) =>
    btn.addEventListener("click", async () => {
      if (state.focus.status === "running" || state.focus.status === "paused") return;
      const durationMs = Number(btn.dataset.homeDuration) * 60 * 1000;
      await sendFocusMessage("FOCUS_UPDATE_OPTIONS", { durationMs });
    })
  );

  // Start / Pause / Resume toggle
  startBtn.addEventListener("click", async () => {
    if (state.focus.status === "paused") {
      await sendFocusMessage("FOCUS_RESUME");
    } else if (state.focus.status === "running") {
      await sendFocusMessage("FOCUS_PAUSE");
    } else {
      await sendFocusMessage("FOCUS_START", {
        durationMs: state.focus.durationMs,
        intention: state.focus.intention,
        blockedSites: state.focus.blockedSites
      });
    }
  });

  // "..." more: navigate to full focus page
  moreBtn?.addEventListener("click", () => routeTo("focus"));
}

let dashFocusTickerId = null;

function renderDashboardFocus() {
  const card = document.getElementById("home-focus-card");
  const timeEl = document.getElementById("home-focus-time");
  const sublabel = document.getElementById("home-focus-sublabel");
  const statusPill = document.getElementById("home-focus-status-pill");
  const startBtn = document.getElementById("home-focus-start");

  if (!card || !timeEl) return;

  const focus = state.focus;
  const remainingMs = getRemainingFocusMs(focus);

  card.dataset.focusStatus = focus.status;

  // Time display
  if (focus.status === "completed") {
    timeEl.textContent = t("done") ?? "Done!";
  } else {
    timeEl.textContent = formatClock(
      focus.status === "idle" ? focus.durationMs : remainingMs
    );
  }

  // Sublabel
  if (focus.status === "running") {
    sublabel.textContent = focus.intention;
  } else if (focus.status === "paused") {
    sublabel.textContent = t("paused") ?? "Paused";
  } else if (focus.status === "completed") {
    sublabel.textContent = focus.intention;
  } else {
    sublabel.textContent = focus.intention;
  }

  // Status pill
  if (statusPill) {
    const labels = {
      idle: t("readyToFocus") ?? "Ready to focus",
      running: `${formatMinutesLabel(remainingMs)} ${t("left") ?? "left"}`,
      paused: t("paused") ?? "Paused",
      completed: t("completed") ?? "Done!"
    };
    statusPill.textContent = labels[focus.status] ?? labels.idle;
  }

  // Button text
  if (startBtn) {
    if (focus.status === "running") {
      startBtn.textContent = t("pause") ?? "Pause";
    } else if (focus.status === "paused") {
      startBtn.textContent = t("resume") ?? "Resume";
    } else {
      startBtn.textContent = t("startFocus") ?? "Start focus";
    }
  }

  // Preset highlighting
  document.querySelectorAll("[data-home-duration]").forEach((btn) => {
    btn.classList.toggle(
      "is-selected",
      Number(btn.dataset.homeDuration) * 60 * 1000 === focus.durationMs
    );
  });

  syncDashboardFocusTicker();
}

function syncDashboardFocusTicker() {
  if (dashFocusTickerId) {
    window.clearInterval(dashFocusTickerId);
    dashFocusTickerId = null;
  }
  if (state.focus.status !== "running") return;

  dashFocusTickerId = window.setInterval(() => {
    if (state.focus.status !== "running") {
      window.clearInterval(dashFocusTickerId);
      dashFocusTickerId = null;
      return;
    }
    const remaining = getRemainingFocusMs(state.focus);
    const timeEl = document.getElementById("home-focus-time");
    const statusPill = document.getElementById("home-focus-status-pill");
    if (timeEl) timeEl.textContent = formatClock(remaining);
    if (statusPill) statusPill.textContent = `${formatMinutesLabel(remaining)} ${t("left") ?? "left"}`;
  }, 1000);
}

// Focus Page Controls

function bindFocusControls() {
  const intentionInput = document.getElementById("focus-intention-input");
  const startButton = document.getElementById("focus-start-button");
  const pauseButton = document.getElementById("focus-pause-button");
  const resetButton = document.getElementById("focus-reset-button");
  const blockedSiteForm = document.getElementById("blocked-site-form");
  const durationButtons = document.querySelectorAll("[data-duration-minutes]");

  if (!intentionInput || !startButton || !pauseButton || !resetButton || !blockedSiteForm) {
    return;
  }

  durationButtons.forEach((button) =>
    button.addEventListener("click", async () => {
      if (state.focus.status === "running" || state.focus.status === "paused") {
        return;
      }

      const durationMs = Number(button.dataset.durationMinutes) * 60 * 1000;
      await sendFocusMessage("FOCUS_UPDATE_OPTIONS", { durationMs });
    })
  );

  intentionInput.addEventListener("blur", () => {
    void commitFocusIntention();
  });
  intentionInput.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") {
      return;
    }

    event.preventDefault();
    intentionInput.blur();
  });

  startButton.addEventListener("click", async () => {
      await commitFocusIntention();

      if (state.focus.status === "paused") {
        await sendFocusMessage("FOCUS_RESUME");
        return;
      }

      if (state.focus.status === "running") {
        return;
      }

      await sendFocusMessage("FOCUS_START", {
        durationMs: state.focus.durationMs,
        intention: intentionInput.value,
        blockedSites: state.focus.blockedSites
      });
    });

  pauseButton.addEventListener("click", async () => {
      if (state.focus.status !== "running") {
        return;
      }

      await sendFocusMessage("FOCUS_PAUSE");
    });

  resetButton.addEventListener("click", async () => {
      await sendFocusMessage("FOCUS_RESET", {
        durationMs: state.focus.durationMs
      });
    });

  blockedSiteForm.addEventListener("submit", async (event) => {
      event.preventDefault();

      const input = document.getElementById("blocked-site-input");
      if (!input) {
        return;
      }
      const hostname = normalizeBlockedSiteInput(input.value);

      if (!hostname || state.focus.blockedSites.includes(hostname)) {
        return;
      }

      await sendFocusMessage("FOCUS_UPDATE_OPTIONS", {
        blockedSites: [...state.focus.blockedSites, hostname]
      });
      input.value = "";
    });
}

async function handleStorageChanged(changes, areaName) {
  if (areaName !== "local") {
    return;
  }

  if (changes.reminders) {
    state.reminders = normalizeReminders(changes.reminders.newValue);
    renderReminders();
    renderDashboardReminders();
  }

  if (changes.quickNotes) {
    state.quickNotes = normalizeQuickNotes(changes.quickNotes.newValue);
    renderQuickNotes();
  }

  if (changes.settings) {
    state.settings = normalizeSettings(changes.settings.newValue);
    applyTheme();
    applyLocale();
    renderSettings();
  }

  if (changes.journal) {
    state.journal = changes.journal.newValue ?? [];
    renderJournalEntries();
    renderCaptureWorkspace();
  }

  if (changes.vault) {
    state.vault = normalizeVault(changes.vault.newValue);
    renderVaultEntries();
    renderQuickNotes();
  }

  if (changes.focus) {
    state.focus = normalizeFocusState(changes.focus.newValue);
    renderFocusState();
    renderDashboardFocus();
    renderBlockedSites();
  }

  if (changes.focusHistory) {
    state.focusHistory = Array.isArray(changes.focusHistory.newValue)
      ? changes.focusHistory.newValue
      : [];
    renderFocusHistory();
  }

  if (changes.soundState) {
    state.soundState = normalizeSoundState(changes.soundState.newValue);
    syncSoundPanel();
    renderFocusSoundStatus();
  }

  if (changes.reminderAttention) {
    state.reminderAttention = normalizeReminderAttention(changes.reminderAttention.newValue);
    renderReminderAttention();
    renderReminders();
  }

  const todayScreenTimeKey = SCREENTIME_KEY_PREFIX + formatIsoDate(new Date());
  if (changes[todayScreenTimeKey]) {
    void renderScreenTimePage();
  }

  const todayKey = buildMoodStorageKey(new Date());
  if (changes[todayKey]) {
    state.todayMood = changes[todayKey].newValue ?? null;
    renderMoodSelection();
    await renderMindPage();
    renderJournalEntries();
  }
}

function routeTo(pageId) {
  const nextPage = PAGE_IDS.includes(pageId) ? pageId : "home";

  document.querySelectorAll("[data-page]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.page === nextPage);
  });

  document.querySelectorAll("[data-page-panel]").forEach((panel) => {
    panel.classList.toggle("is-active", panel.dataset.pagePanel === nextPage);
  });

  void extensionStorage.set({
    ui: {
      lastPage: nextPage
    }
  });

  if (nextPage === "reminders" || nextPage === "home") {
    void acknowledgeReminderAttention();
  }

  if (nextPage === "journal") {
    window.setTimeout(() => {
      fillJournalDraft();
    }, 0);
  }
}

async function acknowledgeReminderAttention() {
  if (state.reminderAttention.pendingCount <= 0) {
    return;
  }

  state.reminderAttention = normalizeReminderAttention();
  renderReminderAttention();
  await chrome.runtime.sendMessage({ type: "CLEAR_REMINDER_ATTENTION" });
}

async function handleQuickAction(action) {
  if (action === "quick-note") {
    state.captureTab = "quick-note";
    renderCaptureWorkspace();
    updateQuickNoteStatus(t("quickNoteReady"));
    focusSoon("#quick-note-input");
    return;
  }

  if (action === "vault") {
    routeTo("vault");
    focusSoon("#vault-list");
    return;
  }

  if (action === "tasks") {
    routeTo("reminders");
    focusSoon("#reminder-list");
    return;
  }

  if (action === "new-reminder") {
    routeTo("reminders");
    focusSoon('#custom-reminder-form input[name="name"]');
  }
}

function updateQuickNoteStatus(message) {
  const statusNode = document.getElementById("capture-status-chip");
  if (statusNode) {
    statusNode.textContent = message;
  }
}

function focusSoon(selector) {
  window.setTimeout(() => {
    const node = document.querySelector(selector);
    if (!node) {
      return;
    }

    node.focus?.();
    node.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
  }, 40);
}

async function pinQuickNote(noteId) {
  const note = state.quickNotes.find((item) => item.id === noteId);
  if (!note) {
    return;
  }

  if (!state.vault.some((entry) => entry.sourceType === "quickNote" && entry.sourceId === note.id)) {
    state.vault = [
      {
        id: `v_${Date.now()}`,
        sourceType: "quickNote",
        sourceId: note.id,
        createdAt: Date.now(),
        text: note.text,
        tag: null
      },
      ...state.vault
    ].slice(0, 30);
  }

  state.quickNotes = state.quickNotes.map((item) =>
    item.id === noteId
      ? { ...item, pinned: true, updatedAt: Date.now() }
      : item
  );

  await extensionStorage.set({
    quickNotes: state.quickNotes,
    vault: state.vault
  });
  updateQuickNoteStatus(t("savedToVault"));
  renderQuickNotes();
  renderVaultEntries();
}

async function pinJournalEntry(entry) {
  if (state.vault.some((item) => item.sourceType === "journal" && item.sourceId === entry.id)) {
    routeTo("vault");
    return;
  }

  state.vault = [
    {
      id: `v_${Date.now()}`,
      sourceType: "journal",
      sourceId: entry.id,
      createdAt: Date.now(),
      text: entry.text,
      tag: null
    },
    ...state.vault
  ].slice(0, 30);

  await extensionStorage.set({ vault: state.vault });
  renderVaultEntries();
  updateJournalStatus(t("savedToVault"));
}

function promoteQuickNoteToJournal(noteId) {
  const note = state.quickNotes.find((item) => item.id === noteId);
  if (!note) {
    return;
  }

  state.journalDraft = note.text;
  routeTo("journal");
  fillJournalDraft();
  updateJournalStatus(t("promotedToJournal"));
}

async function deleteQuickNote(noteId) {
  state.quickNotes = state.quickNotes.filter((item) => item.id !== noteId);
  await extensionStorage.set({ quickNotes: state.quickNotes });
  renderQuickNotes();
}

async function unpinVaultEntry(vaultId) {
  const entry = state.vault.find((item) => item.id === vaultId);
  if (!entry) {
    return;
  }

  state.vault = state.vault.filter((item) => item.id !== vaultId);

  if (entry.sourceType === "quickNote") {
    state.quickNotes = state.quickNotes.map((item) =>
      item.id === entry.sourceId
        ? { ...item, pinned: false }
        : item
    );
    await extensionStorage.set({
      vault: state.vault,
      quickNotes: state.quickNotes
    });
    renderQuickNotes();
  } else {
    await extensionStorage.set({ vault: state.vault });
  }

  renderVaultEntries();
}

function fillJournalDraft() {
  const input = document.getElementById("journal-text");
  if (!input || !state.journalDraft) {
    return;
  }

  input.value = state.journalDraft;
  focusSoon("#journal-text");
}

async function saveMood(moodId) {
  const mood = MOOD_META[moodId];

  if (!mood) {
    return;
  }

  const payload = {
    mood: moodId,
    timestamp: Date.now()
  };

  state.todayMood = payload;
  await extensionStorage.set({
    [buildMoodStorageKey(new Date())]: payload
  });

  renderMoodSelection();
  await renderMindPage();
  updateJournalStatus(tf("moodTaggedAs", { mood: getMoodLabel(moodId).toLowerCase() }));
}

function renderFeaturedQuote() {
  const quoteNode = document.getElementById("featured-quote");
  if (!quoteNode) {
    return;
  }

  quoteNode.textContent = `"${getRandomQuote()}"`;
}

function renderDashboardReminders() {
  const container = document.getElementById("dashboard-reminders");
  if (!container) {
    return;
  }

  const enabled = state.reminders.filter((reminder) => reminder.enabled);

  if (enabled.length === 0) {
    container.innerHTML =
      `<div class="empty-state">${t("noActiveRemindersYet")}</div>`;
    return;
  }

  container.innerHTML = enabled
    .sort((left, right) => left.interval - right.interval)
    .slice(0, 3)
    .map(
      (reminder, index, list) => {
        const priority = getReminderPriority(reminder.interval);
        const trailing = index < list.length - 1 ? '<span class="timeline-rail"></span>' : "";
        return `
        <div class="timeline-item timeline-item--stacked">
          <div class="timeline-marker timeline-marker--${priority.tone}">
            <span class="timeline-dot"></span>
            ${trailing}
          </div>
          <div class="timeline-copy">
            <span class="timeline-time">${formatEveryInterval(reminder.interval)}</span>
            <span class="timeline-title">${escapeHtml(reminder.name)}</span>
            <span class="timeline-meta">${escapeHtml(formatReminderSubtitle(reminder))}</span>
          </div>
          <span class="timeline-priority timeline-priority--${priority.tone}">${priority.label}</span>
        </div>
      `;
      }
    )
    .join("");
}

function renderReminders() {
  const container = document.getElementById("reminder-list");
  if (!container) {
    return;
  }

  if (state.reminders.length === 0) {
    container.innerHTML =
      `<div class="empty-state">${t("noRemindersYet")}</div>`;
    return;
  }

  container.innerHTML = state.reminders
    .sort((left, right) => left.interval - right.interval)
    .map(
      (reminder) => `
        <div class="reminder-item" data-reminder-id="${reminder.id}">
          <div class="reminder-copy">
            <span class="reminder-name">${escapeHtml(reminder.name)}</span>
            <span class="reminder-meta">${formatEveryInterval(reminder.interval)} | ${escapeHtml(formatReminderSubtitle(reminder))}</span>
            ${state.reminderAttention.pendingCount > 0 && state.reminderAttention.lastReminderName === reminder.name
              ? `<span class="reminder-attention-badge">${t("needsAttention")}</span>`
              : ""}
          </div>
          <button class="setting-toggle ${reminder.enabled ? "is-on" : ""}" aria-label="${escapeHtml(reminder.name)}"></button>
        </div>
      `
    )
    .join("");

  container.querySelectorAll(".reminder-item").forEach((item) => {
    item.querySelector(".setting-toggle").addEventListener("click", async () => {
      const reminderId = item.dataset.reminderId;
      state.reminders = state.reminders.map((reminder) =>
        reminder.id === reminderId
          ? { ...reminder, enabled: !reminder.enabled }
          : reminder
      );
      await persistReminders(t("reminderScheduleSynced"));
    });
  });
}

function getReminderPriority(interval) {
  if (interval <= 30) {
    return { label: t("high"), tone: "high" };
  }

  if (interval <= 45) {
    return { label: t("medium"), tone: "medium" };
  }

  return { label: t("low"), tone: "low" };
}

function formatReminderSubtitle(reminder) {
  if (reminder.type === "wellness") {
    return t("wellnessReset");
  }

  if (reminder.type === "custom") {
    return t("customReminder");
  }

  return `${capitalize(reminder.type)} ${t("reminder")}`;
}

function renderMoodSelection() {
  const todayPill = document.getElementById("today-mood-pill");
  if (!todayPill) {
    return;
  }

  document.querySelectorAll("#mood-picker .mood-option").forEach((button) => {
    const selected = button.dataset.mood === state.todayMood?.mood;
    button.classList.toggle("is-selected", selected);
  });

  if (!state.todayMood) {
    todayPill.textContent = t("notLoggedYet");
    return;
  }

  todayPill.textContent = getMoodLabel(state.todayMood.mood);
}

async function renderMindPage() {
  const chart = document.getElementById("weekly-mood-chart");
  const streakNode = document.getElementById("mood-streak");
  const bestDayNode = document.getElementById("best-day");
  const insightCopy = document.getElementById("mood-insight-copy");
  const insightChip = document.getElementById("mood-insight-chip");
  if (!chart || !streakNode || !bestDayNode || !insightCopy || !insightChip) {
    return;
  }

  const range = lastSevenDates();
  const keys = range.map((date) => buildMoodStorageKey(date));
  const entries = await extensionStorage.getMany(keys);
  const rows = range.map((date) => {
    const moodEntry = entries[buildMoodStorageKey(date)];
    return {
      date,
      mood: moodEntry?.mood ?? null
    };
  });

  chart.innerHTML = rows
    .map((row) => {
      const mood = row.mood ? MOOD_META[row.mood] : null;
      const height = mood ? 42 + mood.value * 32 : 20;
      const background = mood ? mood.color : "rgba(44,44,42,0.12)";
      return `
        <div class="chart-column">
          <div class="chart-bar" style="height:${height}px;background:${background};"></div>
          <span class="chart-label">${row.date.toLocaleDateString(getDateLocale(), { weekday: "short" }).slice(0, 2)}</span>
        </div>
      `;
    })
    .join("");

  const streak = calculateMoodStreak(rows);
  const bestDay = rows
    .filter((row) => row.mood)
    .sort((left, right) => MOOD_META[right.mood].value - MOOD_META[left.mood].value)[0];
  const insight = buildMoodInsight(rows);

  streakNode.textContent = `${streak} ${t(streak === 1 ? "daySingular" : "dayPlural")}`;
  bestDayNode.textContent = bestDay
    ? bestDay.date.toLocaleDateString(getDateLocale(), { weekday: "short" })
    : t("noData");
  insightCopy.textContent = insight;
  insightChip.textContent = bestDay
    ? tf("bestPeakedThisWeek", { mood: getMoodLabel(bestDay.mood) })
    : t("logMoodToStartTrends");
}

function renderJournalEntries() {
  const container = document.getElementById("journal-list");
  if (!container) {
    return;
  }

  if (state.journal.length === 0) {
    container.innerHTML =
      `<div class="empty-state">${t("noEntriesYet")}</div>`;
    return;
  }

  container.innerHTML = state.journal
    .slice(0, 8)
    .map((entry) => {
      const mood = entry.mood ? MOOD_META[entry.mood] : null;
      return `
        <div class="journal-item">
          <div class="journal-copy">
            <span class="journal-date">${new Date(entry.date).toLocaleDateString(getDateLocale(), { month: "short", day: "numeric" })}</span>
            <span class="journal-meta">${escapeHtml(trimText(entry.text, 88))}</span>
          </div>
          <div class="journal-actions">
            ${
              mood
                ? `<span class="mood-badge" style="background:${mood.background};color:${mood.color};">${getMoodLabel(entry.mood)}</span>`
                : ""
            }
            <button class="pill pill--purple is-button" type="button" data-journal-pin="${entry.id}">${t("pin")}</button>
          </div>
        </div>
      `;
    })
    .join("");

  container.querySelectorAll("[data-journal-pin]").forEach((button) => {
    button.addEventListener("click", async () => {
      const entry = state.journal.find((item) => item.id === button.dataset.journalPin);
      if (!entry) {
        return;
      }

      await pinJournalEntry(entry);
    });
  });
}

function renderQuickNotes() {
  renderCaptureWorkspace();
}

function renderCaptureWorkspace() {
  document.querySelectorAll("[data-capture-tab]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.captureTab === state.captureTab);
  });

  document.querySelectorAll("[data-capture-panel]").forEach((panel) => {
    panel.hidden = panel.dataset.capturePanel !== state.captureTab;
  });

  const quickList = document.getElementById("capture-note-list");
  const journalPreview = document.getElementById("capture-journal-preview");
  const vaultPreview = document.getElementById("capture-vault-preview");
  const noteInput = document.getElementById("quick-note-input");

  if (noteInput && state.captureTab === "quick-note") {
    noteInput.placeholder = t("writeBeforeLoseIt");
  }

  if (quickList) {
    const notes = state.quickNotes.filter((note) => !note.archived).slice(0, 4);
    quickList.innerHTML = notes.length === 0
      ? `<div class="empty-state">${t("noQuickNotesYet")}</div>`
      : notes.map((note) => renderQuickNoteRow(note)).join("");

    quickList.querySelectorAll("[data-note-pin]").forEach((button) => {
      button.addEventListener("click", async () => {
        await pinQuickNote(button.dataset.notePin);
      });
    });

    quickList.querySelectorAll("[data-note-promote]").forEach((button) => {
      button.addEventListener("click", () => {
        promoteQuickNoteToJournal(button.dataset.notePromote);
      });
    });

    quickList.querySelectorAll("[data-note-delete]").forEach((button) => {
      button.addEventListener("click", async () => {
        await deleteQuickNote(button.dataset.noteDelete);
      });
    });
  }

  if (journalPreview) {
    const entries = state.journal.slice(0, 3);
    journalPreview.innerHTML = entries.length === 0
      ? `<div class="empty-state">${t("noEntriesYet")}</div>`
      : entries.map((entry) => `
          <div class="capture-preview-item">
            <span class="capture-preview-title">${new Date(entry.date).toLocaleDateString(getDateLocale(), { month: "short", day: "numeric" })}</span>
            <span class="capture-preview-meta">${escapeHtml(trimText(entry.text, 70))}</span>
          </div>
        `).join("");
  }

  if (vaultPreview) {
    const entries = state.vault.slice(0, 4);
    vaultPreview.innerHTML = entries.length === 0
      ? `<div class="empty-state">${t("noVaultItemsYet")}</div>`
      : entries.map((entry) => `
          <div class="capture-preview-item capture-preview-item--vault">
            <span class="capture-preview-title">${escapeHtml(trimText(entry.text, 36))}</span>
            <span class="capture-preview-meta">${entry.sourceType === "journal" ? t("fromJournal") : t("fromNote")}</span>
          </div>
        `).join("");
  }
}

function renderQuickNoteRow(note) {
  return `
    <div class="capture-note-item">
      <div class="capture-note-copy">
        <span class="capture-note-text">${escapeHtml(trimText(note.text, 78))}</span>
        <span class="capture-note-meta">${new Date(note.updatedAt).toLocaleTimeString(getDateLocale(), { hour: "numeric", minute: "2-digit" })}</span>
      </div>
      <div class="capture-note-actions">
        <button class="pill pill--purple is-button" type="button" data-note-pin="${note.id}">${note.pinned ? t("pinned") : t("pin")}</button>
        <button class="pill pill--amber is-button" type="button" data-note-promote="${note.id}">${t("promote")}</button>
        <button class="card-link capture-note-delete" type="button" data-note-delete="${note.id}">${t("delete")}</button>
      </div>
    </div>
  `;
}

function renderVaultEntries() {
  const container = document.getElementById("vault-list");
  if (!container) {
    renderCaptureWorkspace();
    return;
  }

  if (state.vault.length === 0) {
    container.innerHTML = `<div class="empty-state">${t("noVaultItemsYet")}</div>`;
    renderCaptureWorkspace();
    return;
  }

  container.innerHTML = state.vault
    .slice(0, 12)
    .map((entry) => `
      <div class="journal-item">
        <div class="journal-copy">
          <span class="journal-date">${entry.sourceType === "journal" ? t("fromJournal") : t("fromNote")}</span>
          <span class="journal-meta">${escapeHtml(trimText(entry.text, 92))}</span>
        </div>
        <div class="journal-actions">
          ${entry.sourceType === "quickNote"
            ? `<button class="pill pill--amber is-button" type="button" data-vault-promote="${entry.id}">${t("moveToJournal")}</button>`
            : ""}
          <button class="pill pill--purple is-button" type="button" data-vault-unpin="${entry.id}">${t("unpin")}</button>
        </div>
      </div>
    `)
    .join("");

  container.querySelectorAll("[data-vault-unpin]").forEach((button) => {
    button.addEventListener("click", async () => {
      await unpinVaultEntry(button.dataset.vaultUnpin);
    });
  });

  container.querySelectorAll("[data-vault-promote]").forEach((button) => {
    button.addEventListener("click", () => {
      const item = state.vault.find((entry) => entry.id === button.dataset.vaultPromote);
      if (!item) {
        return;
      }

      state.journalDraft = item.text;
      routeTo("journal");
      fillJournalDraft();
      updateJournalStatus(t("promotedToJournal"));
    });
  });

  renderCaptureWorkspace();
}

function renderSettings() {
  const container = document.getElementById("settings-list");
  if (!container) {
    return;
  }

  const settings = Object.entries(SETTING_LABELS).map(([key]) => {
    const labels = {
      quotesEnabled: {
        name: t("quotesInNotifications"),
        meta: t("quotesInNotificationsMeta")
      },
      moodPromptEnabled: {
        name: t("moodPrompts"),
        meta: t("moodPromptsMeta")
      },
      fadeOutEnabled: {
        name: t("fadeAudio"),
        meta: t("fadeAudioMeta")
      }
    };
    return [key, labels[key]];
  });
  const currentTheme = state.settings.theme ?? "system";
  const currentLang = state.settings.language ?? "auto";

  const togglesHtml = settings
    .map(
      ([key, meta]) => `
        <div class="setting-item" data-setting-key="${key}">
          <div class="setting-copy">
            <span class="setting-name">${meta.name}</span>
            <span class="setting-meta">${meta.meta}</span>
          </div>
          <button class="setting-toggle ${state.settings[key] ? "is-on" : ""}" aria-label="${meta.name}"></button>
        </div>
      `
    )
    .join("");

  const themeHtml = `
    <div class="setting-item">
      <div class="setting-copy">
        <span class="setting-name">${t("theme")}</span>
        <span class="setting-meta">${t("themeMeta")}</span>
      </div>
      <div class="setting-segmented" id="theme-selector">
        <button class="seg-btn ${currentTheme === "light" ? "is-active" : ""}" data-theme-val="light" type="button">${t("light")}</button>
        <button class="seg-btn ${currentTheme === "dark" ? "is-active" : ""}" data-theme-val="dark" type="button">${t("dark")}</button>
        <button class="seg-btn ${currentTheme === "system" ? "is-active" : ""}" data-theme-val="system" type="button">${t("system")}</button>
      </div>
    </div>
  `;

  const langHtml = `
    <div class="setting-item">
      <div class="setting-copy">
        <span class="setting-name">${t("language")}</span>
        <span class="setting-meta">${t("languageMeta")}</span>
      </div>
      <div class="setting-segmented" id="lang-selector">
        <button class="seg-btn ${currentLang === "auto" ? "is-active" : ""}" data-lang-val="auto" type="button">${t("auto")}</button>
        <button class="seg-btn ${currentLang === "en" ? "is-active" : ""}" data-lang-val="en" type="button">EN</button>
        <button class="seg-btn ${currentLang === "vi" ? "is-active" : ""}" data-lang-val="vi" type="button">VI</button>
      </div>
    </div>
  `;

  container.innerHTML = togglesHtml + themeHtml + langHtml;

  // Toggle listeners
  container.querySelectorAll("[data-setting-key]").forEach((item) => {
    item.querySelector(".setting-toggle").addEventListener("click", async () => {
      const key = item.dataset.settingKey;
      state.settings = {
        ...state.settings,
        [key]: !state.settings[key]
      };
      await extensionStorage.set({ settings: state.settings });
      applyTheme();
      renderSettings();
      if (key === "quotesEnabled") {
        renderFeaturedQuote();
      }
    });
  });

  // Theme selector
  container.querySelectorAll("#theme-selector .seg-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      state.settings = { ...state.settings, theme: btn.dataset.themeVal };
      await extensionStorage.set({ settings: state.settings });
      applyTheme();
      applyLocale();
      renderSettings();
    });
  });

  // Language selector
  container.querySelectorAll("#lang-selector .seg-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      state.settings = { ...state.settings, language: btn.dataset.langVal };
      await extensionStorage.set({ settings: state.settings });
      applyLocale();
      renderSettings();
    });
  });
}

function renderFocusState() {
  const focus = state.focus;
  const intentionInput = document.getElementById("focus-intention-input");
  const startButton = document.getElementById("focus-start-button");
  const pauseButton = document.getElementById("focus-pause-button");
  const resetButton = document.getElementById("focus-reset-button");
  if (!intentionInput || !startButton || !pauseButton || !resetButton) {
    return;
  }

  if (document.activeElement !== intentionInput) {
    intentionInput.value = focus.intention;
  }

  document
    .querySelectorAll("[data-duration-minutes]")
    .forEach((button) =>
      button.classList.toggle(
        "is-selected",
        Number(button.dataset.durationMinutes) * 60 * 1000 === focus.durationMs
      )
    );

  startButton.textContent = focus.status === "paused" ? t("resume") : t("start");
  pauseButton.textContent = t("pause");
  resetButton.textContent = t("reset");
  startButton.disabled = focus.status === "running";
  pauseButton.disabled = focus.status !== "running";
  resetButton.disabled = focus.status === "idle";

  renderFocusCountdown();
  syncFocusTicker();
  renderFocusSoundStatus();
}

function renderFocusSoundStatus() {
  const bar = document.getElementById("focus-sound-status");
  const title = document.getElementById("focus-sound-status-title");
  const subtitle = document.getElementById("focus-sound-status-subtitle");

  if (!bar || !title || !subtitle) return;

  const { playing, paused, type } = state.soundState;

  bar.classList.toggle("is-playing", playing && !paused);
  bar.classList.toggle("is-paused", playing && paused);

  if (playing && paused) {
    title.textContent = `${getSoundLabel(type)} paused`;
    subtitle.textContent = "Will resume when you return";
  } else if (playing) {
    title.textContent = `${getSoundLabel(type)} ${t("isPlaying")}`;
    subtitle.textContent = t("tapSidebarToChange");
  } else {
    title.textContent = t("addAmbience");
    subtitle.textContent = t("tapSidebarSoundIcon");
  }
}

function renderFocusCountdown() {
  const focus = state.focus;
  const remainingMs = getRemainingFocusMs(focus);
  const totalMs = Math.max(1, focus.durationMs);
  const progress =
    focus.status === "completed" ? 1 : Math.min(1, Math.max(0, 1 - remainingMs / totalMs));
  const chip = document.getElementById("focus-status-chip");
  const ring = document.getElementById("focus-ring");
  const timeValue = document.getElementById("focus-time-value");
  const timeLabel = document.getElementById("focus-time-label");

  if (!chip || !ring || !timeValue || !timeLabel) return;

  ring.style.setProperty("--focus-progress", String(progress));

  if (focus.status === "completed") {
    timeValue.textContent = t("done");
    timeLabel.textContent = focus.intention;
    chip.textContent = t("completed");
    return;
  }

  timeValue.textContent = formatClock(
    focus.status === "idle" ? focus.durationMs : remainingMs
  );

  if (focus.status === "running") {
    timeLabel.textContent = `${focus.intention} ${t("inProgress")}`;
    chip.textContent = `${t("runningWithTimeLeft")} | ${formatMinutesLabel(remainingMs)} ${t("left")}`;
    return;
  }

  if (focus.status === "paused") {
    timeLabel.textContent = t("paused");
    chip.textContent = `${t("pausedWithTimeLeft")} | ${formatMinutesLabel(remainingMs)} ${t("left")}`;
    return;
  }

  timeLabel.textContent = t("readyToStart");
  chip.textContent = `${formatMinutesLabel(focus.durationMs)} ${t("sessionLabel")}`;
}

function renderFocusHistory() {
  const container = document.getElementById("focus-history-list");
  if (!container) {
    return;
  }

  if (state.focusHistory.length === 0) {
    container.innerHTML =
      `<div class="empty-state">${t("completeFocusBlockTrail")}</div>`;
    return;
  }

  container.innerHTML = state.focusHistory
    .slice(0, 6)
    .map(
      (entry) => `
        <div class="journal-item">
          <div class="journal-copy">
            <span class="journal-date">${escapeHtml(entry.intention)}</span>
            <span class="journal-meta">${formatMinutesLabel(entry.durationMs)} | ${new Date(entry.date).toLocaleDateString(getDateLocale(), { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span>
          </div>
          ${entry.soundType ? `<span class="mood-badge" style="background:#E1F5EE;color:#0F6E56;">${escapeHtml(getSoundLabel(entry.soundType))}</span>` : ""}
        </div>
      `
    )
    .join("");
}

function renderBlockedSites() {
  const container = document.getElementById("blocked-sites-list");
  const count = document.getElementById("blocked-site-count");
  if (!container || !count) {
    return;
  }

  const sites = state.focus.blockedSites;

  count.textContent = `${sites.length} ${t("hosts")}`;

  if (sites.length === 0) {
    container.innerHTML =
      `<div class="empty-state">${t("noBlockedHostsYet")}</div>`;
    return;
  }

  container.innerHTML = sites
    .map(
      (site) => `
        <div class="timeline-item">
          <div class="timeline-copy">
            <span class="timeline-title">${escapeHtml(site)}</span>
            <span class="timeline-meta">${t("exactHostBlocked")}</span>
          </div>
          <button class="pill pill--amber is-button" type="button" data-remove-host="${site}">${t("remove")}</button>
        </div>
      `
    )
    .join("");

  container.querySelectorAll("[data-remove-host]").forEach((button) => {
    button.addEventListener("click", async () => {
      await sendFocusMessage("FOCUS_UPDATE_OPTIONS", {
        blockedSites: state.focus.blockedSites.filter(
          (site) => site !== button.dataset.removeHost
        )
      });
    });
  });
}

function syncFocusTicker() {
  if (focusTickerId) {
    window.clearInterval(focusTickerId);
    focusTickerId = null;
  }

  if (state.focus.status !== "running") {
    return;
  }

  focusTickerId = window.setInterval(() => {
    if (state.focus.status !== "running") {
      return;
    }

    renderFocusCountdown();
  }, 1000);
}

function applyTheme() {
  const theme = state.settings.theme ?? "system";
  let resolved;
  if (theme === "system") {
    resolved = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  } else {
    resolved = theme;
  }
  document.documentElement.dataset.theme = resolved;
}

function applyLocale() {
  setLocale(state.settings.language ?? "auto");
  document.documentElement.lang = getLocale();

  setText("home-headline", t("appName"));
  setText("featured-quote-label", t("quoteForToday"));
  setText("home-dashboard-label", t("dashboard"));
  setText("home-up-next-label", t("upNext"));
  setText("home-sort-label", t("sortTime"));
  setText("home-view-calendar-label", t("viewFullCalendar"));
  setText("home-screen-time-label", t("screenTimeAndFocus"));
  setText("home-tracker-meta", t("adsBlocked"));
  setText("home-quick-tools-label", t("captureWorkspace"));
  setText("capture-tab-note-label", t("quickNote"));
  setText("capture-tab-journal-label", t("journal"));
  setText("capture-tab-vault-label", t("vault"));
  setText("quick-note-save-label", t("saveToInbox"));
  setInputPlaceholder("#quick-note-input", t("writeBeforeLoseIt"));
  setText("capture-open-journal-label", t("openJournal"));
  setText("capture-open-vault-label", t("openVault"));
  setText("home-mood-label", t("howFeeling"));
  setText("focus-sound-status-title", t("addAmbience"));
  setText("focus-sound-status-subtitle", t("tapSidebarSoundIcon"));

  updateHomePreferenceControls();
  updateNavTranslations();
  updateMoodOptionLabels();
  updateStaticPageCopy();
  updateSoundPanelCopy();
  syncSoundPanel();

  renderDashboardReminders();
  renderReminderAttention();
  renderMoodSelection();
  renderSettings();
  renderFocusState();
  renderFocusHistory();
  renderBlockedSites();
  renderJournalEntries();
  renderQuickNotes();
  renderVaultEntries();
  void renderScreenTimePage();
}

function updateHomePreferenceControls() {
  const themeLabel = document.getElementById("home-theme-toggle-label");
  const languageLabel = document.getElementById("home-language-toggle-label");
  const themeButton = document.getElementById("home-theme-toggle");
  const languageButton = document.getElementById("home-language-toggle");

  if (themeLabel) {
    themeLabel.textContent = t(state.settings.theme ?? "system");
  }
  if (languageLabel) {
    const languageKey = state.settings.language === "vi"
      ? "vietnamese"
      : state.settings.language === "en"
        ? "english"
        : "auto";
    languageLabel.textContent = t(languageKey);
  }
  if (themeButton) {
    themeButton.title = `${t("theme")}: ${t(state.settings.theme ?? "system")}`;
  }
  if (languageButton) {
    languageButton.title = `${t("language")}: ${languageLabel?.textContent ?? t("auto")}`;
  }

  const sideButton = document.getElementById("btn-pin-side");
  if (sideButton) {
    sideButton.title = t("openCompactSidePanel");
    sideButton.setAttribute("aria-label", t("openCompactSidePanel"));
  }

  const dashboardButton = document.getElementById("btn-open-dashboard");
  if (dashboardButton) {
    dashboardButton.title = t("openWideDashboard");
    dashboardButton.setAttribute("aria-label", t("openWideDashboard"));
  }
}

function updateNavTranslations() {
  const mapping = {
    home: t("dashboard"),
    focus: t("focusMode"),
    mind: t("mindCheckIn"),
    reminders: t("reminders"),
    screentime: t("screenTime"),
    journal: t("journal"),
    vault: t("vault"),
    journey: t("journey"),
    settings: t("settings")
  };

  document.querySelectorAll("[data-page]").forEach((button) => {
    const label = mapping[button.dataset.page];
    if (!label) {
      return;
    }
    button.title = label;
    button.setAttribute("aria-label", label);
  });

  const soundButton = document.getElementById("nav-sound-toggle");
  if (soundButton && !state.soundState.playing) {
    soundButton.title = t("sounds");
    soundButton.setAttribute("aria-label", t("sounds"));
  }
}

function updateStaticPageCopy() {
  setSelectorText('[data-page-panel="focus"] .eyebrow', t("focusMode"));
  setSelectorText('[data-page-panel="focus"] h1', t("timerSoundsSiteBlocking"));
  setSelectorText(".focus-label span", t("sessionIntention"));
  setInputPlaceholder("#focus-intention-input", t("deepWork"));
  setSelectorText('[data-page-panel="focus"] .list-card:first-of-type .card-label', t("blockedSites"));
  setSelectorText('#blocked-site-form button[type="submit"]', t("addHost"));
  setSelectorText('[data-page-panel="focus"] .list-card:last-of-type .card-label', t("recentSessions"));

  setSelectorText('[data-page-panel="mind"] .eyebrow', t("mindCheckIn"));
  setSelectorText('[data-page-panel="mind"] h1', t("weeklyMoodTrend"));
  setSelectorText('[data-page-panel="mind"] .chart-card .card-label', t("last7Days"));
  setSelectorText('[data-page-panel="mind"] .metric-pair div:first-child .metric-label', t("streak"));
  setSelectorText('[data-page-panel="mind"] .metric-pair div:last-child .metric-label', t("bestDay"));

  setSelectorText('[data-page-panel="reminders"] .eyebrow', t("reminders"));
  setSelectorText('[data-page-panel="reminders"] h1', t("wellnessPrompts"));
  setSelectorText('[data-page-panel="reminders"] .list-card .card-label', t("activeReminders"));
  setSelectorText('[data-page-panel="reminders"] .form-card .card-label', t("createCustomReminder"));
  setSelectorText('#custom-reminder-form label:nth-of-type(1) span', t("name"));
  setSelectorText('#custom-reminder-form label:nth-of-type(2) span', t("intervalMinutes"));
  setSelectorText('#custom-reminder-form label:nth-of-type(3) span', t("icon"));
  setInputPlaceholder('#custom-reminder-form input[name="name"]', t("takeMeds"));
  setSelectorText('#custom-reminder-form button[type="submit"]', t("addReminder"));

  setSelectorText('[data-page-panel="screentime"] .eyebrow', t("screenTime"));
  setSelectorText('[data-page-panel="screentime"] h1', t("whereAttention"));
  setSelectorText('[data-period="today"]', t("today"));
  setSelectorText('[data-period="week"]', t("week"));
  setSelectorText('[data-period="month"]', t("month"));
  setSelectorText('[data-page-panel="screentime"] .metric-pair div:first-child .metric-label', t("total"));
  setSelectorText('[data-page-panel="screentime"] .metric-pair div:last-child .metric-label', t("productive"));
  setSelectorText('[data-page-panel="screentime"] .list-card .card-label', t("topSites"));

  setSelectorText('[data-page-panel="journal"] h1', t("myJournal"));
  setSelectorText('[data-page-panel="journal"] .eyebrow', t("captureContext"));
  setInlineLabel('[data-page-panel="journal"] .private-pill', t("private"));
  setSelectorText('[data-page-panel="journal"] .form-card .card-label', t("newEntry"));
  setSelectorText('[data-page-panel="journal"] .list-card .card-label', t("recentEntries"));
  setInputPlaceholder("#journal-text", t("whatsOnMind"));
  setSelectorText('#journal-form button[type="submit"]', t("saveEntry"));

  setSelectorText('[data-page-panel="vault"] .eyebrow', t("vault"));
  setSelectorText('[data-page-panel="vault"] h1', t("keptItems"));
  setSelectorText('[data-page-panel="vault"] .list-card .card-label', t("savedForLater"));
  setSelectorText('[data-page-panel="vault"] .stack-card .card-label', t("vaultHowItWorks"));
  setSelectorText('[data-page-panel="vault"] .stack-card .insight-copy', t("vaultMeta"));

  setSelectorText('[data-page-panel="journey"] .eyebrow', t("journey"));
  setSelectorText('[data-page-panel="settings"] .eyebrow', t("settings"));
  setSelectorText('[data-page-panel="settings"] h1', t("preferencesAndData"));
  setSelectorText('[data-page-panel="settings"] .list-card .card-label', t("preferences"));
  setSelectorText('[data-page-panel="settings"] .stack-card .card-label', t("data"));
  setSelectorText('[data-page-panel="settings"] .stack-card .insight-copy', t("exportMeta"));
  setSelectorText("#export-data-button", t("exportData"));

  setSelectorText(".sound-panel__title", t("sounds"));
  setInlineLabel(".tracker-card .pill--teal", t("activeState"));

  const quickToolsButton = document.querySelector(".card-dots");
  if (quickToolsButton) {
    quickToolsButton.title = t("moreOptions");
    quickToolsButton.setAttribute("aria-label", t("moreOptions"));
  }

  updateQuickNoteStatus(t("quickNoteReady"));
}

function updateSoundPanelCopy() {
  document.querySelectorAll(".sound-tile").forEach((tile) => {
    const icon = tile.querySelector(".sound-tile__icon");
    tile.textContent = "";
    if (icon) {
      tile.append(icon);
    }
    tile.append(document.createTextNode(getSoundLabel(tile.dataset.soundId)));
  });
}

function updateMoodOptionLabels() {
  document.querySelectorAll("#mood-picker .mood-option").forEach((button) => {
    const label = button.querySelector(".mood-option__label");
    if (!label) {
      return;
    }
    label.textContent = getMoodLabel(button.dataset.mood);
  });
}

function applySurfaceMode() {
  const params = new URLSearchParams(window.location.search);
  const surface = params.get("surface") === "dashboard" ? "dashboard" : "popup";
  document.body.dataset.surface = surface;
}

async function persistReminders(statusText) {
  await extensionStorage.set({ reminders: state.reminders });
  await chrome.runtime.sendMessage({ type: "SYNC_REMINDERS" });
  renderReminders();
  renderDashboardReminders();
  updateReminderStatus(statusText);
}

function updateJournalStatus(message) {
  const statusNode = document.getElementById("journal-status");
  if (statusNode) {
    statusNode.textContent = message;
  }
}

function normalizeReminderAttention(value = {}) {
  const pendingCount = Number(value.pendingCount);
  return {
    pendingCount: Number.isFinite(pendingCount) ? Math.max(0, pendingCount) : 0,
    lastReminderName: typeof value.lastReminderName === "string" && value.lastReminderName.length > 0
      ? value.lastReminderName
      : null
  };
}

function updateReminderStatus(message) {
  const statusNode = document.getElementById("reminder-status");
  if (statusNode) {
    statusNode.textContent = message;
  }
}

function renderReminderAttention() {
  if (state.reminderAttention.pendingCount > 0) {
    updateReminderStatus(tf("pendingReminders", {
      count: state.reminderAttention.pendingCount
    }));
    document.getElementById("reminder-status")?.classList.add("quote-chip--alert");
    return;
  }

  updateReminderStatus(t("sync"));
  document.getElementById("reminder-status")?.classList.remove("quote-chip--alert");
}

async function commitFocusIntention() {
  const value = document.getElementById("focus-intention-input").value.trim();

  if (!value || value === state.focus.intention) {
    return;
  }

  await sendFocusMessage("FOCUS_UPDATE_OPTIONS", {
    intention: value
  });
}

async function sendFocusMessage(type, payload = {}) {
  const response = await chrome.runtime.sendMessage({
    type,
    payload
  });

  if (!response?.ok) {
    throw new Error(response?.error ?? `Focus action failed: ${type}`);
  }

  if (response.result && type !== "SYNC_REMINDERS") {
    state.focus = normalizeFocusState(response.result);
    renderFocusState();
    renderBlockedSites();
  }

  return response.result;
}

function getRemainingFocusMs(focus) {
  if (focus.status === "running" && focus.endTime) {
    return Math.max(0, focus.endTime - Date.now());
  }

  if (focus.status === "paused") {
    return Math.max(0, focus.remainingMs ?? focus.durationMs);
  }

  if (focus.status === "completed") {
    return 0;
  }

  return focus.durationMs;
}

// --- Screen time ---

async function renderScreenTimePage() {
  const data = await aggregateScreenTime(state.screentimePeriod);
  const totalNode = document.getElementById("screentime-total");
  const productiveNode = document.getElementById("screentime-productive");
  const insightNode = document.getElementById("screentime-insight");
  const siteList = document.getElementById("screentime-site-list");
  if (!totalNode || !productiveNode || !insightNode || !siteList) {
    return;
  }

  totalNode.textContent = formatDuration(data.total);

  const productivePercent = data.total > 0
    ? Math.round((data.productive / data.total) * 100)
    : 0;
  productiveNode.textContent = `${productivePercent}%`;

  if (data.total === 0) {
    insightNode.textContent = t("startBrowsingInsight");
    siteList.innerHTML = `<div class="empty-state">${t("noScreenTimeRecorded")}</div>`;
    updateDashboardScreenTime(data);
    return;
  }

  const socialPercent = Math.round((data.social / data.total) * 100);
  insightNode.textContent = tf("productiveSocialSummary", {
    productive: productivePercent,
    social: socialPercent,
    sites: Object.keys(data.sites).length
  });

  const sortedSites = Object.entries(data.sites)
    .sort(([, a], [, b]) => b.time - a.time)
    .slice(0, 5);

  const maxTime = sortedSites[0]?.[1].time ?? 1;

  siteList.innerHTML = sortedSites
    .map(([domain, info]) => {
      const barPercent = Math.max(2, Math.round((info.time / maxTime) * 100));
      const colors = CATEGORY_COLORS[info.category] ?? CATEGORY_COLORS.other;
      return `
        <div class="site-item">
          <div class="site-item__header">
            <span class="site-item__domain">${escapeHtml(domain)}</span>
            <div style="display:flex;align-items:center;gap:6px;">
              <span class="pill ${colors.pill}">${getCategoryLabel(info.category)}</span>
              <span class="site-item__time">${formatDuration(info.time)}</span>
            </div>
          </div>
          <div class="site-item__bar-track">
            <div class="site-item__bar-fill ${colors.bar}" style="width:${barPercent}%;"></div>
          </div>
        </div>
      `;
    })
    .join("");

  updateDashboardScreenTime(data);
}

function updateDashboardScreenTime(data) {
  const dashboardTotal = document.getElementById("dashboard-screentime-total");
  const pillNode = document.getElementById("dashboard-productive-pill");
  const metaNode = document.getElementById("dashboard-screentime-meta");
  const statusNode = document.getElementById("dashboard-screentime-status");
  const chartNode = document.getElementById("dashboard-spark-chart");

  if (!dashboardTotal || !pillNode || !metaNode || !statusNode || !chartNode) {
    return;
  }

  const productivePercent = data.total > 0
    ? Math.round((data.productive / data.total) * 100)
    : 0;
  const status = getDashboardScreenTimeStatus(data.total, productivePercent);

  dashboardTotal.textContent = formatDuration(data.total);
  pillNode.textContent = status.pillText;
  pillNode.className = `pill ${status.pillClass}`;
  metaNode.textContent = status.meta;
  statusNode.textContent = status.text;
  statusNode.hidden = !status.text;
  statusNode.dataset.tone = status.tone;

  renderDashboardSparkChart(chartNode, data);
}

function getDashboardScreenTimeStatus(totalMs, productivePercent) {
  if (totalMs < 60000) {
    return {
      pillText: t("startBrowsing"),
      pillClass: "pill--teal-solid",
      meta: t("startBrowsingMeta"),
      text: "",
      tone: "neutral"
    };
  }

  if (productivePercent >= 50) {
    return {
      pillText: `${productivePercent}% ${t("score")}`,
      pillClass: "pill--purple",
      meta: t("productiveDayInsight"),
      text: t("onTrack"),
      tone: "positive"
    };
  }

  return {
    pillText: `${productivePercent}% ${t("score")}`,
    pillClass: "pill--amber",
    meta: t("distractedDayInsight"),
    text: t("distractionHigh"),
    tone: "warning"
  };
}

function renderDashboardSparkChart(chartNode, data) {
  const fallbackHeights = [30, 50, 45, 70, 60, 80, 55, 65, 40];
  if (data.total < 60000) {
    chartNode.innerHTML = fallbackHeights
      .map((height, index) => `<div class="spark-bar ${index >= 6 ? "spark-bar--strong" : ""}" style="height:${height}%"></div>`)
      .join("");
    return;
  }

  const siteTimes = Object.values(data.sites)
    .map((info) => info.time ?? 0)
    .sort((left, right) => right - left)
    .slice(0, 9);
  const maxTime = siteTimes[0] ?? 1;

  chartNode.innerHTML = Array.from({ length: 9 }, (_, index) => {
    const value = siteTimes[index] ?? siteTimes[siteTimes.length - 1] ?? maxTime * 0.4;
    const height = Math.max(28, Math.round((value / maxTime) * 100));
    return `<div class="spark-bar ${index >= 6 ? "spark-bar--strong" : ""}" style="height:${height}%"></div>`;
  }).join("");
}

async function aggregateScreenTime(period) {
  const dates = buildDateRange(period);
  const keys = dates.map((date) => SCREENTIME_KEY_PREFIX + formatIsoDate(date));
  const entries = await extensionStorage.getMany(keys);

  const result = { total: 0, productive: 0, social: 0, other: 0, sites: {} };

  for (const key of keys) {
    const entry = entries[key];

    if (!entry) {
      continue;
    }

    result.total += entry.total ?? 0;

    for (const [domain, info] of Object.entries(entry.sites ?? {})) {
      const category = info.category ?? categorizeDomain(domain);
      const time = info.time ?? 0;

      if (category === "productivity") {
        result.productive += time;
      } else if (category === "social") {
        result.social += time;
      } else {
        result.other += time;
      }

      if (result.sites[domain]) {
        result.sites[domain].time += time;
      } else {
        result.sites[domain] = { time, category };
      }
    }
  }

  return result;
}

function buildDateRange(period) {
  const days = period === "month" ? 30 : period === "week" ? 7 : 1;
  return Array.from({ length: days }, (_, index) => {
    const date = new Date();
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() - (days - 1 - index));
    return date;
  });
}

function formatDuration(ms) {
  if (!ms || ms <= 0) {
    return "0m";
  }

  const totalMinutes = Math.round(ms / 60_000);

  if (totalMinutes < 1) {
    return "<1m";
  }

  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours === 0) {
    return `${minutes}m`;
  }

  return `${hours}h ${String(minutes).padStart(2, "0")}m`;
}

function calculateMoodStreak(rows) {
  let streak = 0;

  for (let index = rows.length - 1; index >= 0; index -= 1) {
    if (!rows[index].mood) {
      break;
    }
    streak += 1;
  }

  return streak;
}

function buildMoodInsight(rows) {
  const validRows = rows.filter((row) => row.mood);

  if (validRows.length === 0) {
    return t("onceLogDays");
  }

  const best = validRows.reduce((current, row) =>
    MOOD_META[row.mood].value > MOOD_META[current.mood].value ? row : current
  );
  const worst = validRows.reduce((current, row) =>
    MOOD_META[row.mood].value < MOOD_META[current.mood].value ? row : current
  );

  if (best.mood === worst.mood) {
    return tf("loggedDaysClustering", { mood: getMoodLabel(best.mood).toLowerCase() });
  }

  return tf("bestDayWorstDay", {
    best: best.date.toLocaleDateString(getDateLocale(), { weekday: "long" }),
    worst: worst.date.toLocaleDateString(getDateLocale(), { weekday: "long" })
  });
}

function lastSevenDates() {
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date();
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() - (6 - index));
    return date;
  });
}

function buildMoodStorageKey(date) {
  return `mood_${formatIsoDate(date)}`;
}

function setText(id, value) {
  const node = document.getElementById(id);
  if (node) {
    node.textContent = value;
  }
}

function getMoodLabel(moodId) {
  const labels = {
    rough: t("stressed"),
    okay: t("okayMood"),
    good: t("good"),
    great: t("great")
  };
  return labels[moodId] ?? moodId;
}

function getSoundLabel(soundId) {
  const labels = {
    white: t("soundWhite"),
    pink: t("soundPink"),
    brown: t("soundBrown"),
    dark: t("soundDark"),
    rain: t("soundRain"),
    forest: t("soundForest"),
    cafe: t("soundCafe"),
    ocean: t("soundOcean")
  };
  return labels[soundId] ?? soundId ?? "";
}

function getCategoryLabel(category) {
  const labels = {
    productivity: t("productive"),
    social: t("social"),
    other: t("other")
  };
  return labels[category] ?? labels.other;
}

function normalizeBlockedSiteInput(value) {
  return String(value).trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
}

function formatIsoDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatClock(durationMs) {
  const minutes = Math.floor(durationMs / 60_000);
  const seconds = Math.floor((durationMs % 60_000) / 1000);
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function formatMinutesLabel(durationMs) {
  const minutes = Math.round(durationMs / 60_000);
  return tf("minutesShort", { count: minutes });
}

function formatEveryInterval(interval) {
  return tf("everyMinutes", { count: interval });
}

function trimText(value, maxLength) {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength - 3)}...`;
}

function capitalize(value) {
  if (!value) {
    return "";
  }

  return value.charAt(0).toUpperCase() + value.slice(1);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function setSelectorText(selector, value) {
  const node = document.querySelector(selector);
  if (node) {
    node.textContent = value;
  }
}

function setInputPlaceholder(selector, value) {
  const input = document.querySelector(selector);
  if (input) {
    input.placeholder = value;
  }
}

function setInlineLabel(selector, value) {
  const node = document.querySelector(selector);
  if (!node) {
    return;
  }

  const preservedChild = node.firstElementChild?.cloneNode(true);
  node.textContent = "";
  if (preservedChild) {
    node.append(preservedChild);
    node.append(document.createTextNode(` ${value}`));
    return;
  }
  node.textContent = value;
}

function getDateLocale() {
  return getLocale() === "vi" ? "vi-VN" : "en-US";
}
