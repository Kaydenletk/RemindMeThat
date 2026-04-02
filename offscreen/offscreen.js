import { FOCUS_AUDIO_PRESETS } from "../utils/defaults.js";

let audioContext;
let engine = null;

// Cache decoded audio buffers so we only fetch/decode once
const audioFileCache = {};

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "PLAY_NOISE" || message?.type === "_OFFSCREEN_PLAY_NOISE") {
    void playNoise(message.payload ?? {})
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === "STOP_NOISE" || message?.type === "_OFFSCREEN_STOP_NOISE") {
    void stopNoise(message.payload?.fadeOutMs ?? 0)
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === "PAUSE_NOISE" || message?.type === "_OFFSCREEN_PAUSE_NOISE") {
    void pauseNoise()
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === "RESUME_NOISE" || message?.type === "_OFFSCREEN_RESUME_NOISE") {
    void resumeNoise()
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === "SET_VOLUME" || message?.type === "_OFFSCREEN_SET_VOLUME") {
    void setVolume(message.payload?.volume ?? 0.65)
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === "_OFFSCREEN_REMINDER_CHIME") {
    void playReminderChime()
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  return false;
});

async function playNoise({
  noiseType = "pink",
  preset = "deep-focus",
  masterVolume = 0.35
}) {
  await ensureAudioContext();
  await destroyEngine(0);

  engine = await buildEngine(noiseType, preset, masterVolume);
}

async function stopNoise(fadeOutMs = 0) {
  await destroyEngine(fadeOutMs);
}

async function pauseNoise() {
  if (!audioContext || audioContext.state !== "running") return;
  await audioContext.suspend();
}

async function resumeNoise() {
  if (!audioContext || audioContext.state !== "suspended") return;
  await audioContext.resume();
}

async function setVolume(newVolume) {
  if (!engine || !engine.masterGain || !audioContext) return;
  const clamped = clampVolume(newVolume);
  const now = audioContext.currentTime;
  engine.masterGain.gain.cancelScheduledValues(now);
  engine.masterGain.gain.setValueAtTime(engine.masterGain.gain.value, now);
  engine.masterGain.gain.linearRampToValueAtTime(clamped, now + 0.05);
}

async function ensureAudioContext() {
  if (!audioContext) {
    audioContext = new AudioContext();
  }

  if (audioContext.state === "suspended") {
    await audioContext.resume();
  }
}

async function playReminderChime() {
  await ensureAudioContext();

  const now = audioContext.currentTime;
  const gain = audioContext.createGain();
  gain.gain.value = 0;
  gain.connect(audioContext.destination);

  const toneA = audioContext.createOscillator();
  toneA.type = "sine";
  toneA.frequency.value = 988;
  toneA.connect(gain);

  const toneB = audioContext.createOscillator();
  toneB.type = "sine";
  toneB.frequency.value = 1318;
  toneB.connect(gain);

  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(0.08, now + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.24);
  gain.gain.setValueAtTime(0, now + 0.32);
  gain.gain.linearRampToValueAtTime(0.07, now + 0.34);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.58);

  toneA.start(now);
  toneA.stop(now + 0.24);
  toneB.start(now + 0.32);
  toneB.stop(now + 0.58);

  window.setTimeout(() => {
    toneA.disconnect();
    toneB.disconnect();
    gain.disconnect();
  }, 900);
}

// ─── Audio file loading ───────────────────────────────────────────

const AUDIO_FILES = {
  rain: "rain-base.mp3",
  forest: "forest-base.mp3",
  dark: "dark-base.mp3",
  ocean: "ocean-base.mp3",
  cafe: "cafe-base.mp3"
};

const RECORDED_SOUND_LEVELS = {
  rain: 0.68,
  forest: 0.8,
  dark: 0.34,
  ocean: 0.42,
  cafe: 0.9
};

async function loadAudioFile(name) {
  if (audioFileCache[name]) {
    return audioFileCache[name];
  }

  const url = chrome.runtime.getURL(`assets/sounds/${AUDIO_FILES[name]}`);
  const response = await fetch(url);
  const arrayBuffer = await response.arrayBuffer();
  const decoded = await audioContext.decodeAudioData(arrayBuffer);
  audioFileCache[name] = decoded;
  return decoded;
}

// ─── Engine builder (router) ──────────────────────────────────────

