import { createExportBundle, type PaletteProject, type PaletteSwatch } from "./paletteModel";
import type { PaletteSectionModel } from "./sectionRenderers";

const workspaceKey = "palette:workspace:v1";
const workspaceOwnerTokenKey = "palette:workspace-owner-token:v1";
const maxSavedProjects = 10;

export type PalettePinnedNote = {
  id: string;
  text: string;
  targetId?: string;
  targetKind?: string;
  includeInContext: boolean;
  createdAt: string;
  updatedAt: string;
};

export type PaletteSubmission = {
  id: string;
  kind: "waitlist" | "contact" | "form";
  sectionId: string;
  sectionKind: string;
  sectionTitle: string;
  projectId: string;
  projectName: string;
  values: Record<string, string>;
  createdAt: string;
};

export type SavedPaletteProject = {
  id: string;
  name: string;
  updatedAt: string;
  project: PaletteProject;
  notes: PalettePinnedNote[];
  submissions: PaletteSubmission[];
};

export type PaletteWorkspaceBrief = {
  product?: string;
  audience?: string;
  feeling?: string;
  references?: string;
  avoid?: string;
  goal?: string;
  rawAnswers?: string[];
};

export type PaletteWorkspaceState = {
  project: PaletteProject;
  selectedId: string | null;
  buildProjectId: string | null;
  brief: PaletteWorkspaceBrief;
  notes: PalettePinnedNote[];
  submissions: PaletteSubmission[];
  savedProjects: SavedPaletteProject[];
  updatedAt: string;
};

export type PersistentSwatch = PaletteSwatch & {
  createdAt?: string;
  source?: "upload" | "clipboard" | "drop";
  originalName?: string;
};

export function loadWorkspaceState(fallbackProject: PaletteProject): PaletteWorkspaceState {
  const fallback = createWorkspaceState({
    project: fallbackProject,
    selectedId: null,
    buildProjectId: null,
    brief: {},
    notes: [],
    submissions: [],
    savedProjects: [],
  });

  try {
    const raw = window.localStorage.getItem(workspaceKey);
    if (!raw) return fallback;

    const parsed = JSON.parse(raw) as Partial<PaletteWorkspaceState>;
    if (!parsed.project || !Array.isArray(parsed.project.sections)) return fallback;

    return createWorkspaceState({
      project: normalizeProject(parsed.project, fallbackProject),
      selectedId: validSelectedId(parsed.project, parsed.selectedId),
      buildProjectId: normalizeBuildProjectId(parsed.buildProjectId),
      brief: normalizeBrief(parsed.brief),
      notes: normalizeNotes(parsed.notes),
      submissions: normalizeSubmissions(parsed.submissions),
      savedProjects: normalizeSavedProjects(parsed.savedProjects),
      updatedAt: parsed.updatedAt,
    });
  } catch {
    return fallback;
  }
}

export function persistWorkspaceState(state: PaletteWorkspaceState): boolean {
  try {
    const normalized = createWorkspaceState(state);
    window.localStorage.setItem(workspaceKey, JSON.stringify(normalized));
    if (shouldUseRemoteWorkspaceStore()) void requestWorkspaceSave(normalized);
    return true;
  } catch {
    return false;
  }
}

export async function requestWorkspaceLoad(): Promise<PaletteWorkspaceState | null> {
  if (!shouldUseRemoteWorkspaceStore()) return null;
  const ownerToken = remoteOwnerToken();
  if (!ownerToken) return null;

  try {
    const response = await fetch("/api/workspace/state", {
      headers: { "X-Owner-Token": ownerToken },
    });
    if (!response.ok) return null;
    const payload = (await response.json()) as { state?: Partial<PaletteWorkspaceState> } & Partial<PaletteWorkspaceState>;
    const state = payload.state ?? payload;
    if (!state.project || !Array.isArray(state.project.sections)) return null;
    return createWorkspaceState({
      project: state.project,
      selectedId: validSelectedId(state.project, state.selectedId),
      buildProjectId: normalizeBuildProjectId(state.buildProjectId),
      brief: normalizeBrief(state.brief),
      notes: normalizeNotes(state.notes),
      submissions: normalizeSubmissions(state.submissions),
      savedProjects: normalizeSavedProjects(state.savedProjects),
      updatedAt: state.updatedAt,
    });
  } catch {
    return null;
  }
}

