import type { PaletteProject } from "./paletteModel";

export type ProjectSaveResult = {
  saved: boolean;
  source: "folder-store" | "local";
  status: string;
  folder?: string;
  files?: string[];
};

export async function requestProjectSave(project: PaletteProject): Promise<ProjectSaveResult> {
  if (!shouldUseProjectStore()) {
    return {
      saved: false,
      source: "local",
      status: "Start the Palette backend and enable folder save to persist canvases.",
    };
  }

  try {
    const response = await fetch("/api/projects/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        project,
        instruction: "Saved from the Palette canvas for Codex to reopen and apply later.",
      }),
    });

    const payload = await readJson<ProjectSaveResult>(response, "Palette backend returned no folder-save response.");
    if (!response.ok) {
      throw new Error(payload.error || `Project save returned ${response.status}`);
    }

    if (typeof payload.status === "string" && payload.source) {
      return {
        saved: Boolean(payload.saved),
        source: payload.source,
        status: payload.status,
        folder: payload.folder,
        files: payload.files,
      } as ProjectSaveResult;
    }

    throw new Error("Project save returned an invalid payload.");
  } catch (error) {
    return {
      saved: false,
      source: "local",
      status: friendlyError(error, "Palette backend offline. Start npm run api to save studio folders."),
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
    message.includes("returned no folder-save response")
  ) {
    return fallback;
  }
  return message;
}

function shouldUseProjectStore() {
  if (import.meta.env.VITE_PALETTE_PROJECT_STORE === "1") return true;

  try {
    return window.localStorage.getItem("palette:project-store") === "1";
  } catch {
    return false;
  }
}
