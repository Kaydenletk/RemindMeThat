let overlayNode = null;

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type !== "FOCUS_STATE_UPDATED") {
    return false;
  }

  void renderFocusOverlay(message.payload);
  return false;
});

void bootstrap();

async function bootstrap() {
  if (
    window.location.protocol.startsWith("chrome") ||
    window.location.protocol.startsWith("edge")
  ) {
    return;
  }

  const { focus } = await chrome.storage.local.get("focus");
  await renderFocusOverlay(focus);
}

async function renderFocusOverlay(focus) {
  if (!shouldBlockCurrentHost(focus)) {
    removeOverlay();
    return;
  }

  const minutesRemaining = focus.endTime
    ? Math.max(1, Math.ceil((focus.endTime - Date.now()) / 60000))
    : Math.max(1, Math.ceil((focus.remainingMs ?? focus.durationMs) / 60000));

  if (!overlayNode) {
    overlayNode = buildOverlay();
  }

  overlayNode.querySelector("[data-focus-remaining]").textContent =
    `${minutesRemaining} min remaining`;
  overlayNode.querySelector("[data-focus-intention]").textContent =
    focus.intention || "Stay with the session.";

  if (document.readyState === "loading") {
    window.addEventListener("DOMContentLoaded", mountOverlay, { once: true });
    return;
  }

  mountOverlay();
}

function shouldBlockCurrentHost(focus) {
  if (!focus || focus.status !== "running" || !Array.isArray(focus.blockedSites)) {
    return false;
  }

  const hostname = window.location.hostname.toLowerCase();
  return focus.blockedSites.some((blockedDomain) => {
    const normalized = String(blockedDomain).trim().toLowerCase();
    return hostname === normalized || hostname.endsWith(`.${normalized}`);
  });
}

function buildOverlay() {
  const overlay = document.createElement("div");
  overlay.id = "remindmethat-focus-overlay"; // keep lowercase for CSS consistency
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-live", "polite");
  overlay.innerHTML = `
    <div style="max-width:420px;padding:32px;border-radius:24px;background:#13152a;color:#f6f4ff;box-shadow:0 24px 60px rgba(17,18,35,0.35);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
      <div style="font-size:12px;letter-spacing:0.18em;text-transform:uppercase;color:#b8b3ff;margin-bottom:12px;">Focus mode</div>
      <h1 style="margin:0 0 12px;font-size:28px;line-height:1.1;" data-focus-intention>Stay with the session.</h1>
      <p style="margin:0 0 18px;font-size:14px;line-height:1.6;color:#d9d6ff;">This host is blocked right now so your attention can stay where you meant to put it.</p>
      <div style="display:inline-flex;padding:10px 14px;border-radius:999px;background:rgba(238,237,254,0.12);font-size:13px;" data-focus-remaining>0 min remaining</div>
    </div>
  `;

  Object.assign(overlay.style, {
    position: "fixed",
    inset: "0",
    zIndex: "2147483647",
    display: "grid",
    placeItems: "center",
    padding: "24px",
    background:
      "radial-gradient(circle at top, rgba(74,155,217,0.72), rgba(15,17,32,0.94))"
  });

  return overlay;
}

function mountOverlay() {
  if (!overlayNode || document.documentElement.contains(overlayNode)) {
    return;
  }

  document.documentElement.appendChild(overlayNode);
}

function removeOverlay() {
  if (!overlayNode) {
    return;
  }

  overlayNode.remove();
}