export async function requestWorkspaceSave(state: PaletteWorkspaceState): Promise<void> {
  try {
    const ownerToken = remoteOwnerToken();
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (ownerToken) headers["X-Owner-Token"] = ownerToken;

    const response = await fetch("/api/workspace/state", {
      method: "PUT",
      headers,
      body: JSON.stringify(state),
    });
    if (!response.ok) return;

    const payload = (await response.json()) as { ownerToken?: string };
    if (payload.ownerToken) storeRemoteOwnerToken(payload.ownerToken);
  } catch {
    // Local autosave is the source of truth until a workspace endpoint exists.
  }
}

export function createWorkspaceState(state: Omit<PaletteWorkspaceState, "updatedAt"> & { updatedAt?: string }) {
  return {
    project: state.project,
    selectedId: validSelectedId(state.project, state.selectedId),
    buildProjectId: normalizeBuildProjectId(state.buildProjectId),
    brief: normalizeBrief(state.brief),
    notes: normalizeNotes(state.notes),
    submissions: normalizeSubmissions(state.submissions),
    savedProjects: normalizeSavedProjects(state.savedProjects),
    updatedAt: state.updatedAt ?? new Date().toISOString(),
  };
}

export function createPinnedNote(text: string, target?: PaletteSectionModel): PalettePinnedNote {
  const now = new Date().toISOString();
  return {
    id: uniqueId("note"),
    text: text.trim().slice(0, 360),
    targetId: target?.id,
    targetKind: target?.kind,
    includeInContext: true,
    createdAt: now,
    updatedAt: now,
  };
}

export function createSubmission(
  project: PaletteProject,
  section: PaletteSectionModel,
  values: Record<string, FormDataEntryValue>,
): PaletteSubmission {
  const normalized = Object.fromEntries(
    Object.entries(values).map(([key, value]) => [key, String(value).trim()]),
  );
  const title = section.title || section.kind;
  const isContact = section.kind === "form" || title.toLowerCase().includes("contact");

  return {
    id: uniqueId("submission"),
    kind: section.hasWaitlist ? "waitlist" : isContact ? "contact" : "form",
    sectionId: section.id,
    sectionKind: section.kind,
    sectionTitle: title,
    projectId: project.id,
    projectName: project.name,
    values: normalized,
    createdAt: new Date().toISOString(),
  };
}

export function withWorkspaceContext(
  project: PaletteProject,
  notes: PalettePinnedNote[],
  submissions: PaletteSubmission[],
): PaletteProject {
  return {
    ...project,
    workspace: {
      pinnedNotes: notes
        .filter((note) => note.includeInContext)
        .map(({ id, text, targetId, targetKind, updatedAt }) => ({
          id,
          text,
          targetId,
          targetKind,
          updatedAt,
        })),
      submissionCount: submissions.length,
    },
  } as PaletteProject;
}

export function saveProjectToShelf(
  project: PaletteProject,
  notes: PalettePinnedNote[],
  submissions: PaletteSubmission[],
  savedProjects: SavedPaletteProject[],
) {
  const now = new Date().toISOString();
  const projectId = project.id && project.id !== "palette-project" ? project.id : uniqueId("project");
  const nextProject = { ...project, id: projectId };
  const saved: SavedPaletteProject = {
    id: projectId,
    name: nextProject.name || "Untitled canvas",
    updatedAt: now,
    project: nextProject,
    notes,
    submissions,
  };

  return {
    project: nextProject,
    savedProjects: [saved, ...savedProjects.filter((item) => item.id !== projectId)].slice(0, maxSavedProjects),
  };
}

