// @ts-check
/** @type {any} */
const api = /** @type {any} */ (window).bytevac;
/** @type {{render: (src: string) => string}} */
const markdown = /** @type {any} */ (window).markdown;

const $ = (id) => /** @type {any} */ (document.getElementById(id));

// ---------- icons ----------

const ICON_PATHS = {
  send: '<path d="M12 19V5M5.5 11.5L12 5l6.5 6.5"/>',
  stop: '<rect x="5" y="5" width="14" height="14" rx="3"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  x: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
  trash: '<path d="M4 7h16M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13M10 11v5.5M14 11v5.5"/>',
  box: '<path d="M3.5 7.5L12 3l8.5 4.5v9L12 21l-8.5-4.5z"/><path d="M3.5 7.5L12 12l8.5-4.5M12 12v9"/>',
  folder: '<path d="M3 6.5A1.5 1.5 0 0 1 4.5 5H9l2 2h8.5A1.5 1.5 0 0 1 21 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5z"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/>',
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5M12 8v.01"/>',
  grid: '<rect x="4" y="4" width="6.5" height="6.5" rx="1.6"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.6"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.6"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.6"/>',
  spark: '<path d="M12 3.5l1.9 5.6 5.6 1.9-5.6 1.9L12 18.5l-1.9-5.6L4.5 11l5.6-1.9z"/>',
  key: '<circle cx="8" cy="15.5" r="3.8"/><path d="M10.8 12.7L19 4.5M15.5 8l2.5 2.5M17.5 6l2 2"/>',
  refresh: '<path d="M4.5 12a7.5 7.5 0 0 1 13-5.1L19.5 9M19.5 4.5V9H15M19.5 12a7.5 7.5 0 0 1-13 5.1L4.5 15M4.5 19.5V15H9"/>',
  broom: '<path d="M14.5 3.5l6 6M17.5 6.5l-5 5"/><path d="M12.5 11.5c-3-1.5-6 0-8 4l4 4c4-2 5.5-5 4-8z"/><path d="M6.5 15.5l2 2"/>',
  download: '<path d="M12 4v11M7 10.5l5 5 5-5M5 20h14"/>',
  stack: '<path d="M4 8l8-4 8 4-8 4z"/><path d="M4 12l8 4 8-4M4 16l8 4 8-4"/>',
};
const icon = (name) => `<svg class="i" viewBox="0 0 24 24" aria-hidden="true">${ICON_PATHS[name]}</svg>`;

const TOOL_ICONS = {
  system_info: "info",
  list_directory: "folder",
  find_large_files: "search",
  list_installed_apps: "grid",
  move_to_trash: "trash",
  uninstall_app: "box",
};

const SUGGESTIONS = [
  { icon: "broom", title: "Full sweep", sub: "Caches, temp files, old installers, the works", prompt: "Do a full sweep: find junk on this computer and tell me what we can clean up." },
  { icon: "download", title: "Downloads detox", sub: "What's been rotting in Downloads?", prompt: "Look through my Downloads folder and tell me what I can safely get rid of." },
  { icon: "stack", title: "Big & forgotten", sub: "Huge files nobody opened in a year", prompt: "Find big files I haven't touched in over a year." },
  { icon: "grid", title: "App graveyard", sub: "Apps you installed and forgot about", prompt: "Look at my installed apps and point out ones I probably don't use anymore." },
];

// ---------- helpers ----------

function human(bytes) {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  while (bytes >= 1024 && i < units.length - 1) {
    bytes /= 1024;
    i++;
  }
  return `${bytes.toFixed(i && bytes < 100 ? 1 : 0)} ${units[i]}`;
}

function el(tag, className, html) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (html != null) node.innerHTML = html;
  return node;
}

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

let toastTimer = 0;
function toast(text) {
  const t = $("toast");
  t.textContent = text;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => t.classList.remove("show"), 2600);
}

// ---------- chrome ----------

document.body.classList.add(`platform-${api.platform}`);
$("new-btn").innerHTML = icon("refresh");
$("key-btn").innerHTML = icon("key");
$("send").innerHTML = icon("send");

