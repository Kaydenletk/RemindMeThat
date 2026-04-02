import {
  DEFAULT_FOCUS,
  DEFAULT_REMINDERS,
  DEFAULT_SETTINGS,
  DEFAULT_SOUND_STATE,
  createDefaultState,
  normalizeFocusState,
  normalizeReminders,
  normalizeSettings,
  normalizeSoundState
} from "../utils/defaults.js";
import { getRandomQuote } from "../utils/quotes.js";
import { extensionStorage } from "../utils/storage.js";
import { categorizeDomain } from "../utils/categories.js";

const REMINDER_ALARM_PREFIX = "reminder_";
const FOCUS_ALARM_NAME = "focus_session_end";
const OFFSCREEN_DOCUMENT_PATH = "offscreen/offscreen.html";
const DEFAULT_REMINDER_ATTENTION = {
  pendingCount: 0,
  lastReminderName: null
};

chrome.runtime.onInstalled.addListener(() => {
  void initializeExtension();
});

chrome.runtime.onStartup.addListener(() => {
  void initializeExtension();
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local" || !changes.settings) {
    return;
  }

  void handleSettingsChanged(
    changes.settings.oldValue ?? DEFAULT_SETTINGS,
    changes.settings.newValue ?? DEFAULT_SETTINGS
  );
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const handlers = {
    SYNC_REMINDERS: () => syncReminderAlarms(),
    CLEAR_REMINDER_ATTENTION: () => clearReminderAttention(),
    FOCUS_START: () => startFocusSession(message.payload ?? {}),
    FOCUS_PAUSE: () => pauseFocusSession(),
    FOCUS_RESUME: () => resumeFocusSession(),
    FOCUS_RESET: () => resetFocusSession(message.payload ?? {}),
    FOCUS_UPDATE_OPTIONS: () => updateFocusOptions(message.payload ?? {}),
    PLAY_NOISE: () => handlePlayNoise(message.payload ?? {}),
    STOP_NOISE: () => handleStopNoise(message.payload ?? {}),
    PAUSE_NOISE: () => handlePauseNoise(),
    RESUME_NOISE: () => handleResumeNoise(),
    SET_VOLUME: () => handleSetVolume(message.payload ?? {}),
    OPEN_SIDE_PANEL: () => openSidePanel(message.payload ?? {}),
    OPEN_POPUP: () => openPopupSurface(),
    OPEN_DASHBOARD: () => openDashboardSurface()
  };

  const handler = handlers[message?.type];

  if (!handler) {
    return false;
  }

  void handler()
    .then((result) => sendResponse({ ok: true, result }))
    .catch((error) => sendResponse({ ok: false, error: error.message }));

  return true;
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === FOCUS_ALARM_NAME) {
    void completeFocusSession();
    return;
  }

  if (!alarm.name.startsWith(REMINDER_ALARM_PREFIX)) {
    return;
  }

  void handleReminderAlarm(alarm.name);
});

chrome.notifications.onClicked.addListener((notificationId) => {
  if (!notificationId.startsWith("notification_")) {
    return;
  }

  void (async () => {
    await clearReminderAttention();
    await extensionStorage.set({
      ui: {
        lastPage: "reminders"
      }
    });
    await openDashboardSurface();
  })();
});

// --- Screen time tracking ---

chrome.tabs.onActivated.addListener(({ tabId, windowId }) => {
  void handleTabActivated(tabId, windowId);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === "complete" && tab.active) {
    void handleTabUpdated(tabId, tab);
  }
});

chrome.windows.onFocusChanged.addListener((windowId) => {
  void handleWindowFocusChanged(windowId);
});

chrome.idle.onStateChanged.addListener((newState) => {
  void handleIdleStateChanged(newState);
});

async function initializeExtension() {
  chrome.idle.setDetectionInterval(120);
  await seedCoreState();
  await syncReminderAlarms();
  await reconcileFocusAlarm();
  await pruneOldScreenTimeEntries();
  await configureSidePanel();
  await refreshReminderBadge();
}