async function buildEngine(noiseType, preset, masterVolume) {
  const masterGain = audioContext.createGain();
  masterGain.gain.value = clampVolume(masterVolume);
  masterGain.connect(audioContext.destination);

  // EQ chain
  const presetGains = FOCUS_AUDIO_PRESETS[preset]?.gains ?? FOCUS_AUDIO_PRESETS["deep-focus"].gains;
  const eq = createEQ(presetGains);
  eq.output.connect(masterGain);

  // Hybrid sounds (recorded base + procedural layers)
  if (noiseType === "rain") {
    return buildRainEngine(eq.input, masterGain, eq);
  }

  if (noiseType === "forest") {
    return buildForestEngine(eq.input, masterGain, eq);
  }

  if (noiseType === "dark") {
    return buildRecordedAmbienceEngine(
      "dark",
      eq.input,
      masterGain,
      eq,
      RECORDED_SOUND_LEVELS.dark
    );
  }

  if (noiseType === "ocean") {
    return buildRecordedAmbienceEngine(
      "ocean",
      eq.input,
      masterGain,
      eq,
      RECORDED_SOUND_LEVELS.ocean
    );
  }

  if (noiseType === "cafe") {
    return buildRecordedAmbienceEngine(
      "cafe",
      eq.input,
      masterGain,
      eq,
      RECORDED_SOUND_LEVELS.cafe
    );
  }

  // Buffer-based sounds (stereo, 10s)
  const source = audioContext.createBufferSource();
  source.buffer = createNoiseBuffer(noiseType, audioContext.sampleRate, 10);
  source.loop = true;
  source.connect(eq.input);
  source.start();

  return {
    source,
    masterGain,
    timers: [],
    nodes: [source, ...eq.nodes, masterGain]
  };
}

async function buildRecordedAmbienceEngine(name, eqInput, masterGain, eq, baseLevel = 0.85) {
  const buffer = await loadAudioFile(name);
  const source = audioContext.createBufferSource();
  source.buffer = buffer;
  source.loop = true;

  const baseGain = audioContext.createGain();
  baseGain.gain.value = baseLevel;

  source.connect(baseGain);
  baseGain.connect(eqInput);
  source.start();

  return {
    source,
    masterGain,
    timers: [],
    nodes: [source, baseGain, ...eq.nodes, masterGain]
  };
}

// ─── 3-band EQ ────────────────────────────────────────────────────

function createEQ(gains) {
  const bassFilter = audioContext.createBiquadFilter();
  bassFilter.type = "lowshelf";
  bassFilter.frequency.value = 200;

  const midFilter = audioContext.createBiquadFilter();
  midFilter.type = "peaking";
  midFilter.frequency.value = 1100;
  midFilter.Q.value = 0.9;

  const highFilter = audioContext.createBiquadFilter();
  highFilter.type = "highshelf";
  highFilter.frequency.value = 3600;

  const bassGain = audioContext.createGain();
  const midGain = audioContext.createGain();
  const highGain = audioContext.createGain();
  const mergeGain = audioContext.createGain();

  bassGain.gain.value = gains.bass;
  midGain.gain.value = gains.mids;
  highGain.gain.value = gains.highs;

  // Input splits to 3 bands, each band merges to output
  const splitter = audioContext.createGain(); // input node

  splitter.connect(bassFilter);
  splitter.connect(midFilter);
  splitter.connect(highFilter);

  bassFilter.connect(bassGain);
  midFilter.connect(midGain);
  highFilter.connect(highGain);

  bassGain.connect(mergeGain);
  midGain.connect(mergeGain);
  highGain.connect(mergeGain);

  return {
    input: splitter,
    output: mergeGain,
    nodes: [splitter, bassFilter, midFilter, highFilter, bassGain, midGain, highGain, mergeGain]
  };
}

// ─── Rain: recorded base + procedural drops ───────────────────────