$("suggestions").replaceChildren(
  ...SUGGESTIONS.map((s) => {
    const b = el("button", "suggestion", `<span class="ico">${icon(s.icon)}</span><b>${s.title}</b><span>${s.sub}</span>`);
    b.type = "button";
    b.addEventListener("click", () => submit(s.prompt));
    return b;
  }),
);

// Sprinkle dust along the robot's loop, timed so each speck vanishes as the robot rolls over it.
(function sprinkleDust() {
  const trail = /** @type {SVGPathElement} */ (document.querySelector(".trail"));
  const len = trail.getTotalLength();
  trail.style.strokeDasharray = String(len);
  trail.style.strokeDashoffset = String(len);
  const LAP = 9; // seconds, matches the roam animation
  const specks = [];
  for (let n = 0; n < 22; n++) {
    const f = (n + Math.random() * 0.6) / 22;
    const p = trail.getPointAtLength(f * len);
    const speck = el("i");
    speck.style.left = `${p.x + (Math.random() - 0.5) * 18 - 2}px`;
    speck.style.top = `${p.y + (Math.random() - 0.5) * 18 - 2}px`;
    speck.style.opacity = String(0.35 + Math.random() * 0.5);
    speck.style.animationDelay = `${(f - 0.11) * LAP}s`;
    specks.push(speck);
  }
  $("dust").replaceChildren(...specks);
})();

// ---------- stats ----------

let freed = 0;
let shownFreed = 0;
let checked = 0;

