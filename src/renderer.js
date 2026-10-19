// @ts-check
/** @type {any} */
const api = /** @type {any} */ (window).bytevac;

const log = /** @type {HTMLElement} */ (document.getElementById("log"));
const floor = /** @type {HTMLElement} */ (document.getElementById("floor"));
const form = /** @type {HTMLFormElement} */ (document.getElementById("form"));
const input = /** @type {HTMLInputElement} */ (document.getElementById("input"));
const go = /** @type {HTMLButtonElement} */ (document.getElementById("go"));
const stopBtn = /** @type {HTMLButtonElement} */ (document.getElementById("stop"));
const reset = /** @type {HTMLButtonElement} */ (document.getElementById("reset"));

const KICKOFF = "Do a full sweep: find junk on this computer and tell me what we can clean up.";

function say(kind, text) {
  const div = document.createElement("div");
  div.className = `msg ${kind}`;
  div.textContent = text;
  log.appendChild(div);
  log.scrollTop = log.scrollHeight;
}

function setBusy(busy) {
  floor.classList.toggle("busy", busy);
  go.disabled = busy;
  input.disabled = busy;
  stopBtn.disabled = !busy;
  go.textContent = log.querySelector(".msg.user") ? "Send" : "Start";
}

api.onEvent((event) => {
  if (event.type === "done") return setBusy(false);
  say(event.type, event.text);
});

form.addEventListener("submit", (e) => {
  e.preventDefault();
  const text = input.value.trim() || KICKOFF;
  input.value = "";
  say("user", text);
  setBusy(true);
  api.send(text);
});

stopBtn.addEventListener("click", () => api.stop());
reset.addEventListener("click", async () => {
  await api.reset();
  log.replaceChildren();
  setBusy(false);
  say("info", "Fresh start. Dust bag emptied.");
});

api.hasKey().then((ok) => {
  if (ok) say("info", "Beep boop. Hit Start and I'll go sniff around for junk. I'll ask before I throw anything away.");
  else say("error", "No ANTHROPIC_API_KEY found. Set it in your environment and restart bytevac.");
});
