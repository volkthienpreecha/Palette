import type { PaletteProject, PaletteSwatch } from "./paletteModel";
import type { PaletteSectionModel } from "./sectionRenderers";
import type { PalettePinnedNote } from "./workspaceBridge";

export type PaletteBrief = {
  product?: string;
  audience?: string;
  feeling?: string;
  references?: string;
  avoid?: string;
  goal?: string;
  rawAnswers?: string[];
};

export type InterviewQuestion = {
  complete: boolean;
  question: string;
  field: keyof PaletteBrief | "done";
  helper?: string;
  status?: string;
  source?: string;
  brief?: PaletteBrief;
  projectId?: string;
};

export type DesignContextResult = {
  ok: boolean;
  projectId: string;
  workspace: string;
  files: string[];
  brief: PaletteBrief;
  references: PaletteSwatch[];
  notes: BuildNote[];
  status: string;
};

export type BuildNote = {
  id?: string;
  text: string;
  sectionId?: string;
};

export type PaletteBuildResult = {
  applied: boolean;
  mode: "start" | "patch" | "polish";
  source: "codex-cli" | "claude" | "openai" | "dry-run" | "local";
  projectId: string;
  workspace: string;
  project: PaletteProject;
  files: string[];
  status: string;
  summary?: string;
};

export type PaletteBuildEvent = {
  type: "phase" | "output" | "section" | "result" | "error";
  label: string;
  detail?: string;
  at?: string;
  index?: number;
  projectId?: string;
  workspace?: string;
  section?: PaletteSectionModel;
  project?: PaletteProject;
  result?: PaletteBuildResult;
};

export type WorkspaceBundleFile = {
  path: string;
  encoding: "utf8" | "base64";
  content?: string;
  contentBase64?: string;
};

export type WorkspaceBundleResult = {
  schemaVersion: string;
  createdAt: string;
  projectId: string;
  workspace: string;
  purpose: string;
  expectedFiles: string[];
  agentPrompt: string;
  files: WorkspaceBundleFile[];
  error?: string;
};

export type BuildEngineStatus = {
  ok: boolean;
  selectedProvider: "codex" | "claude" | "openai";
  configuredProvider: string;
  label: string;
  ready: boolean;
  model: string;
  detail: string;
  note?: string;
  error?: string;
};

export type BuildPayload = {
  projectId?: string | null;
  command?: string;
  selectedId?: string | null;
  selectedSection?: PaletteSectionModel | null;
  brief?: PaletteBrief;
  references?: PaletteSwatch[];
  notes?: BuildNote[];
  project?: PaletteProject;
};

export function notesForBuild(notes: PalettePinnedNote[]): BuildNote[] {
  return notes
    .filter((note) => note.includeInContext)
    .map((note) => ({
      id: note.id,
      text: note.text,
      sectionId: note.targetId,
    }));
}

export async function requestInterviewNext(payload: {
  initialPrompt?: string;
  answer?: string;
  lastQuestionKey?: string;
  question?: string;
  brief?: PaletteBrief;
  references?: PaletteSwatch[];
  notes?: BuildNote[];
  history?: Array<{ field?: string; question: string; answer: string }>;
}): Promise<InterviewQuestion> {
  const response = await postJson("/api/interview/next", payload);
  const result = await readJson<InterviewQuestion>(response, "Palette returned no interview question.");
  if (!response.ok) throw new Error(result.error || `Interview returned ${response.status}`);
  if (typeof result.question === "string" && typeof result.complete === "boolean") return result as InterviewQuestion;
  throw new Error("Palette returned an invalid interview question.");
}

export async function requestDesignContext(payload: BuildPayload): Promise<DesignContextResult> {
  const response = await postJson("/api/design/context", payload);
  const result = await readJson<DesignContextResult>(response, "Palette returned no design context.");
  if (!response.ok) throw new Error(result.error || `Design context returned ${response.status}`);
  if (typeof result.projectId === "string" && typeof result.status === "string") return result as DesignContextResult;
  throw new Error("Palette returned an invalid design context.");
}

export async function requestWorkspaceBuild(
  payload: BuildPayload,
  onEvent?: (event: PaletteBuildEvent) => void,
  signal?: AbortSignal,
): Promise<PaletteBuildResult> {
  return requestWorkspaceRun("/api/build/start", "/api/build/start-stream", payload, onEvent, signal);
}

export async function requestWorkspacePatch(
  payload: BuildPayload,
  onEvent?: (event: PaletteBuildEvent) => void,
  signal?: AbortSignal,
): Promise<PaletteBuildResult> {
  return requestWorkspaceRun("/api/build/patch", "/api/build/patch-stream", payload, onEvent, signal);
}