function animateFreed() {
  const start = shownFreed;
  const end = freed;
  const t0 = performance.now();
  const step = (t) => {
    const k = Math.min(1, (t - t0) / 1200);
    shownFreed = start + (end - start) * (1 - Math.pow(1 - k, 3));
    $("freed").textContent = human(shownFreed);
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

async function refreshDisk() {
  const disk = await api.diskInfo();
  if (!disk) {
    $("disk-free").textContent = "Unavailable";
    return;
  }
  const used = 1 - disk.free / disk.total;
  $("disk-pct").textContent = `${Math.round(used * 100)}%`;
  $("disk-free").textContent = `${human(disk.free)} free`;
  $("disk-total").textContent = `of ${human(disk.total)}`;
  $("gauge-meter").style.strokeDashoffset = String(301.6 * (1 - used));
}

// ---------- conversation ----------

const feed = $("feed");
let thread = null;
let busy = false;

/** The assistant reply currently being built: a list of trace groups and text blocks, in order. */
let reply = null;

function ensureThread() {
  if (!thread) {
    $("hero").remove();
    thread = el("div", "thread");
    feed.appendChild(thread);
  }
  return thread;
}

function scrollDown() {
  const nearBottom = feed.scrollHeight - feed.scrollTop - feed.clientHeight < 160;
  if (nearBottom) feed.scrollTop = feed.scrollHeight;
}

function startReply() {
  const wrap = el("div", "msg-bot", '<div class="avatar"><span></span></div>');
  const body = el("div", "bot-body");
  const roaming = el("div", "roaming", '<span class="bar"></span><span>Roaming…</span>');
  body.appendChild(roaming);
  wrap.appendChild(body);
  ensureThread().appendChild(wrap);
  reply = { body, roaming, text: null, textBuf: "", trace: null, rows: new Map(), rendering: false };
}

function insert(node) {
  reply.body.insertBefore(node, reply.roaming);
  scrollDown();
}

function traceRow(kind, iconName, html) {
  if (!reply.trace) {
    reply.trace = el("div", "trace");
    insert(reply.trace);
    reply.text = null;
  }
  const row = el("div", `trace-row ${kind}`, `<span class="st">${icon(iconName)}</span><span class="txt">${html}</span>`);
  reply.trace.appendChild(row);
  scrollDown();
  return row;
}

function appendText(delta) {
  if (!reply.text) {
    reply.text = el("div", "md typing");
    reply.textBuf = "";
    insert(reply.text);
    reply.trace = null;
  }
  reply.textBuf += delta;
  // Re-render at most once per frame while the text streams in.
  if (!reply.rendering) {
    reply.rendering = true;
    const target = reply;
    requestAnimationFrame(() => {
      target.rendering = false;
      if (target.text) target.text.innerHTML = markdown.render(target.textBuf);
      scrollDown();
    });
  }
}

function note(kind, text) {
  const n = el("div", `note ${kind}`);
  n.textContent = text;
  if (reply) insert(n);
  else ensureThread().appendChild(n);
  scrollDown();
}

function setStatus(text) {
  $("robot-status").textContent = text;
}

function setBusy(next) {
  busy = next;
  document.body.classList.toggle("busy", busy);
  $("send").innerHTML = icon(busy ? "stop" : "send");
  $("send").setAttribute("aria-label", busy ? "Stop" : "Send");
  $("status-pill-text").textContent = busy ? "Vacuuming" : "Docked";
  input.placeholder = busy ? "bytevac is roaming… press Esc to stop" : "Tell bytevac where to roam…";
  if (!busy) setStatus("Docked · ready to roam");
}

function finishReply() {
  if (!reply) return;
  for (const row of reply.rows.values()) {
    if (row.classList.contains("running")) row.className = "trace-row fail";
  }
  reply.body.querySelectorAll(".typing").forEach((n) => n.classList.remove("typing"));
  if (reply.text) reply.text.innerHTML = markdown.render(reply.textBuf);
  reply.roaming.remove();
  if (!reply.body.children.length) reply.body.closest(".msg-bot")?.remove();
  reply = null;
}

api.onEvent((event) => {
  if (!reply && event.type !== "done" && event.type !== "freed") startReply();
  switch (event.type) {
    case "turn":
      // A new model reply begins; the next text starts a fresh block after any tool rows.
      if (reply.text) reply.text.classList.remove("typing");
      reply.text = null;
      setStatus("Thinking…");
      break;
    case "delta":
      appendText(event.text);
      setStatus("Writing up what it found…");
      break;
    case "thought":
      traceRow("thought", "spark", escapeHtml(event.text));
      break;
    case "tool": {
      const row = traceRow("running", TOOL_ICONS[event.name] ?? "spark", escapeHtml(event.label).replace(/(~[^\s]*|\/[^\s]*|[A-Za-z]:\\[^\s]*)/g, "<code>$1</code>"));
      reply.rows.set(event.id, row);
      setStatus(event.label);
      if (["system_info", "list_directory", "find_large_files", "list_installed_apps"].includes(event.name)) {
        $("checked").textContent = String(++checked);
      }
      break;
    }
    case "tool-done": {
      const row = reply.rows.get(event.id);
      if (row) {
        row.className = `trace-row ${event.ok ? "ok" : "fail"}`;
        row.querySelector(".st").innerHTML = icon(event.ok ? "check" : "x");
        if (!event.ok && event.error) row.title = event.error;
      }
      break;
    }
    case "freed":
      freed += event.bytes;
      animateFreed();
      refreshDisk();
      toast(`Vacuumed ${human(event.bytes)} ✨`);
      break;
    case "error":
    case "info":
      note(event.type, event.text);
      break;
    case "done":
      finishReply();
      setBusy(false);
      refreshDisk();
      $("input").focus();
      break;
  }
});

// ---------- composer ----------

const input = $("input");

function autosize() {
  input.style.height = "auto";
  input.style.height = `${Math.min(input.scrollHeight, 168)}px`;
}
input.addEventListener("input", autosize);

function submit(text) {
  if (busy) return;
  const msg = (text ?? input.value).trim() || SUGGESTIONS[0].prompt;
  input.value = "";
  autosize();
  const bubble = el("div", "msg-user");
  bubble.textContent = msg;
  ensureThread().appendChild(bubble);
  feed.scrollTop = feed.scrollHeight;
  setBusy(true);
  setStatus("Warming up the brushes…");
  startReply();
  api.send(msg);
}

$("composer").addEventListener("submit", (e) => {
  e.preventDefault();
  if (busy) api.stop();
  else submit();
});

input.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    submit();
  }
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && busy && $("ask").hidden) api.stop();
});

$("new-btn").addEventListener("click", async () => {
  await api.reset();
  location.reload();
});