async function seedCoreState() {
  const current = await extensionStorage.getAll();
  const defaults = createDefaultState();
  const updates = {};

  Object.entries(defaults).forEach(([key, value]) => {
    if (current[key] === undefined) {
      updates[key] = value;
    }
  });

  if (current.focus !== undefined) {
    const normalizedFocus = normalizeFocusState(current.focus);
    if (JSON.stringify(normalizedFocus) !== JSON.stringify(current.focus)) {
      updates.focus = normalizedFocus;
    }
  }

  const normalizedSettings = normalizeSettings(current.settings);
  if (JSON.stringify(normalizedSettings) !== JSON.stringify(current.settings)) {
    updates.settings = normalizedSettings;
  }

  const normalizedReminders = normalizeReminders(current.reminders);
  if (JSON.stringify(normalizedReminders) !== JSON.stringify(current.reminders)) {
    updates.reminders = normalizedReminders;
  }

  const normalizedSoundState = normalizeSoundState(current.soundState);
  if (JSON.stringify(normalizedSoundState) !== JSON.stringify(current.soundState)) {
    updates.soundState = normalizedSoundState;
  }

  if (Object.keys(updates).length > 0) {
    await extensionStorage.set(updates);
  }
}

async function handleSettingsChanged(_previous, _next) {
  // Sound is now independent from focus — no audio toggling needed here.
  // This hook remains available for future settings-driven side effects.
}

async function syncReminderAlarms() {
  const storedReminders = await extensionStorage.get("reminders", DEFAULT_REMINDERS);
  const reminders = normalizeReminders(storedReminders);
  const alarms = await chrome.alarms.getAll();

  if (JSON.stringify(reminders) !== JSON.stringify(storedReminders)) {
    await extensionStorage.set({ reminders });
  }

  await Promise.all(
    alarms
      .filter((alarm) => alarm.name.startsWith(REMINDER_ALARM_PREFIX))
      .map((alarm) => chrome.alarms.clear(alarm.name))
  );

  await Promise.all(
    reminders
      .filter((reminder) => reminder.enabled)
      .map((reminder) =>
        chrome.alarms.create(buildReminderAlarmName(reminder.id), {
          delayInMinutes: reminder.interval,
          periodInMinutes: reminder.interval
        })
      )
  );
}

async function startFocusSession(payload) {
  const current = await getFocusState();
  const durationMs = clampDuration(payload.durationMs ?? current.durationMs);
  const startedAt = Date.now();
  const focus = {
    ...current,
    status: "running",
    durationMs,
    startedAt,
    endTime: startedAt + durationMs,
    remainingMs: durationMs,
    completedAt: null,
    intention: sanitizeIntention(payload.intention ?? current.intention),
    blockedSites: normalizeBlockedSites(payload.blockedSites ?? current.blockedSites)
  };

  await chrome.alarms.clear(FOCUS_ALARM_NAME);
  await chrome.alarms.create(FOCUS_ALARM_NAME, {
    when: focus.endTime
  });
  await extensionStorage.set({ focus });
  await broadcastFocusState(focus);
  return focus;
}

async function pauseFocusSession() {
  const current = await getFocusState();

  if (current.status !== "running" || !current.endTime) {
    return current;
  }

  const remainingMs = Math.max(0, current.endTime - Date.now());
  const focus = {
    ...current,
    status: "paused",
    startedAt: null,
    endTime: null,
    remainingMs
  };

  await chrome.alarms.clear(FOCUS_ALARM_NAME);
  await extensionStorage.set({ focus });
  await broadcastFocusState(focus);
  return focus;
}