export async function requestWorkspacePolish(
  payload: BuildPayload,
  onEvent?: (event: PaletteBuildEvent) => void,
  signal?: AbortSignal,
): Promise<PaletteBuildResult> {
  return requestWorkspaceRun("/api/design/polish", "/api/design/polish-stream", payload, onEvent, signal);
}

export async function requestWorkspaceBundle(projectId: string): Promise<WorkspaceBundleResult> {
  const response = await fetch(`/api/workspaces/${encodeURIComponent(projectId)}/bundle`);
  const result = await readJson<WorkspaceBundleResult>(response, "Palette returned no workspace bundle.");
  if (!response.ok) throw new Error(result.error || `Workspace bundle returned ${response.status}`);
  if (Array.isArray(result.files) && typeof result.projectId === "string") return result as WorkspaceBundleResult;
  throw new Error("Palette returned an invalid workspace bundle.");
}

export async function requestBuildEngineStatus(): Promise<BuildEngineStatus> {
  const response = await fetch("/api/build/status");
  const result = await readJson<BuildEngineStatus>(response, "Palette returned no build engine status.");
  if (!response.ok) throw new Error(result.error || `Build status returned ${response.status}`);
  if (typeof result.label === "string" && typeof result.ready === "boolean") return result as BuildEngineStatus;
  throw new Error("Palette returned an invalid build engine status.");
}

async function requestWorkspaceRun(
  plainPath: string,
  streamPath: string,
  payload: BuildPayload,
  onEvent?: (event: PaletteBuildEvent) => void,
  signal?: AbortSignal,
): Promise<PaletteBuildResult> {
  try {
    if (onEvent) return requestStream(streamPath, payload, onEvent, signal);
    const response = await postJson(plainPath, payload, signal);
    const result = await readJson<PaletteBuildResult>(response, "Palette returned no build result.");
    if (!response.ok) throw new Error(result.error || `Build returned ${response.status}`);
    if (result.project && typeof result.status === "string") return result as PaletteBuildResult;
    throw new Error("Palette returned an invalid build result.");
  } catch (error) {
    return localFailure(error);
  }
}

async function requestStream(
  path: string,
  payload: BuildPayload,
  onEvent: (event: PaletteBuildEvent) => void,
  signal?: AbortSignal,
): Promise<PaletteBuildResult> {
  const response = await postJson(path, payload, signal);
  if (!response.ok || !response.body) {
    const result = await readJson<PaletteBuildResult>(response, "Palette returned no build result.");
    throw new Error(result.error || `Build returned ${response.status}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let finalResult: PaletteBuildResult | null = null;

  while (true) {
    const { done, value } = await reader.read();
    if (value) {
      buffer += decoder.decode(value, { stream: !done });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.trim()) continue;
        const event = JSON.parse(line) as PaletteBuildEvent;
        onEvent(event);
        if (event.type === "error") throw new Error(event.detail || event.label);
        if (event.type === "result" && event.result) finalResult = event.result;
      }
    }

    if (done) break;
  }

  if (buffer.trim()) {
    const event = JSON.parse(buffer) as PaletteBuildEvent;
    onEvent(event);
    if (event.type === "error") throw new Error(event.detail || event.label);
    if (event.type === "result" && event.result) finalResult = event.result;
  }

  if (!finalResult) throw new Error("Palette stream ended without a final result.");
  return finalResult;
}

async function postJson(path: string, payload: unknown, signal?: AbortSignal) {
  return fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal,
  });
}

async function readJson<T>(response: Response, emptyMessage: string) {
  try {
    return (await response.json()) as Partial<T> & { error?: string };
  } catch {
    throw new Error(emptyMessage);
  }
}

function localFailure(error: unknown): PaletteBuildResult {
  if (error instanceof DOMException && error.name === "AbortError") {
    return {
      applied: false,
      mode: "start",
      source: "local",
      projectId: "",
      workspace: "",
      project: {
        id: "palette-interrupted",
        name: "Build interrupted",
        theme: "atelier",
        sections: [],
        swatches: [],
        brushLog: [{ id: "build-interrupted", label: "Build interrupted", detail: "The live section stream was paused." }],
        past: [],
        future: [],
      },
      files: [],
      status: "Painting interrupted.",
    };
  }

  const message = friendlyError(error, "Palette backend offline. Start npm run api to paint with Codex.");
  return {
    applied: false,
    mode: "start",
    source: "local",
    projectId: "",
    workspace: "",
    project: {
      id: "palette-error",
      name: "Build unavailable",
      theme: "atelier",
      sections: [],
      swatches: [],
      brushLog: [{ id: "build-error", label: "Build unavailable", detail: message }],
      past: [],
      future: [],
    },
    files: [],
    status: message,
  };
}

function friendlyError(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : "";
  if (
    !message ||
    message.includes("Failed to fetch") ||
    message.includes("Unexpected end of JSON") ||
    message.includes("returned no build result")
  ) {
    return fallback;
  }
  return message;
}
