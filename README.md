<p align="center">
  <img src="assets/icons/icon-128.png" width="80" height="80" alt="RemindMeThat icon" />
</p>

<h1 align="center">RemindMeThat</h1>

<p align="center">
  <strong>A mind-wellness and productivity companion for your browser.</strong><br/>
  Focus timer, ambient sounds, mood tracking, smart reminders, and screen time analytics — all in one calm dashboard.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Manifest-V3-blue" alt="Manifest V3" />
  <img src="https://img.shields.io/badge/License-MIT-green" alt="MIT License" />
  <img src="https://img.shields.io/badge/Chrome-Extension-4A9BD9" alt="Chrome Extension" />
</p>

---

## Why RemindMeThat?

Most productivity tools punish you with data. RemindMeThat is different — it's **wellness-first**. It greets you by time of day, reminds you to breathe and stretch, plays ambient rain sounds while you work, and tracks your mood over time. Think of it as a **calm companion** that sits in your browser, not a demanding productivity tracker.

**Open the extension. Start a focus session. That's it.**

---

## Features

### Focus Timer
Start a focus session directly from the dashboard — no navigation needed. Choose 15, 25, 45, or 60 minutes. The timer counts down while you work. When a session completes, your leaf garden grows.

### Ambient Soundscapes
8 procedurally generated sounds you can play anytime — not just during focus sessions. Rain and Forest use **real recorded audio** as a base layer with procedural drops and bird chirps layered on top for a sound that never repeats.

- White Noise, Pink Noise, Brown Noise, Dark Noise
- Rain (3-layer: recorded base + procedural drops + close impacts)
- Forest (recorded wind & birds)
- Cafe, Ocean

Sound auto-pauses when you lock your screen and resumes when you return.

### Smart Reminders
Gentle wellness nudges that respect your presence:

- **Drink water** — every 30 minutes
- **Breathing reset (4-7-8)** — every 45 minutes
- **Stand and stretch** — every 60 minutes
- **Eye rest (20-20-20)** — every 20 minutes

When you're away from your computer, reminders **queue silently** and show a single "While you were away" summary when you return. No notification spam to an empty room.

### Mood Check-in
One-tap daily mood logging with 4 states: Stressed, Okay, Good, Great. Builds a weekly mood chart over time with streak tracking and simple insights like "Your mood dips on Fridays."

### Private Journal
A serif-font notebook with a lock icon and "Private" badge — designed to feel like a personal space, not a form. Each entry auto-links to your mood that day.

### Screen Time Analytics
Automatic tracking of time spent on productive vs. social sites. Categorizes domains and shows daily/weekly trends with spark charts.

### Tracker Blocker
Built-in ad and tracker blocking using Chrome's declarativeNetRequest API. Blocks Facebook Pixel, Google Analytics, TikTok Pixel, and common trackers. Shows a running count of blocked requests.

### Site Blocking (Focus Mode)
During focus sessions, blocked sites show a full-page overlay: "You're in focus mode. X minutes remaining." Customizable block list.

### Side Panel
A companion panel that stays open while you browse — ideal for keeping the timer visible, checking reminders, or playing ambient sounds alongside your work.

---

## Design Philosophy

1. **Never punish on first contact.** Empty states invite action, not display zeros.
2. **Use human words.** "Ready to focus" not "Idle". "How's your day?" not "Not logged yet".
3. **One clear first action.** Open the extension = see the timer = one tap to start.
4. **Celebrate small wins.** Mood streaks, focus leaves, "Great session!" messages.
5. **Respect presence.** Sound pauses when you leave. Reminders queue. Data stays local.

---

## Tech Stack

- **Manifest V3** — Chrome Extension platform
- **Vanilla JS** — zero frameworks, lightweight
- **Web Audio API** — procedural noise generation + recorded audio hybrid
- **chrome.storage.local** — all data stays on your device
- **chrome.alarms** — reliable reminder scheduling
- **chrome.idle** — presence detection for smart pause/resume
- **chrome.offscreen** — background audio playback
- **chrome.declarativeNetRequest** — tracker blocking
- **chrome.sidePanel** — companion panel

---

## Installation

### From Chrome Web Store
*(Coming soon)*

### From Source (Developer Mode)
1. Clone this repository:
   ```bash
   git clone https://github.com/Kaydenletk/RemindMeThat.git
   ```
2. Open `chrome://extensions/` in Chrome
3. Enable **Developer mode** (top right toggle)
4. Click **Load unpacked**
5. Select the cloned `RemindMeThat` folder
6. Click the extension icon in your toolbar

---

## Screenshots

> Add screenshots to `assets/screenshots/` showing:
> 1. Dashboard with timer and greeting
> 2. Sound panel with Rain playing
> 3. Focus page with timer running
> 4. Mood check-in page with weekly chart
> 5. Side panel companion view

---

## Privacy

RemindMeThat stores all data locally on your device using `chrome.storage.local`. **Nothing is sent to any server.** No accounts, no analytics, no telemetry. Your mood logs, journal entries, and browsing data never leave your browser.

---

## Contributing

Contributions are welcome! Please open an issue first to discuss what you'd like to change.

---

## License

MIT

---

<p align="center">
  <em>"Small steps still move you forward."</em>
</p>