async function resumeFocusSession() {
  const current = await getFocusState();

  if (current.status !== "paused") {
    return current;
  }

  const remainingMs = Math.max(1000, current.remainingMs ?? current.durationMs);
  const startedAt = Date.now();
  const focus = {
    ...current,
    status: "running",
    startedAt,
    endTime: startedAt + remainingMs,
    remainingMs,
    completedAt: null
  };

  await chrome.alarms.clear(FOCUS_ALARM_NAME);
  await chrome.alarms.create(FOCUS_ALARM_NAME, {
    when: focus.endTime
  });
  await extensionStorage.set({ focus });
  await broadcastFocusState(focus);
  return focus;
}

async function resetFocusSession(payload = {}) {
  const current = await getFocusState();
  const focus = {
    ...current,
    status: "idle",
    durationMs: clampDuration(payload.durationMs ?? current.durationMs),
    startedAt: null,
    endTime: null,
    remainingMs: null,
    completedAt: null
  };

  await chrome.alarms.clear(FOCUS_ALARM_NAME);
  await extensionStorage.set({ focus });
  await broadcastFocusState(focus);
  return focus;
}

async function updateFocusOptions(payload) {
  const current = await getFocusState();
  const focus = {
    ...current,
    intention: sanitizeIntention(payload.intention ?? current.intention),
    blockedSites: normalizeBlockedSites(payload.blockedSites ?? current.blockedSites)
  };

  if (current.status === "idle" || current.status === "completed") {
    focus.durationMs = clampDuration(payload.durationMs ?? current.durationMs);
    focus.remainingMs = null;
  }

  await extensionStorage.set({ focus });
  await broadcastFocusState(focus);
  return focus;
}

async function reconcileFocusAlarm() {
  const focus = await getFocusState();

  if (focus.status !== "running") {
    await chrome.alarms.clear(FOCUS_ALARM_NAME);
    return;
  }

  if (!focus.endTime || Date.now() >= focus.endTime) {
    await completeFocusSession(focus);
    return;
  }

  await chrome.alarms.clear(FOCUS_ALARM_NAME);
  await chrome.alarms.create(FOCUS_ALARM_NAME, {
    when: focus.endTime
  });
}

async function completeFocusSession(explicitFocus) {
  const current = explicitFocus ?? (await getFocusState());

  if (current.status !== "running") {
    return current;
  }

  const completedAt = Date.now();
  const focus = {
    ...current,
    status: "completed",
    startedAt: null,
    endTime: null,
    remainingMs: 0,
    completedAt
  };
  const history = await extensionStorage.get("focusHistory", []);
  const soundState = normalizeSoundState(
    await extensionStorage.get("soundState", DEFAULT_SOUND_STATE)
  );
  const entry = {
    id: `focus_${completedAt}`,
    date: new Date(completedAt).toISOString(),
    durationMs: current.durationMs,
    intention: current.intention,
    soundType: soundState.playing ? soundState.type : null,
    soundPreset: null,
    completed: true
  };
  const settings = normalizeSettings(
    await extensionStorage.get("settings", DEFAULT_SETTINGS)
  );

  await chrome.alarms.clear(FOCUS_ALARM_NAME);
  await extensionStorage.set({
    focus,
    focusHistory: [entry, ...history].slice(0, 18)
  });
  await chrome.notifications.create(`focus_complete_${completedAt}`, {
    type: "basic",
    iconUrl: chrome.runtime.getURL("assets/icons/icon-128.png"),
    title: "Focus session complete",
    message: settings.quotesEnabled
      ? `${current.intention}. ${getRandomQuote()}`
      : `${current.intention} finished.`,
    priority: 2
  });

  if (settings.fadeOutEnabled && soundState.playing) {
    await handleStopNoise({ fadeOutMs: 5000 });
  }

  await broadcastFocusState(focus);
  return focus;
}