async function buildRainEngine(eqInput, masterGain, eq) {
  const buffer = await loadAudioFile("rain");

  // Layer 1: Recorded rain base (looped)
  const baseSource = audioContext.createBufferSource();
  baseSource.buffer = buffer;
  baseSource.loop = true;
  const baseGain = audioContext.createGain();
  baseGain.gain.value = RECORDED_SOUND_LEVELS.rain;
  baseSource.connect(baseGain);
  baseGain.connect(eqInput);
  baseSource.start();

  // Layer 2: Procedural rain drops
  const dropGain = audioContext.createGain();
  dropGain.gain.value = 0.25;
  dropGain.connect(eqInput);

  const timers = [];

  function scheduleDrop() {
    if (!engine) return;

    const duration = 0.02 + Math.random() * 0.04; // 20-60ms
    const cutoff = 600 + Math.random() * 1400;     // 600-2000Hz

    const noiseSource = audioContext.createBufferSource();
    noiseSource.buffer = createTinyNoiseBuffer(duration);
    noiseSource.loop = false;

    const filter = audioContext.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = cutoff;
    filter.Q.value = 1.2;

    const envelope = audioContext.createGain();
    envelope.gain.value = 0;

    noiseSource.connect(filter);
    filter.connect(envelope);
    envelope.connect(dropGain);

    const now = audioContext.currentTime;
    envelope.gain.setValueAtTime(0, now);
    envelope.gain.linearRampToValueAtTime(0.3 + Math.random() * 0.5, now + 0.005);
    envelope.gain.exponentialRampToValueAtTime(0.001, now + duration);

    noiseSource.start(now);
    noiseSource.stop(now + duration + 0.01);

    // Schedule next drop at random interval
    const nextDelay = 80 + Math.random() * 170; // 80-250ms
    const timer = setTimeout(scheduleDrop, nextDelay);
    timers.push(timer);
  }

  // Layer 3: Close impacts (rare, louder)
  function scheduleImpact() {
    if (!engine) return;

    const duration = 0.01 + Math.random() * 0.02; // 10-30ms

    const noiseSource = audioContext.createBufferSource();
    noiseSource.buffer = createTinyNoiseBuffer(duration + 0.05);
    noiseSource.loop = false;

    const filter = audioContext.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 1500;

    // Tiny delay for surface-hit reverb
    const delay = audioContext.createDelay(0.2);
    delay.delayTime.value = 0.05 + Math.random() * 0.05; // 50-100ms
    const feedback = audioContext.createGain();
    feedback.gain.value = 0.2;

    const impactGain = audioContext.createGain();
    impactGain.gain.value = 0;

    noiseSource.connect(filter);
    filter.connect(impactGain);
    // Dry + wet (delayed) path
    filter.connect(delay);
    delay.connect(feedback);
    feedback.connect(delay);
    delay.connect(impactGain);

    impactGain.connect(dropGain);

    const now = audioContext.currentTime;
    impactGain.gain.setValueAtTime(0, now);
    impactGain.gain.linearRampToValueAtTime(0.6 + Math.random() * 0.3, now + 0.003);
    impactGain.gain.exponentialRampToValueAtTime(0.001, now + duration + 0.05);

    noiseSource.start(now);
    noiseSource.stop(now + duration + 0.15);

    // Next impact in 2-8 seconds
    const nextDelay = 2000 + Math.random() * 6000;
    const timer = setTimeout(scheduleImpact, nextDelay);
    timers.push(timer);
  }

  scheduleDrop();
  scheduleImpact();

  return {
    source: baseSource,
    masterGain,
    timers,
    nodes: [baseSource, baseGain, dropGain, ...eq.nodes, masterGain]
  };
}

// ─── Forest: recorded base only for a more natural ambience ───────

async function buildForestEngine(eqInput, masterGain, eq) {
  const buffer = await loadAudioFile("forest");

  // Recorded forest base only. The previous synthetic chirp layer made the
  // sound feel less believable than a good field recording on its own.
  const baseSource = audioContext.createBufferSource();
  baseSource.buffer = buffer;
  baseSource.loop = true;
  const baseGain = audioContext.createGain();
  baseGain.gain.value = RECORDED_SOUND_LEVELS.forest;
  baseSource.connect(baseGain);
  baseGain.connect(eqInput);
  baseSource.start();

  return {
    source: baseSource,
    masterGain,
    timers: [],
    nodes: [baseSource, baseGain, ...eq.nodes, masterGain]
  };
}

// ─── Noise buffer generators ──────────────────────────────────────

function createTinyNoiseBuffer(durationSeconds) {
  const frameCount = Math.ceil(audioContext.sampleRate * durationSeconds);
  const buffer = audioContext.createBuffer(1, frameCount, audioContext.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < frameCount; i++) {
    data[i] = Math.random() * 2 - 1;
  }
  return buffer;
}

function createNoiseBuffer(noiseType, sampleRate, durationSeconds) {
  const frameCount = sampleRate * durationSeconds;
  // Stereo buffer
  const buffer = audioContext.createBuffer(2, frameCount, sampleRate);
  const left = buffer.getChannelData(0);
  const right = buffer.getChannelData(1);

  const filler = NOISE_FILLERS[noiseType] ?? fillPinkNoise;

  // Fill each channel independently for stereo width
  filler(left, sampleRate);
  filler(right, sampleRate);

  return buffer;
}

const NOISE_FILLERS = {
  white: fillWhiteNoise,
  pink: fillPinkNoise,
  brown: fillBrownNoise,
  ocean: fillOceanNoise,
  fireplace: fillFireplaceNoise,
  cafe: fillCafeNoise
};

