// @ts-check
// The robot's brain: Claude with a handful of tools, running in a loop until the job is done.

const Anthropic = require("@anthropic-ai/sdk").default;

const SYSTEM = `You are bytevac, a friendly robot vacuum for the user's computer.
You roam the disk, find junk, and help get rid of it: caches, temp files, old installers,
forgotten downloads, huge files nobody opened in ages, and apps the user no longer uses.

How you work:
- Start with system_info, then look around with the read-only tools before suggesting anything.
- Group what you find into a short report with sizes, biggest wins first. Markdown lists and **bold** render nicely.
- Only call move_to_trash or uninstall_app for things you are confident are junk, and batch related items into one call.
  The user approves every call in a dialog, so explain clearly in "reason".
- Personal files (photos, documents, projects, anything that looks hand-made) are never junk on your own say-so.
  Mention them and let the user decide.
- Reply in the user's language. Keep messages short and a little playful. You are a vacuum, not a lawyer.`;

const MAX_BAD_JSON_RETRIES = 2;

/**
 * @typedef {{type: string, [key: string]: any}} AgentEvent
 * @param {object} opts
 * @param {ReturnType<typeof import("./tools").makeTools>} opts.tools
 * @param {(event: AgentEvent) => void} opts.emit  push progress to the window
 * @param {() => string | undefined} opts.apiKey  a saved key, or undefined to use the environment
 */
function createAgent({ tools, emit, apiKey }) {
  // Tell the window when each tool starts and finishes, and stream tool inputs as they're generated.
  const watched = tools.map((tool) => ({
    ...tool,
    eager_input_streaming: true,
    run: async (input, ctx) => {
      const id = ctx?.toolUse.id;
      emit({ type: "tool", id, name: tool.name, label: describe(tool.name, input) });
      try {
        const out = await tool.run(input, ctx);
        emit({ type: "tool-done", id, ok: true });
        return out;
      } catch (err) {
        emit({ type: "tool-done", id, ok: false, error: String(err?.message ?? err) });
        throw err;
      }
    },
  }));

  /** @type {import("@anthropic-ai/sdk").default.Beta.BetaMessageParam[]} */
  let history = [];
  /** @type {AbortController | null} */
  let current = null;

  async function send(userText) {
    if (current) throw new Error("bytevac is already busy");
    current = new AbortController();
    const key = apiKey();
    const client = new Anthropic(key ? { apiKey: key } : {});
    /** @type {import("@anthropic-ai/sdk").default.Beta.BetaMessageParam[]} */
    let messages = [...history, { role: "user", content: userText }];
    let badJson = 0;

    try {
      // Normally runs once. It only goes around again when a streamed tool input arrived as unparseable JSON.
      while (true) {
        const runner = client.beta.messages.toolRunner(
          {
            model: "claude-opus-5-5",
            max_tokens: 16000,
            max_iterations: 40,
            stream: true,
            system: SYSTEM,
            tools: watched,
            // "updates" turns the model's notes between tool calls into short progress messages.
            thinking: { type: "adaptive", display: "updates" },
            output_config: { effort: "high" },
            // If a safety classifier declines, the API retries on its recommended fallback model.
            fallbacks: "default",
            betas: ["server-side-fallback-2026-07-01", "thinking-display-updates-2026-08-18"],
            messages,
          },
          { signal: current.signal },
        );
        try {
          for await (const stream of runner) {
            emit({ type: "turn" });
            stream.on("text", (delta) => emit({ type: "delta", text: delta }));
            stream.on("contentBlock", (block) => {
              if (block.type === "thinking" && block.thinking) emit({ type: "thought", text: block.thinking });
            });
            const message = await stream.finalMessage();
            badJson = 0;
            if (message.stop_reason === "refusal") {
              emit({ type: "error", text: "Claude declined this request, so bytevac stopped here." });
              break;
            }
            // A tool input cut off by max_tokens can still look valid, so never run it.
            if (message.stop_reason === "max_tokens" && message.content.some((b) => b.type === "tool_use")) {
              emit({ type: "error", text: "The reply got cut off mid-step. Try a narrower request." });
              break;
            }
          }
          history = trimToCleanEnd(runner.params.messages);
          break;
        } catch (err) {
          if (err instanceof Anthropic.APIError || badJson++ >= MAX_BAD_JSON_RETRIES) {
            history = trimToCleanEnd(runner.params.messages);
            throw err;
          }
          // The garbled reply never made it into the history, so asking again from here retries just that step.
          messages = [...runner.params.messages];
          if (messages.at(-1)?.role !== "user") messages = [...history, { role: "user", content: userText }];
        }
      }
    } catch (err) {
      if (err instanceof Anthropic.APIUserAbortError) emit({ type: "info", text: "Stopped. Dust bag sealed." });
      else if (err instanceof Anthropic.AuthenticationError) emit({ type: "error", text: "Your API key was rejected." });
      else if (err instanceof Anthropic.RateLimitError) emit({ type: "error", text: "Rate limited. Give it a minute and try again." });
      else if (err instanceof Anthropic.APIConnectionError) emit({ type: "error", text: "Can't reach the Anthropic API. Check your connection." });
      else if (err instanceof Anthropic.APIError) emit({ type: "error", text: `API error ${err.status}: ${err.message}` });
      else emit({ type: "error", text: String(err) });
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
  const i = /** @type {Record<string, any>} */ (input ?? {});
  switch (name) {
    case "system_info":
      return "Checking out the place";
    case "list_directory":
      return `Peeking into ${i.path}`;
    case "find_large_files":
      return `Hunting big files in ${i.path}`;
    case "list_installed_apps":
      return "Looking at installed apps";
    case "move_to_trash":
      return `Asking to trash ${i.paths?.length ?? "some"} item${i.paths?.length === 1 ? "" : "s"}`;
    case "uninstall_app":
      return `Asking to uninstall ${String(i.id).split(/[\\/:]/).pop()}`;
    default:
      return name;
  }
}

module.exports = { createAgent };