async function handleReminderAlarm(alarmName) {
  const reminders = await extensionStorage.get("reminders", DEFAULT_REMINDERS);
  const reminder = reminders.find(
    (entry) => buildReminderAlarmName(entry.id) === alarmName && entry.enabled
  );

  if (!reminder) {
    return;
  }

  // If user is idle, queue instead of firing immediately
  const idleState = await chrome.idle.queryState(120);
  if (idleState !== "active") {
    const queue = await extensionStorage.get("queuedReminders", []);
    queue.push({ id: reminder.id, name: reminder.name, timestamp: Date.now() });
    await extensionStorage.set({ queuedReminders: queue.slice(-20) });
    await markReminderAttention(reminder.name);
    return;
  }

  const settings = normalizeSettings(
    await extensionStorage.get("settings", DEFAULT_SETTINGS)
  );
  const message = settings.quotesEnabled
    ? `${reminder.name}. ${getRandomQuote()}`
    : reminder.name;

  await chrome.notifications.create(`notification_${reminder.id}`, {
    type: "basic",
    iconUrl: chrome.runtime.getURL("assets/icons/icon-128.png"),
    title: "RemindMeThat",
    message,
    priority: 2
  });
  await playReminderChime();
  await markReminderAttention(reminder.name);
}

async function getFocusState() {
  const focus = await extensionStorage.get("focus", DEFAULT_FOCUS);
  return normalizeFocusState(focus);
}

// --- Sound (independent from focus) ---

async function handlePlayNoise(payload) {
  await ensureOffscreenDocument();
  const nextSoundState = normalizeSoundState({
    playing: true,
    paused: false,
    type: payload.noiseType ?? null,
    volume: payload.masterVolume ?? 0.65
  });
  await chrome.runtime.sendMessage({
    type: "_OFFSCREEN_PLAY_NOISE",
    payload: {
      ...payload,
      masterVolume: nextSoundState.volume
    }
  });
  await extensionStorage.set({
    soundState: nextSoundState
  });
}

async function handleStopNoise(payload) {
  if (await hasOffscreenDocument()) {
    await chrome.runtime.sendMessage({
      type: "_OFFSCREEN_STOP_NOISE",
      payload
    });
  }
  const currentState = normalizeSoundState(
    await extensionStorage.get("soundState", DEFAULT_SOUND_STATE)
  );
  await extensionStorage.set({
    soundState: { ...currentState, playing: false, paused: false, type: null }
  });
}

async function handlePauseNoise() {
  const currentState = normalizeSoundState(
    await extensionStorage.get("soundState", DEFAULT_SOUND_STATE)
  );
  if (!currentState.playing || currentState.paused) return;

  if (await hasOffscreenDocument()) {
    await chrome.runtime.sendMessage({ type: "_OFFSCREEN_PAUSE_NOISE" });
  }
  await extensionStorage.set({
    soundState: { ...currentState, paused: true }
  });
}

async function handleResumeNoise() {
  const currentState = normalizeSoundState(
    await extensionStorage.get("soundState", DEFAULT_SOUND_STATE)
  );
  if (!currentState.playing || !currentState.paused) return;

  if (await hasOffscreenDocument()) {
    await chrome.runtime.sendMessage({ type: "_OFFSCREEN_RESUME_NOISE" });
    await extensionStorage.set({
      soundState: { ...currentState, paused: false }
    });
  } else {
    // Offscreen doc was garbage-collected — rebuild from scratch
    await handlePlayNoise({
      noiseType: currentState.type,
      preset: "deep-focus",
      masterVolume: currentState.volume
    });
  }
}

async function handleSetVolume(payload) {
  const volume = Math.max(0, Math.min(1, Number(payload.volume) || 0.65));
  const currentState = normalizeSoundState(
    await extensionStorage.get("soundState", DEFAULT_SOUND_STATE)
  );
  if (currentState.playing && !currentState.paused && await hasOffscreenDocument()) {
    await chrome.runtime.sendMessage({
      type: "_OFFSCREEN_SET_VOLUME",
      payload: { volume }
    });
  }
  await extensionStorage.set({
    soundState: { ...currentState, volume }
  });
}