// ---------- "are you sure?" ----------

let currentAsk = null;

api.onAsk((ask) => {
  currentAsk = ask;
  const uninstall = ask.kind === "uninstall";
  $("ask-icon").innerHTML = icon(uninstall ? "box" : "trash");
  $("ask-title").textContent = ask.title;
  $("ask-total").innerHTML = ask.total ? `About <b>${escapeHtml(ask.total)}</b> back` : "";
  $("ask-reason").textContent = ask.reason;
  $("ask-items").replaceChildren(
    ...ask.items.map((item) => {
      const cut = Math.max(item.label.lastIndexOf("/"), item.label.lastIndexOf("\\"));
      const name = item.label.slice(cut + 1) || item.label;
      const dir = cut > 0 ? item.label.slice(0, cut) : item.label.slice(0, cut + 1);
      const li = el("li");
      li.innerHTML = `<span class="path"><span class="name"></span><span class="dir"></span></span><span class="size"></span>`;
      li.querySelector(".name").textContent = name;
      // the rtl trick ellipsizes the start of long paths; the bdi keeps the slashes the right way round
      li.querySelector(".dir").innerHTML = `<bdi>${escapeHtml(dir)}</bdi>`;
      li.querySelector(".size").textContent = item.size ?? "";
      return li;
    }),
  );
  $("ask-foot").textContent = uninstall
    ? api.platform === "win32"
      ? "Opens the app's own uninstaller. You finish it there."
      : "The app goes to the Trash. Leftover settings stay until you clean them too."
    : "Everything goes to the Trash, so you can still put it back.";
  $("ask-yes").textContent = uninstall ? "Uninstall" : "Vacuum it";
  $("ask").hidden = false;
  $("ask-no").focus();
  setStatus("Waiting for your OK…");
});

function answerAsk(ok) {
  if (!currentAsk) return;
  api.answer(currentAsk.id, ok);
  currentAsk = null;
  $("ask").hidden = true;
  if (!ok) toast("Kept it. No crumbs touched.");
}

$("ask-yes").addEventListener("click", () => answerAsk(true));
$("ask-no").addEventListener("click", () => answerAsk(false));
$("ask").addEventListener("keydown", (e) => {
  if (e.key === "Escape") answerAsk(false);
});
api.onAskCancel(() => {
  currentAsk = null;
  $("ask").hidden = true;
});

// ---------- API key ----------

async function openKeySheet(firstRun) {
  const status = await api.keyStatus();
  $("forget-key").hidden = status !== "saved";
  $("close-key").hidden = firstRun;
  $("key-error").textContent = status === "env" && !firstRun ? "Using ANTHROPIC_API_KEY from your environment. A pasted key takes priority." : "";
  $("key-error").style.color = status === "env" ? "var(--text-3)" : "";
  $("key-input").value = "";
  $("onboard").hidden = false;
  $("key-input").focus();
}

$("key-btn").addEventListener("click", () => openKeySheet(false));
$("close-key").addEventListener("click", () => ($("onboard").hidden = true));
$("get-key").addEventListener("click", () => api.openConsole());
$("forget-key").addEventListener("click", async () => {
  const status = await api.forgetKey();
  toast("Key forgotten");
  if (status === "missing") openKeySheet(true);
  else $("onboard").hidden = true;
});
$("onboard").addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !$("close-key").hidden) $("onboard").hidden = true;
});

$("key-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = $("save-key");
  btn.disabled = true;
  btn.textContent = "Checking…";
  $("key-error").style.color = "";
  $("key-error").textContent = "";
  const res = await api.saveKey($("key-input").value);
  btn.disabled = false;
  btn.textContent = "Connect";
  if (!res.ok) {
    $("key-error").textContent = res.error;
    return;
  }
  $("onboard").hidden = true;
  toast(res.persisted ? "Connected. Brain installed 🧠" : "Connected for this session (no keychain to save it in)");
  input.focus();
});

// ---------- boot ----------

refreshDisk();
api.keyStatus().then((status) => {
  if (status === "missing") openKeySheet(true);
  else input.focus();
});