function fillWhiteNoise(data) {
  for (let i = 0; i < data.length; i++) {
    data[i] = (Math.random() * 2 - 1) * 0.22;
  }
}

function fillPinkNoise(data) {
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;

  for (let i = 0; i < data.length; i++) {
    const white = Math.random() * 2 - 1;
    b0 = 0.99886 * b0 + white * 0.0555179;
    b1 = 0.99332 * b1 + white * 0.0750759;
    b2 = 0.96900 * b2 + white * 0.1538520;
    b3 = 0.86650 * b3 + white * 0.3104856;
    b4 = 0.55000 * b4 + white * 0.5329522;
    b5 = -0.7616 * b5 - white * 0.0168980;
    data[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11;
    b6 = white * 0.115926;
  }
}

function fillBrownNoise(data) {
  let lastOut = 0;

  for (let i = 0; i < data.length; i++) {
    const white = Math.random() * 2 - 1;
    lastOut = (lastOut + 0.02 * white) / 1.02;
    data[i] = lastOut * 3.5;
  }
}

function fillOceanNoise(data, sampleRate) {
  let smooth = 0;

  for (let i = 0; i < data.length; i++) {
    const white = Math.random() * 2 - 1;
    smooth = smooth * 0.985 + white * 0.015;
    // Primary swell: ~8-12 second cycle
    const swell = 0.55 + 0.45 * Math.sin((i / sampleRate) * Math.PI * 0.18);
    // Secondary faster texture
    const texture = 1 + 0.2 * Math.sin((i / sampleRate) * Math.PI * 0.8);
    data[i] = smooth * 0.42 * swell * texture;
  }
}

function fillFireplaceNoise(data) {
  let bed = 0;
  let crackle = 0;

  for (let i = 0; i < data.length; i++) {
    const white = Math.random() * 2 - 1;
    bed = (bed + 0.02 * white) / 1.02;
    crackle *= 0.92;

    // Random crackle bursts
    if (Math.random() < 0.003) {
      crackle += Math.random() * 0.9;
    }

    // Rare loud pops
    const pop = (Math.random() < 0.0001) ? Math.random() * 0.6 : 0;

    data[i] = bed * 0.22 + crackle * (Math.random() * 2 - 1) * 0.35 + pop;
  }
}

function fillCafeNoise(data, sampleRate) {
  let murmur = 0;
  let clink = 0;

  for (let i = 0; i < data.length; i++) {
    const white = Math.random() * 2 - 1;
    // Room tone hum
    const lowHum =
      Math.sin((i / sampleRate) * Math.PI * 2 * 110) * 0.008 +
      Math.sin((i / sampleRate) * Math.PI * 2 * 220) * 0.005;
    // Conversation murmur with slow ebb/flow
    const flow = 0.8 + 0.2 * Math.sin((i / sampleRate) * Math.PI * 0.4);
    murmur = murmur * 0.97 + white * 0.03;
    // Cup clinks
    clink *= 0.985;
    if (Math.random() < 0.0005) {
      clink += 0.5 + Math.random() * 0.4;
    }

    data[i] = murmur * 0.12 * flow + lowHum +
      clink * Math.sin((i / sampleRate) * Math.PI * 2 * 1800) * 0.08;
  }
}

// ─── Engine lifecycle ─────────────────────────────────────────────

async function destroyEngine(fadeOutMs) {
  if (!engine) {
    return;
  }

  const currentEngine = engine;
  engine = null;

  // Clear all scheduled timers (procedural layers)
  if (currentEngine.timers) {
    currentEngine.timers.forEach((t) => clearTimeout(t));
    currentEngine.timers.length = 0;
  }

  if (fadeOutMs > 0) {
    const now = audioContext.currentTime;
    currentEngine.masterGain.gain.cancelScheduledValues(now);
    currentEngine.masterGain.gain.setValueAtTime(
      currentEngine.masterGain.gain.value,
      now
    );
    currentEngine.masterGain.gain.linearRampToValueAtTime(
      0,
      now + fadeOutMs / 1000
    );
    await wait(fadeOutMs);
  }

  try {
    currentEngine.source.stop();
  } catch (_error) {
    // Ignore if already stopped.
  }

  currentEngine.nodes.forEach((node) => {
    try { node.disconnect(); } catch (_e) { /* already disconnected */ }
  });
}

function clampVolume(value) {
  const nextValue = Number(value);

  if (!Number.isFinite(nextValue)) {
    return 0.35;
  }

  return Math.max(0, Math.min(1, nextValue));
}

function wait(durationMs) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, durationMs);
  });
}