async function handleIdleStateChanged(newState) {
  const soundState = normalizeSoundState(
    await extensionStorage.get("soundState", DEFAULT_SOUND_STATE)
  );

  if (newState === "active") {
    if (soundState.playing && soundState.paused) {
      await handleResumeNoise();
    }
    await flushQueuedReminders();
  } else {
    // "idle" or "locked"
    if (soundState.playing && !soundState.paused) {
      await handlePauseNoise();
    }
  }
}

async function flushQueuedReminders() {
  const queue = await extensionStorage.get("queuedReminders", []);
  if (queue.length === 0) return;

  await extensionStorage.set({ queuedReminders: [] });

  const settings = normalizeSettings(
    await extensionStorage.get("settings", DEFAULT_SETTINGS)
  );

  if (queue.length === 1) {
    const item = queue[0];
    const message = settings.quotesEnabled
      ? `${item.name}. ${getRandomQuote()}`
      : item.name;
    await chrome.notifications.create(`notification_${item.id}_queued`, {
      type: "basic",
      iconUrl: chrome.runtime.getURL("assets/icons/icon-128.png"),
      title: "While you were away",
      message,
      priority: 1
    });
  } else {
    const names = [...new Set(queue.map((q) => q.name))];
    await chrome.notifications.create(`notification_queued_batch_${Date.now()}`, {
      type: "basic",
      iconUrl: chrome.runtime.getURL("assets/icons/icon-128.png"),
      title: `While you were away (${queue.length} reminders)`,
      message: names.join(", "),
      priority: 1
    });
  }

  await playReminderChime();
}

async function markReminderAttention(reminderName) {
  const current = await extensionStorage.get(
    "reminderAttention",
    DEFAULT_REMINDER_ATTENTION
  );
  const next = {
    pendingCount: Math.min(99, Math.max(0, Number(current.pendingCount) || 0) + 1),
    lastReminderName: reminderName ?? null
  };
  await extensionStorage.set({ reminderAttention: next });
  await refreshReminderBadge(next);
}

async function clearReminderAttention() {
  await extensionStorage.set({ reminderAttention: DEFAULT_REMINDER_ATTENTION });
  await refreshReminderBadge(DEFAULT_REMINDER_ATTENTION);
}

async function refreshReminderBadge(attention = null) {
  const current = attention ?? await extensionStorage.get(
    "reminderAttention",
    DEFAULT_REMINDER_ATTENTION
  );
  const count = Math.max(0, Number(current.pendingCount) || 0);
  await chrome.action.setBadgeBackgroundColor({ color: "#D85A30" });
  await chrome.action.setBadgeText({ text: count > 0 ? "•" : "" });
  await chrome.action.setTitle({
    title:
      count > 0
        ? `RemindMeThat (${Math.min(99, count)} pending reminder${count === 1 ? "" : "s"})`
        : "RemindMeThat"
  });
}

async function playReminderChime() {
  await ensureOffscreenDocument();
  await chrome.runtime.sendMessage({ type: "_OFFSCREEN_REMINDER_CHIME" });
}

async function ensureOffscreenDocument() {
  if (await hasOffscreenDocument()) {
    return;
  }

  try {
    await chrome.offscreen.createDocument({
      url: OFFSCREEN_DOCUMENT_PATH,
      reasons: ["AUDIO_PLAYBACK"],
      justification: "Play ambient focus audio while the popup is closed."
    });
  } catch (error) {
    const message = String(error?.message ?? error);
    if (!message.includes("single offscreen document")) {
      throw error;
    }
  }
}

async function hasOffscreenDocument() {
  if (typeof chrome.runtime.getContexts !== "function") {
    return false;
  }

  const contexts = await chrome.runtime.getContexts({
    contextTypes: ["OFFSCREEN_DOCUMENT"],
    documentUrls: [chrome.runtime.getURL(OFFSCREEN_DOCUMENT_PATH)]
  });

  return contexts.length > 0;
}

