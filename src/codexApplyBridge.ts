import type { PaletteProject } from "./paletteModel";

export type CodexApplyResult = {
  applied: boolean;
  source: "codex-cli" | "dry-run" | "local";
  status: string;
  handoff?: string;
  files?: string[];
  summary?: string;
};

export async function requestCodexApply(project: PaletteProject): Promise<CodexApplyResult> {
  if (!shouldUseCodexApply()) {
    return {
      applied: false,
      source: "local",
      status: "Start the Palette backend and enable Codex apply to edit repo files.",
    };
  }

  try {
    const response = await fetch("/api/codex/apply", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        project,
        instruction: "Apply the current Palette canvas to generated React files.",
      }),
    });

    const payload = (await response.json()) as Partial<CodexApplyResult> & { error?: string };
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
      status: error instanceof Error ? error.message : "Codex apply failed.",
    };
  }
}

function shouldUseCodexApply() {
  if (import.meta.env.VITE_PALETTE_CODEX_APPLY === "1") return true;

  try {
    return window.localStorage.getItem("palette:codex-apply") === "1";
  } catch {
    return false;
  }
}
