import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();

const files = {
  popupHtml: read("popup/popup.html"),
  popupJs: read("popup/popup.js"),
  popupCss: read("popup/popup.css"),
  sidepanelHtml: read("sidepanel/sidepanel.html"),
  sidepanelJs: read("sidepanel/sidepanel.js"),
  sidepanelCss: read("sidepanel/sidepanel.css"),
  defaults: read("utils/defaults.js"),
  serviceWorker: read("background/service-worker.js"),
  offscreen: read("offscreen/offscreen.js")
};

const checks = [];

function read(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), "utf8");
}

function exists(relPath) {
  return fs.existsSync(path.join(ROOT, relPath));
}

function extractIds(html) {
  return new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]));
}

function extractJsIds(source) {
  return [...source.matchAll(/getElementById\("([^"]+)"\)/g)].map((match) => match[1]);
}

function ok(condition, label, details = "") {
  checks.push({ pass: Boolean(condition), label, details });
}

function sectionBlock(source, anchor) {
  const index = source.indexOf(anchor);
  return index >= 0 ? source.slice(index, index + 1200) : "";
}

function expectPattern(source, pattern, label) {
  ok(pattern.test(source), label, `Expected pattern: ${pattern}`);
}

function expectNoPattern(source, pattern, label) {
  ok(!pattern.test(source), label, `Unexpected pattern: ${pattern}`);
}

const popupIds = extractIds(files.popupHtml);
const sidepanelIds = extractIds(files.sidepanelHtml);
const popupJsIds = extractJsIds(files.popupJs);
const sidepanelJsIds = extractJsIds(files.sidepanelJs);

const allowedPopupMissing = new Set(["featured-quote"]);
const missingPopupIds = popupJsIds.filter((id) => !popupIds.has(id) && !allowedPopupMissing.has(id));
const missingSidepanelIds = sidepanelJsIds.filter((id) => !sidepanelIds.has(id));

ok(missingPopupIds.length === 0, "Popup JS selectors resolve to popup HTML ids", missingPopupIds.join(", "));
ok(missingSidepanelIds.length === 0, "Sidepanel JS selectors resolve to sidepanel HTML ids", missingSidepanelIds.join(", "));

expectPattern(files.defaults, /fadeOutEnabled:\s*false/, "Fade-out default is OFF");
expectPattern(files.defaults, /quickNotes:\s*structuredClone\(DEFAULT_QUICK_NOTES\)/, "Default state includes quick notes");
expectPattern(files.defaults, /vault:\s*structuredClone\(DEFAULT_VAULT\)/, "Default state includes vault");
expectNoPattern(sectionBlock(files.defaults, "export const DEFAULT_FOCUS"), /soundType|soundPreset|masterVolume/, "Focus defaults do not include sound fields");

expectNoPattern(sectionBlock(files.popupJs, 'type: "FOCUS_START"'), /soundType|soundPreset|masterVolume/, "Popup focus start payload is decoupled from sound");
expectNoPattern(sectionBlock(files.sidepanelJs, 'type: "FOCUS_START"'), /soundType|soundPreset|masterVolume/, "Sidepanel focus start payload is decoupled from sound");
expectNoPattern(sectionBlock(files.serviceWorker, "async function startFocusSession"), /soundType|soundPreset|masterVolume|handlePlayNoise|PLAY_NOISE/, "Service worker focus start does not auto-play sound");

expectPattern(files.serviceWorker, /if\s*\(settings\.fadeOutEnabled\s*&&\s*soundState\.playing\)\s*\{\s*await handleStopNoise\(\{ fadeOutMs: 5000 \}\);/s, "Timer completion only fades sound when fade toggle is enabled");
expectPattern(files.popupJs, /type:\s*"SET_VOLUME"[\s\S]*payload:\s*\{\s*volume:\s*vol\s*\}/, "Popup volume slider sends SET_VOLUME");
expectPattern(files.sidepanelJs, /type:\s*"SET_VOLUME"[\s\S]*payload:\s*\{\s*volume:\s*vol\s*\}/, "Sidepanel volume slider sends SET_VOLUME");
expectPattern(files.serviceWorker, /soundState:\s*nextSoundState/, "Service worker persists soundState on PLAY_NOISE");
expectPattern(files.serviceWorker, /soundState:\s*\{\s*\.\.\.currentState,\s*playing:\s*false,\s*paused:\s*false,\s*type:\s*null\s*\}/s, "Service worker persists soundState on STOP_NOISE");
expectPattern(files.serviceWorker, /soundState:\s*\{\s*\.\.\.currentState,\s*volume\s*\}/s, "Service worker persists soundState on SET_VOLUME");
expectPattern(files.serviceWorker, /CLEAR_REMINDER_ATTENTION/, "Service worker exposes clear reminder attention message");
expectPattern(files.serviceWorker, /action\.setBadgeText/, "Service worker updates action badge for reminder attention");
expectPattern(files.serviceWorker, /_OFFSCREEN_REMINDER_CHIME/, "Service worker triggers reminder chime");

expectPattern(files.popupHtml, /id="nav-sound-toggle"/, "Popup nav includes sound toggle button");
expectPattern(files.popupHtml, /id="sound-panel"/, "Popup includes floating sound panel");
expectPattern(files.popupHtml, /id="quick-note-form"/, "Popup includes quick note capture form");
expectPattern(files.popupHtml, /data-page="vault"/, "Popup nav includes vault page");
expectPattern(files.popupHtml, /data-page-panel="vault"/, "Popup includes vault page panel");
expectPattern(files.sidepanelHtml, /id="sp-sound-toggle"/, "Sidepanel includes sound toggle button");
expectPattern(files.sidepanelHtml, /id="sp-sound-panel"/, "Sidepanel includes sound dropdown");

expectPattern(files.popupHtml, /id="focus-sound-status"/, "Focus page includes read-only sound status bar");
expectPattern(files.popupJs, /function renderFocusSoundStatus\(/, "Popup renders focus sound status");
expectPattern(
  files.popupJs,
  /title\.textContent\s*=\s*(?:"Add ambience\?"|t\("addAmbience"\));/,
  "Focus sound status has silent-state copy"
);

expectPattern(files.popupHtml, /private-pill/, "Popup journal header includes private pill");
expectPattern(files.popupCss, /\.journal-form textarea\s*\{[^}]*font-family:\s*Georgia,\s*'Times New Roman',\s*serif;/s, "Journal textarea uses serif typography");
expectPattern(files.popupCss, /\.journal-form textarea::placeholder\s*\{[^}]*font-style:\s*italic;/s, "Journal placeholder is italic");

expectPattern(files.popupJs, /const SETTING_LABELS = \{[\s\S]*fadeOutEnabled:/, "Settings UI exposes fade-out toggle");
expectNoPattern(files.popupJs, /soundEnabled:/, "Settings UI no longer exposes dead soundEnabled toggle");
expectPattern(files.popupJs, /function handleQuickAction\(/, "Popup uses distinct quick tool actions");
expectPattern(files.popupJs, /needsAttention/, "Popup renders reminder attention state");
expectPattern(files.popupJs, /state\.quickNotes\s*=\s*normalizeQuickNotes/, "Popup hydrates quick notes from storage");
expectPattern(files.popupJs, /state\.vault\s*=\s*normalizeVault/, "Popup hydrates vault from storage");

expectPattern(files.offscreen, /rain:\s*"rain-base\.mp3"/, "Offscreen rain source points to packaged asset");
expectPattern(files.offscreen, /forest:\s*"forest-base\.mp3"/, "Offscreen forest source points to packaged asset");
expectPattern(files.offscreen, /dark:\s*"dark-base\.mp3"/, "Offscreen dark source points to packaged asset");
expectPattern(files.offscreen, /ocean:\s*"ocean-base\.mp3"/, "Offscreen ocean source points to packaged asset");
expectPattern(files.offscreen, /cafe:\s*"cafe-base\.mp3"/, "Offscreen cafe source points to packaged asset");
ok(exists("assets/sounds/rain-base.mp3"), "Packaged rain audio asset exists");
ok(exists("assets/sounds/forest-base.mp3"), "Packaged forest audio asset exists");
ok(exists("assets/sounds/dark-base.mp3"), "Packaged dark audio asset exists");
ok(exists("assets/sounds/ocean-base.mp3"), "Packaged ocean audio asset exists");
ok(exists("assets/sounds/cafe-base.mp3"), "Packaged cafe audio asset exists");

const failed = checks.filter((check) => !check.pass);
const passed = checks.length - failed.length;

console.log(`QA smoke suite: ${passed}/${checks.length} checks passed`);
for (const check of checks) {
  const prefix = check.pass ? "PASS" : "FAIL";
  const detail = check.details ? ` :: ${check.details}` : "";
  console.log(`${prefix} ${check.label}${detail}`);
}

if (failed.length > 0) {
  process.exitCode = 1;
}