async function broadcastFocusState(focus) {
  const tabs = await chrome.tabs.query({});

  await Promise.all(
    tabs.map(async (tab) => {
      if (!tab.id || !tab.url?.startsWith("http")) {
        return;
      }

      try {
        await chrome.tabs.sendMessage(tab.id, {
          type: "FOCUS_STATE_UPDATED",
          payload: focus
        });
      } catch (_error) {
        // Ignore tabs without an attached content script context.
      }
    })
  );
}

async function configureSidePanel() {
  if (!chrome.sidePanel?.setOptions) {
    return;
  }

  try {
    await chrome.sidePanel.setOptions({
      path: "sidepanel/sidepanel.html",
      enabled: true
    });
  } catch (_error) {
    // Ignore browsers without full side panel support.
  }

  if (chrome.sidePanel?.setPanelBehavior) {
    try {
      await chrome.sidePanel.setPanelBehavior({
        openPanelOnActionClick: false
      });
    } catch (_error) {
      // Ignore unsupported behavior configuration.
    }
  }
}

function buildReminderAlarmName(reminderId) {
  return `${REMINDER_ALARM_PREFIX}${reminderId}`;
}

function clampDuration(durationMs) {
  const fallback = DEFAULT_FOCUS.durationMs;
  const nextValue = Number(durationMs);

  if (!Number.isFinite(nextValue) || nextValue < 60_000) {
    return fallback;
  }

  return Math.min(nextValue, 4 * 60 * 60 * 1000);
}

function sanitizeIntention(value) {
  const trimmed = String(value ?? DEFAULT_FOCUS.intention).trim();
  return trimmed || DEFAULT_FOCUS.intention;
}

