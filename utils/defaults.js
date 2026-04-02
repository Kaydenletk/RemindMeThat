export const DEFAULT_SETTINGS = {
  quotesEnabled: true,
  moodPromptEnabled: true,
  fadeOutEnabled: false,
  theme: "system",
  language: "auto"
};

export const DEFAULT_SOUND_STATE = {
  playing: false,
  paused: false,
  type: null,
  volume: 0.65
};

export const DEFAULT_REMINDERS = [
  {
    id: "water",
    name: "Drink water",
    interval: 1,
    enabled: true,
    type: "wellness",
    icon: "drop"
  },
  {
    id: "breathe",
    name: "Breathing reset",
    interval: 45,
    enabled: true,
    type: "wellness",
    icon: "wind"
  },
  {
    id: "stretch",
    name: "Stand and stretch",
    interval: 60,
    enabled: true,
    type: "wellness",
    icon: "spark"
  },
  {
    id: "eyes",
    name: "Eye rest 20-20-20",
    interval: 20,
    enabled: false,
    type: "wellness",
    icon: "eye"
  }
];

export const FOCUS_DURATION_PRESETS = [15, 25, 45, 60];

export const SOUND_OPTIONS = [
  { id: "white",     label: "White",  icon: "white-noise" },
  { id: "pink",      label: "Pink",   icon: "pink-noise" },
  { id: "brown",     label: "Brown",  icon: "brown-noise" },
  { id: "dark",      label: "Dark",   icon: "dark-noise" },
  { id: "rain",      label: "Rain",   icon: "rain" },
  { id: "forest",    label: "Forest", icon: "forest" },
  { id: "cafe",      label: "Cafe",   icon: "cafe" },
  { id: "ocean",     label: "Ocean",  icon: "ocean" },
];

export const FOCUS_AUDIO_PRESETS = {
  "deep-focus": {
    label: "Deep Focus",
    description: "Tighter highs with a steadier low end.",
    gains: {
      bass: 0.42,
      mids: 0.34,
      highs: 0.24
    }
  },
  calm: {
    label: "Calm",
    description: "Gentle, rounded response for low-pressure sessions.",
    gains: {
      bass: 0.38,
      mids: 0.34,
      highs: 0.28
    }
  },
  energize: {
    label: "Energize",
    description: "More presence in the mids and highs.",
    gains: {
      bass: 0.28,
      mids: 0.38,
      highs: 0.34
    }
  }
};

export const DEFAULT_FOCUS = {
  status: "idle",
  durationMs: 25 * 60 * 1000,
  startedAt: null,
  endTime: null,
  remainingMs: null,
  completedAt: null,
  intention: "Deep work",
  blockedSites: [
    "facebook.com",
    "twitter.com",
    "reddit.com",
    "instagram.com",
    "tiktok.com"
  ]
};

export const DEFAULT_TRACKER_STATS = {
  totalBlocked: 0,
  byType: {
    facebook_pixel: 0,
    google_analytics: 0,
    tiktok_pixel: 0,
    other: 0
  }
};

export const DEFAULT_UI = {
  lastPage: "home"
};

export const DEFAULT_QUICK_NOTES = [];

export const DEFAULT_VAULT = [];

export function normalizeFocusState(value = {}) {
  const defaults = structuredClone(DEFAULT_FOCUS);

  if (value.status) {
    return {
      ...defaults,
      ...value
    };
  }

  const durationMs = value.durationMs ?? (value.duration ? value.duration * 60 * 1000 : defaults.durationMs);
  const status = value.active ? "running" : "idle";

  return {
    ...defaults,
    ...value,
    status,
    durationMs,
    remainingMs: value.remainingMs ?? null,
    intention: value.intention ?? defaults.intention
  };
}

export function createDefaultState() {
  return {
    settings: structuredClone(DEFAULT_SETTINGS),
    reminders: structuredClone(DEFAULT_REMINDERS),
    quickNotes: structuredClone(DEFAULT_QUICK_NOTES),
    journal: [],
    vault: structuredClone(DEFAULT_VAULT),
    focus: structuredClone(DEFAULT_FOCUS),
    focusHistory: [],
    trackerStats: structuredClone(DEFAULT_TRACKER_STATS),
    ui: structuredClone(DEFAULT_UI),
    soundState: structuredClone(DEFAULT_SOUND_STATE)
  };
}

export function normalizeSettings(value = {}) {
  return {
    ...structuredClone(DEFAULT_SETTINGS),
    ...value
  };
}

export function normalizeSoundState(value = {}) {
  const defaults = structuredClone(DEFAULT_SOUND_STATE);
  const volume = Number(value.volume);

  return {
    ...defaults,
    ...value,
    playing: value.playing === true,
    type: typeof value.type === "string" && value.type.length > 0 ? value.type : null,
    volume: Number.isFinite(volume) ? Math.max(0, Math.min(1, volume)) : defaults.volume
  };
}

export function normalizeReminders(value) {
  if (!Array.isArray(value) || value.length === 0) {
    return structuredClone(DEFAULT_REMINDERS);
  }

  return value.map((reminder, index) => ({
    id: reminder.id ?? `reminder_${index + 1}`,
    name: reminder.name ?? `Reminder ${index + 1}`,
    interval: Number.isFinite(Number(reminder.interval)) && Number(reminder.interval) > 0
      ? Number(reminder.interval)
      : 30,
    enabled: reminder.enabled !== false,
    type: reminder.type ?? "wellness",
    icon: reminder.icon ?? "spark"
  }));
}

export function normalizeQuickNotes(value) {
  if (!Array.isArray(value)) {
    return structuredClone(DEFAULT_QUICK_NOTES);
  }

  return value
    .map((note, index) => ({
      id: note.id ?? `n_${index + 1}`,
      createdAt: Number(note.createdAt) || Date.now(),
      updatedAt: Number(note.updatedAt) || Number(note.createdAt) || Date.now(),
      text: String(note.text ?? "").trim(),
      archived: note.archived === true,
      pinned: note.pinned === true
    }))
    .filter((note) => note.text.length > 0);
}

export function normalizeVault(value) {
  if (!Array.isArray(value)) {
    return structuredClone(DEFAULT_VAULT);
  }

  return value
    .map((entry, index) => ({
      id: entry.id ?? `v_${index + 1}`,
      sourceType: entry.sourceType === "journal" ? "journal" : "quickNote",
      sourceId: String(entry.sourceId ?? ""),
      createdAt: Number(entry.createdAt) || Date.now(),
      text: String(entry.text ?? "").trim(),
      tag: entry.tag == null ? null : String(entry.tag)
    }))
    .filter((entry) => entry.sourceId && entry.text.length > 0);
}