export async function fileToPersistentSwatch(file: File): Promise<PersistentSwatch> {
  const dataUrl = await readPersistentImage(file);
  const title = file.name?.replace(/\.[^.]+$/, "") || "Clipboard reference";

  return {
    id: uniqueId("swatch"),
    title,
    note: "Persistent visual reference.",
    url: dataUrl,
    colors: [],
    createdAt: new Date().toISOString(),
    source: file.name ? "upload" : "clipboard",
    originalName: file.name || undefined,
  };
}

export function createSubmissionsCsv(submissions: PaletteSubmission[]): string {
  const keys = Array.from(
    new Set(submissions.flatMap((submission) => Object.keys(submission.values))),
  );
  const header = ["createdAt", "kind", "projectName", "sectionTitle", ...keys];
  const rows = submissions.map((submission) =>
    header.map((key) => {
      if (key in submission.values) return csvCell(submission.values[key]);
      return csvCell(String(submission[key as keyof PaletteSubmission] ?? ""));
    }).join(","),
  );

  return [header.map(csvCell).join(","), ...rows].join("\n");
}

export function createHandoffBundle(
  project: PaletteProject,
  notes: PalettePinnedNote[],
  submissions: PaletteSubmission[],
): string {
  const exportBundle = JSON.parse(createExportBundle(withWorkspaceContext(project, notes, submissions))) as {
    files?: Array<{ path: string; content: string }>;
  };

  return JSON.stringify(
    {
      name: project.name,
      projectId: project.id,
      generatedAt: new Date().toISOString(),
      note: "Palette handoff bundle. This can be downloaded without Codex and reopened by a builder later.",
      project: withWorkspaceContext(project, notes, submissions),
      pinnedNotes: notes,
      references: project.swatches,
      submissions,
      files: exportBundle.files ?? [],
    },
    null,
    2,
  );
}

function normalizeProject(project: PaletteProject, fallback: PaletteProject): PaletteProject {
  return {
    ...fallback,
    ...project,
    sections: Array.isArray(project.sections) ? project.sections : [],
    swatches: Array.isArray(project.swatches) ? project.swatches : [],
    brushLog: Array.isArray(project.brushLog) ? project.brushLog : fallback.brushLog,
    past: Array.isArray(project.past) ? project.past : [],
    future: Array.isArray(project.future) ? project.future : [],
  };
}

function normalizeNotes(notes: unknown): PalettePinnedNote[] {
  if (!Array.isArray(notes)) return [];
  return notes
    .filter((note): note is Partial<PalettePinnedNote> => typeof note?.text === "string")
    .map((note) => {
      const now = new Date().toISOString();
      return {
        id: typeof note.id === "string" ? note.id : uniqueId("note"),
        text: note.text!.slice(0, 360),
        targetId: typeof note.targetId === "string" ? note.targetId : undefined,
        targetKind: typeof note.targetKind === "string" ? note.targetKind : undefined,
        includeInContext: note.includeInContext !== false,
        createdAt: typeof note.createdAt === "string" ? note.createdAt : now,
        updatedAt: typeof note.updatedAt === "string" ? note.updatedAt : now,
      };
    });
}

function normalizeSubmissions(submissions: unknown): PaletteSubmission[] {
  if (!Array.isArray(submissions)) return [];
  return submissions
    .filter((submission): submission is Partial<PaletteSubmission> => typeof submission?.sectionId === "string")
    .map((submission) => ({
      id: typeof submission.id === "string" ? submission.id : uniqueId("submission"),
      kind:
        submission.kind === "waitlist" || submission.kind === "contact" || submission.kind === "form"
          ? submission.kind
          : "form",
      sectionId: submission.sectionId!,
      sectionKind: typeof submission.sectionKind === "string" ? submission.sectionKind : "section",
      sectionTitle: typeof submission.sectionTitle === "string" ? submission.sectionTitle : "Untitled section",
      projectId: typeof submission.projectId === "string" ? submission.projectId : "palette-project",
      projectName: typeof submission.projectName === "string" ? submission.projectName : "Untitled canvas",
      values: normalizeSubmissionValues(submission.values),
      createdAt: typeof submission.createdAt === "string" ? submission.createdAt : new Date().toISOString(),
    }));
}