function normalizeBlockedSites(sites) {
  if (!Array.isArray(sites)) {
    return structuredClone(DEFAULT_FOCUS.blockedSites);
  }

  const normalized = sites
    .map((site) => String(site).trim().toLowerCase())
    .map((site) => site.replace(/^https?:\/\//, ""))
    .map((site) => site.replace(/\/.*$/, ""))
    .filter(Boolean);

  return [...new Set(normalized)].slice(0, 20);
}

// --- Side panel ---

async function openSidePanel({ tabId, windowId }) {
  await configureSidePanel();

  try {
    const [activeTab] = await chrome.tabs.query({
      active: true,
      currentWindow: true
    });
    const resolvedTabId = tabId ?? activeTab?.id ?? null;
    const resolvedWindowId = windowId ?? activeTab?.windowId ?? null;

    if (resolvedTabId) {
      await chrome.sidePanel.setOptions({
        tabId: resolvedTabId,
        path: "sidepanel/sidepanel.html",
        enabled: true
      });
      await chrome.sidePanel.open({ tabId: resolvedTabId });
      return { opened: "tab", tabId: resolvedTabId };
    }

    if (resolvedWindowId) {
      await chrome.sidePanel.open({ windowId: resolvedWindowId });
      return { opened: "window", windowId: resolvedWindowId };
    }

    throw new Error("Unable to resolve an active tab or window for the side panel.");
  } catch (error) {
    const message = String(error?.message ?? error);
    if (message.includes("sidePanel")) {
      throw new Error("Side panel API not available in this browser version.");
    }
    throw error;
  }
}

async function openPopupSurface() {
  if (chrome.action?.openPopup) {
    try {
      await chrome.action.openPopup();
      return { opened: "popup" };
    } catch (_error) {
      // Fall through to a stable extension page fallback.
    }
  }

  const url = chrome.runtime.getURL("popup/popup.html");
  await chrome.tabs.create({ url });
  return { opened: "tab", url };
}

async function openDashboardSurface() {
  const url = chrome.runtime.getURL("popup/popup.html?surface=dashboard");
  await chrome.tabs.create({ url });
  return { opened: "tab", url };
}

// --- Screen time tracking ---

const SCREENTIME_KEY_PREFIX = "screentime_";
const MIN_TRACKABLE_MS = 1000;
const RETENTION_DAYS = 90;
const SKIPPED_DOMAINS = new Set(["localhost", "127.0.0.1", "0.0.0.0"]);

async function handleTabActivated(tabId, windowId) {
  try {
    const tab = await chrome.tabs.get(tabId);
    const domain = extractDomain(tab.url);
    await handleTabTransition(domain, tabId, windowId);
  } catch (_error) {
    // Tab may have been closed between event fire and handler execution.
  }
}

async function handleTabUpdated(tabId, tab) {
  const domain = extractDomain(tab.url);
  await handleTabTransition(domain, tabId, tab.windowId);
}

async function handleWindowFocusChanged(windowId) {
  if (windowId === chrome.windows.WINDOW_ID_NONE) {
    await handleTabTransition(null, null, null);
    return;
  }

  try {
    const tabs = await chrome.tabs.query({ active: true, windowId });
    const tab = tabs[0];

    if (tab) {
      await handleTabTransition(extractDomain(tab.url), tab.id, windowId);
    } else {
      await handleTabTransition(null, null, null);
    }
  } catch (_error) {
    await handleTabTransition(null, null, null);
  }
}

async function handleTabTransition(newDomain, newTabId, newWindowId) {
  const session = await getActiveSession();

  if (session && session.tabId === newTabId && session.domain === newDomain) {
    return;
  }

  if (session) {
    const elapsed = Date.now() - session.startedAt;

    if (elapsed > MIN_TRACKABLE_MS) {
      await addToScreenTime(session.domain, elapsed);
    }
  }

  if (newDomain && !isSkippedDomain(newDomain)) {
    await setActiveSession({
      domain: newDomain,
      startedAt: Date.now(),
      tabId: newTabId,
      windowId: newWindowId
    });
  } else {
    await clearActiveSession();
  }
}

// Read-modify-write without locking. Under rapid tab switching two
// listeners could interleave and lose a few ms of time. Acceptable
// for a wellness dashboard, not a billing system.
async function addToScreenTime(domain, elapsedMs) {
  const key = SCREENTIME_KEY_PREFIX + todayDateKey();
  const entry = await extensionStorage.get(key, { total: 0, sites: {} });

  entry.total += elapsedMs;

  if (entry.sites[domain]) {
    entry.sites[domain].time += elapsedMs;
  } else {
    entry.sites[domain] = {
      time: elapsedMs,
      category: categorizeDomain(domain)
    };
  }

  await extensionStorage.set({ [key]: entry });
}

async function pruneOldScreenTimeEntries() {
  const all = await chrome.storage.local.get(null);
  const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;

  const keysToRemove = Object.keys(all)
    .filter((key) => key.startsWith(SCREENTIME_KEY_PREFIX))
    .filter((key) => {
      const dateStr = key.slice(SCREENTIME_KEY_PREFIX.length);
      const timestamp = new Date(dateStr).getTime();
      return Number.isFinite(timestamp) && timestamp < cutoff;
    });

  if (keysToRemove.length > 0) {
    await chrome.storage.local.remove(keysToRemove);
  }
}

async function getActiveSession() {
  const result = await chrome.storage.session.get("activeSession");
  return result.activeSession ?? null;
}

async function setActiveSession(session) {
  await chrome.storage.session.set({ activeSession: session });
}

async function clearActiveSession() {
  await chrome.storage.session.remove("activeSession");
}

function extractDomain(url) {
  if (!url?.startsWith("http")) {
    return null;
  }

  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

function isSkippedDomain(domain) {
  if (!domain || !domain.includes(".")) {
    return true;
  }

  return SKIPPED_DOMAINS.has(domain);
}

// Intentionally duplicates formatIsoDate() from popup.js because the service
// worker cannot import popup modules.
function todayDateKey() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
