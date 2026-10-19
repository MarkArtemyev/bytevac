// @ts-check
// The robot's brain: Claude with a handful of tools, running in a loop until the job is done.

const Anthropic = require("@anthropic-ai/sdk").default;

const SYSTEM = `You are bytevac, a friendly robot vacuum for the user's computer.
You roam the disk, find junk, and help get rid of it: caches, temp files, old installers,
forgotten downloads, huge files nobody opened in ages, and apps the user no longer uses.

How you work:
- Start with system_info, then look around with the read-only tools before suggesting anything.
- Group what you find into a short report with sizes, biggest wins first.
- Only call move_to_trash or uninstall_app for things you are confident are junk, and batch related items into one call.
  The user approves every call in a dialog, so explain clearly in "reason".
- Personal files (photos, documents, projects, anything that looks hand-made) are never junk on your own say-so.
  Mention them and let the user decide.
- Keep messages short and a little playful. You are a vacuum, not a lawyer.`;

/**
 * @param {object} opts
 * @param {ReturnType<typeof import("./tools").makeTools>} opts.tools
 * @param {(event: {type: string, text?: string}) => void} opts.emit  push progress to the window
 */
function createAgent({ tools, emit }) {
  const client = new Anthropic();
  /** @type {import("@anthropic-ai/sdk").default.Beta.BetaMessageParam[]} */
  let history = [];
  /** @type {AbortController | null} */
  let current = null;

  async function send(userText) {
    if (current) throw new Error("bytevac is already busy");
    current = new AbortController();
    const runner = client.beta.messages.toolRunner(
      {
        model: "claude-opus-5-5",
        max_tokens: 16000,
        max_iterations: 40,
        system: SYSTEM,
        tools,
        // "updates" turns the model's notes between tool calls into short progress messages.
        thinking: { type: "adaptive", display: "updates" },
        output_config: { effort: "high" },
        // If a safety classifier declines, the API retries on its recommended fallback model.
        fallbacks: "default",
        betas: ["server-side-fallback-2026-07-01", "thinking-display-updates-2026-08-18"],
        messages: [...history, { role: "user", content: userText }],
      },
      { signal: current.signal },
    );

    try {
      for await (const message of runner) {
        if (message.stop_reason === "refusal") {
          emit({ type: "error", text: "Claude declined this request, so bytevac stopped here." });
        }
        for (const block of message.content) {
          if (block.type === "thinking" && block.thinking) emit({ type: "thought", text: block.thinking });
          else if (block.type === "text" && block.text) emit({ type: "text", text: block.text });
          else if (block.type === "tool_use") emit({ type: "tool", text: describe(block.name, block.input) });
        }
      }
      history = [...runner.params.messages];
    } catch (err) {
      if (err instanceof Anthropic.APIUserAbortError) emit({ type: "info", text: "Stopped." });
      else if (err instanceof Anthropic.AuthenticationError) emit({ type: "error", text: "Your ANTHROPIC_API_KEY was rejected." });
      else if (err instanceof Anthropic.RateLimitError) emit({ type: "error", text: "Rate limited. Give it a minute and try again." });
      else if (err instanceof Anthropic.APIError) emit({ type: "error", text: `API error ${err.status}: ${err.message}` });
      else emit({ type: "error", text: String(err) });
      // Keep whatever finished cleanly, so the next message continues the same conversation.
      history = trimToCleanEnd(runner.params.messages);
    } finally {
      current = null;
      emit({ type: "done" });
    }
  }

  return {
    send,
    stop: () => current?.abort(),
    reset: () => {
      current?.abort();
      history = [];
    },
  };
}

/** Cut the history back to the last assistant turn that finished without pending tool calls. */
function trimToCleanEnd(messages) {
  const out = [...messages];
  const unfinished = (m) =>
    m.role === "user" || (Array.isArray(m.content) && m.content.some((b) => b.type === "tool_use"));
  while (out.length && unfinished(out.at(-1))) out.pop();
  return out;
}

function describe(name, input) {
  const i = /** @type {Record<string, any>} */ (input);
  switch (name) {
    case "system_info":
      return "🔎 Checking out the place";
    case "list_directory":
      return `📂 Peeking into ${i.path}`;
    case "find_large_files":
      return `🐘 Hunting big files in ${i.path}`;
    case "list_installed_apps":
      return "📦 Looking at installed apps";
    case "move_to_trash":
      return `🗑️ Wants to trash ${i.paths?.length ?? "some"} item(s)`;
    case "uninstall_app":
      return `🧨 Wants to uninstall ${i.id}`;
    default:
      return `🔧 ${name}`;
  }
}

module.exports = { createAgent };
