import type { PaletteProject } from "./paletteModel";

export type CodexApplyResult = {
  applied: boolean;
  source: "codex-cli" | "dry-run" | "local";
  status: string;
  handoff?: string;
  files?: string[];
  summary?: string;
};

export type CodexApplyEvent = {
  type: "phase" | "output" | "result" | "error";
  label: string;
  detail?: string;
  at?: string;
  result?: CodexApplyResult;
};

export async function requestCodexApply(
  project: PaletteProject,
  onEvent?: (event: CodexApplyEvent) => void,
): Promise<CodexApplyResult> {
  if (!shouldUseCodexApply()) {
    return {
      applied: false,
      source: "local",
      status: "Start the Palette backend and enable Codex apply to edit repo files.",
    };
  }

  if (onEvent) {
    return requestCodexApplyStream(project, onEvent);
  }

  return requestCodexApplyPlain(project);
}

async function requestCodexApplyPlain(project: PaletteProject): Promise<CodexApplyResult> {
  try {
    const response = await fetch("/api/codex/apply", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        project,
        instruction: "Apply the current Palette canvas to generated React files.",
      }),
    });

    const payload = await readJson<CodexApplyResult>(response, "Palette backend returned no Codex response.");
    if (!response.ok) {
      throw new Error(payload.error || `Codex apply returned ${response.status}`);
    }

    if (typeof payload.status === "string" && payload.source) {
      return {
        applied: Boolean(payload.applied),
        source: payload.source,
        status: payload.status,
        handoff: payload.handoff,
        files: payload.files,
        summary: payload.summary,
      } as CodexApplyResult;
    }

    throw new Error("Codex apply returned an invalid payload.");
  } catch (error) {
    return {
      applied: false,
      source: "local",
      status: friendlyError(error, "Palette backend offline. Start npm run api before applying with Codex."),
    };
  }
}

async function requestCodexApplyStream(
  project: PaletteProject,
  onEvent: (event: CodexApplyEvent) => void,
): Promise<CodexApplyResult> {
  try {
    const response = await fetch("/api/codex/apply-stream", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        project,
        instruction: "Apply the current Palette canvas to generated React files.",
      }),
    });

    if (!response.ok || !response.body) {
      return requestCodexApplyPlain(project);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let finalResult: CodexApplyResult | null = null;

    while (true) {
      const { done, value } = await reader.read();
      if (value) {
        buffer += decoder.decode(value, { stream: !done });
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.trim()) continue;
          const event = JSON.parse(line) as CodexApplyEvent;
          onEvent(event);
          if (event.type === "error") throw new Error(event.detail || event.label);
          if (event.type === "result" && event.result) finalResult = event.result;
        }
      }

      if (done) break;
    }

    if (buffer.trim()) {
      const event = JSON.parse(buffer) as CodexApplyEvent;
      onEvent(event);
      if (event.type === "error") throw new Error(event.detail || event.label);
      if (event.type === "result" && event.result) finalResult = event.result;
    }

    if (!finalResult) throw new Error("Codex stream ended without a final result.");
    return finalResult;
  } catch (error) {
    return {
      applied: false,
      source: "local",
      status: friendlyError(error, "Palette backend offline. Start npm run api before applying with Codex."),
    };
  }
}

async function readJson<T>(response: Response, emptyMessage: string) {
  try {
    return (await response.json()) as Partial<T> & { error?: string };
  } catch {
    throw new Error(emptyMessage);
  }
}

function friendlyError(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : "";
  if (
    !message ||
    message.includes("Failed to fetch") ||
    message.includes("Unexpected end of JSON") ||
    message.includes("returned no Codex response")
  ) {
    return fallback;
  }
  return message;
}

function shouldUseCodexApply() {
  if (import.meta.env.VITE_PALETTE_CODEX_APPLY === "1") return true;

  try {
    return window.localStorage.getItem("palette:codex-apply") === "1";
  } catch {
    return false;
  }
}