function normalizeSavedProjects(savedProjects: unknown): SavedPaletteProject[] {
  if (!Array.isArray(savedProjects)) return [];
  return savedProjects
    .filter((saved): saved is Partial<SavedPaletteProject> => Boolean(saved?.project))
    .map((saved) => ({
      id: typeof saved.id === "string" ? saved.id : uniqueId("project"),
      name: typeof saved.name === "string" ? saved.name : saved.project?.name ?? "Untitled canvas",
      updatedAt: typeof saved.updatedAt === "string" ? saved.updatedAt : new Date().toISOString(),
      project: saved.project as PaletteProject,
      notes: normalizeNotes(saved.notes),
      submissions: normalizeSubmissions(saved.submissions),
    }))
    .slice(0, maxSavedProjects);
}

function normalizeBrief(brief: unknown): PaletteWorkspaceBrief {
  if (!brief || typeof brief !== "object" || Array.isArray(brief)) return {};
  const source = brief as Partial<PaletteWorkspaceBrief>;
  return {
    product: cleanBodyText(source.product, 260),
    audience: cleanBodyText(source.audience, 240),
    feeling: cleanBodyText(source.feeling, 240),
    references: cleanBodyText(source.references, 400),
    avoid: cleanBodyText(source.avoid, 400),
    goal: cleanBodyText(source.goal, 280),
    rawAnswers: Array.isArray(source.rawAnswers)
      ? source.rawAnswers
          .map((answer) => cleanBodyText(answer, 500))
          .filter((answer): answer is string => Boolean(answer))
          .slice(0, 12)
      : [],
  };
}

function normalizeBuildProjectId(value: unknown) {
  if (typeof value !== "string") return null;
  const cleaned = value
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 100);
  return cleaned || null;
}

function normalizeSubmissionValues(values: unknown): Record<string, string> {
  if (!values || typeof values !== "object") return {};
  return Object.fromEntries(
    Object.entries(values).map(([key, value]) => [key, String(value).trim()]),
  );
}

function validSelectedId(project: PaletteProject, selectedId: unknown): string | null {
  if (typeof selectedId !== "string") return null;
  return project.sections.some((section) => section.id === selectedId) ? selectedId : null;
}

function readPersistentImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read the reference image."));
    reader.onload = () => {
      const dataUrl = String(reader.result ?? "");
      if (!dataUrl.startsWith("data:image/")) {
        reject(new Error("Reference image could not be stored."));
        return;
      }
      resolve(dataUrl);
    };
    reader.readAsDataURL(file);
  });
}

function csvCell(value: string) {
  return `"${value.replace(/"/g, '""')}"`;
}

function cleanBodyText(value: unknown, maxLength: number) {
  if (typeof value !== "string") return undefined;
  const cleaned = value.replace(/[<>`]/g, "").replace(/\s+/g, " ").trim().slice(0, maxLength);
  return cleaned || undefined;
}

function shouldUseRemoteWorkspaceStore() {
  if (import.meta.env.VITE_PALETTE_WORKSPACE_STORE === "0") return false;

  try {
    return window.localStorage.getItem("palette:workspace-store") !== "0";
  } catch {
    return true;
  }
}

function remoteOwnerToken() {
  try {
    return window.localStorage.getItem(workspaceOwnerTokenKey) || "";
  } catch {
    return "";
  }
}

function storeRemoteOwnerToken(ownerToken: string) {
  try {
    window.localStorage.setItem(workspaceOwnerTokenKey, ownerToken);
  } catch {
    // The local workspace save remains available when token storage is blocked.
  }
}

function uniqueId(prefix: string) {
  const cryptoId = globalThis.crypto?.randomUUID?.();
  return cryptoId ? `${prefix}-${cryptoId}` : `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
