import type { PaletteProject } from "./paletteModel";

export type HandoffBundleResult = {
  created: boolean;
  source: "handoff-bundle" | "local";
  status: string;
  handoff?: string;
  files?: string[];
  allowedFiles?: string[];
  bundle?: unknown;
};

export type HandoffBundleOptions = {
  agent?: "codex" | "claude-code" | "cursor" | "generic" | string;
  instruction?: string;
};

export async function requestHandoffBundle(
  project: PaletteProject,
  options: HandoffBundleOptions = {},
): Promise<HandoffBundleResult> {
  if (!shouldUseHandoffBundle()) {
    return {
      created: false,
      source: "local",
      status: "Handoff bundles are disabled for local-only mode.",
    };
  }

  try {
    const response = await fetch("/api/handoff/bundle", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        project,
        agent: options.agent ?? "generic",
        instruction: options.instruction ?? "Apply the current Palette canvas to generated React files.",
      }),
    });

    const payload = await readJson<HandoffBundleResult>(response, "Palette backend returned no handoff response.");
    if (!response.ok) {
      throw new Error(payload.error || `Handoff bundle returned ${response.status}`);
    }

    if (typeof payload.status === "string" && payload.source) {
      return {
        created: Boolean(payload.created),
        source: payload.source,
        status: payload.status,
        handoff: payload.handoff,
        files: payload.files,
        allowedFiles: payload.allowedFiles,
        bundle: payload.bundle,
      } as HandoffBundleResult;
    }

    throw new Error("Handoff bundle returned an invalid payload.");
  } catch (error) {
    return {
      created: false,
      source: "local",
      status: friendlyError(error, "Palette backend offline. Start npm run api to prepare handoff bundles."),
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
    message.includes("returned no handoff response")
  ) {
    return fallback;
  }
  return message;
}

function shouldUseHandoffBundle() {
  if (import.meta.env.VITE_PALETTE_HANDOFF_API === "0") return false;

  try {
    return window.localStorage.getItem("palette:handoff-api") !== "0";
  } catch {
    return true;
  }
}
