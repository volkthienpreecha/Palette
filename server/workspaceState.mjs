import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

const stateVersion = 1;
const maxBodyText = 1_200;
let writeQueue = Promise.resolve();

export async function loadWorkspaceState(ownerToken, env = process.env) {
  const store = await readWorkspaceStore(env);
  return {
    state: store.state,
    updatedAt: store.updatedAt,
  };
}

export async function saveWorkspaceState(payload, ownerToken, env = process.env) {
  return mutateWorkspaceStore(env, (store) => {
    const now = new Date().toISOString();
    let nextOwnerToken;

    if (!store.ownerTokenHash) {
      nextOwnerToken = createOwnerToken();
      store.ownerTokenHash = hashToken(nextOwnerToken);
      store.createdAt = now;
    }

    store.version = stateVersion;
    store.updatedAt = now;
    store.state = sanitizeWorkspaceState(payload, now);

    return {
      saved: true,
      source: "workspace-store",
      status: "Workspace saved to the Palette backend.",
      ownerToken: nextOwnerToken,
      state: store.state,
      updatedAt: store.updatedAt,
    };
  });
}

async function mutateWorkspaceStore(env, mutator) {
  const run = writeQueue.then(async () => {
    const store = await readWorkspaceStore(env);
    const result = mutator(store);
    await writeWorkspaceStore(env, store);
    return result;
  });
  writeQueue = run.catch(() => undefined);
  return run;
}

async function readWorkspaceStore(env) {
  const file = workspaceStatePath(env);
  try {
    const raw = await readFile(file, "utf8");
    const parsed = JSON.parse(raw);
    return normalizeStore(parsed);
  } catch (error) {
    if (error?.code === "ENOENT") return emptyStore();
    if (error instanceof SyntaxError) throw httpError(500, "Workspace state file is corrupt.");
    throw error;
  }
}

async function writeWorkspaceStore(env, store) {
  const file = workspaceStatePath(env);
  await mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temp, JSON.stringify(normalizeStore(store), null, 2), "utf8");
  await rename(temp, file);
}

function normalizeStore(store) {
  return {
    version: stateVersion,
    ownerTokenHash: typeof store?.ownerTokenHash === "string" ? store.ownerTokenHash : "",
    createdAt: typeof store?.createdAt === "string" ? store.createdAt : undefined,
    updatedAt: typeof store?.updatedAt === "string" ? store.updatedAt : undefined,
    state: sanitizeWorkspaceState(store?.state, store?.updatedAt || new Date().toISOString()),
  };
}

function emptyStore() {
  return {
    version: stateVersion,
    ownerTokenHash: "",
    createdAt: undefined,
    updatedAt: undefined,
    state: sanitizeWorkspaceState({}, new Date().toISOString()),
  };
}

function sanitizeWorkspaceState(payload, now) {
  const state = payload && typeof payload === "object" && !Array.isArray(payload) ? payload : {};
  const project = sanitizeProject(state.project);
  const savedProjects = Array.isArray(state.savedProjects)
    ? state.savedProjects.slice(0, 12).map((saved) => sanitizeSavedProject(saved)).filter(Boolean)
    : [];

  return {
    project,
    selectedId: validSelectedId(project, state.selectedId),
    buildProjectId: cleanBuildProjectId(state.buildProjectId) || null,
    brief: sanitizeBrief(state.brief),
    notes: sanitizeNotes(state.notes),
    submissions: sanitizeSubmissions(state.submissions),
    savedProjects,
    updatedAt: typeof state.updatedAt === "string" ? state.updatedAt : now,
  };
}

function sanitizeSavedProject(saved) {
  if (!saved || typeof saved !== "object" || !saved.project) return null;
  const project = sanitizeProject(saved.project);
  return {
    id: cleanId(saved.id) || project.id,
    name: cleanText(saved.name || project.name, 120) || "Untitled canvas",
    updatedAt: typeof saved.updatedAt === "string" ? saved.updatedAt : new Date().toISOString(),
    project,
    notes: sanitizeNotes(saved.notes),
    submissions: sanitizeSubmissions(saved.submissions),
  };
}

function sanitizeBrief(brief) {
  const source = brief && typeof brief === "object" && !Array.isArray(brief) ? brief : {};
  return {
    product: cleanText(source.product, 260) || undefined,
    audience: cleanText(source.audience, 240) || undefined,
    feeling: cleanText(source.feeling, 240) || undefined,
    references: cleanText(source.references, 400) || undefined,
    avoid: cleanText(source.avoid, 400) || undefined,
    goal: cleanText(source.goal, 280) || undefined,
    rawAnswers: Array.isArray(source.rawAnswers)
      ? source.rawAnswers.map((answer) => cleanText(answer, 500)).filter(Boolean).slice(0, 12)
      : [],
  };
}

function sanitizeProject(project) {
  const source = project && typeof project === "object" && !Array.isArray(project) ? project : {};
  return {
    ...source,
    id: cleanId(source.id) || "palette-project",
    name: cleanText(source.name, 120) || "Untitled canvas",
    theme: source.theme === "premium" ? "premium" : "atelier",
    sections: Array.isArray(source.sections) ? source.sections.slice(0, 90).map(sanitizeLooseRecord) : [],
    swatches: sanitizeSwatches(source.swatches),
    brushLog: Array.isArray(source.brushLog) ? source.brushLog.slice(0, 50).map(sanitizeLooseRecord) : [],
    past: [],
    future: [],
    exportText: undefined,
  };
}

function sanitizeSwatches(swatches) {
  if (!Array.isArray(swatches)) return [];
  return swatches.slice(0, 80).map((swatch) => ({
    ...sanitizeLooseRecord(swatch),
    id: cleanId(swatch?.id) || createId("swatch"),
    title: cleanText(swatch?.title, 120) || "Reference",
    note: cleanText(swatch?.note, 500),
    url: cleanReferenceUrl(swatch?.url),
    colors: Array.isArray(swatch?.colors)
      ? swatch.colors.filter((color) => /^#[0-9a-f]{6}$/i.test(color)).slice(0, 8)
      : [],
  }));
}

function sanitizeNotes(notes) {
  if (!Array.isArray(notes)) return [];
  return notes
    .slice(0, 200)
    .map((note) => ({
      id: cleanId(note?.id) || createId("note"),
      text: cleanText(note?.text, maxBodyText),
      targetId: cleanId(note?.targetId) || undefined,
      targetKind: cleanText(note?.targetKind, 60) || undefined,
      includeInContext: note?.includeInContext !== false,
      createdAt: typeof note?.createdAt === "string" ? note.createdAt : new Date().toISOString(),
      updatedAt: typeof note?.updatedAt === "string" ? note.updatedAt : new Date().toISOString(),
    }))
    .filter((note) => note.text);
}

function sanitizeSubmissions(submissions) {
  if (!Array.isArray(submissions)) return [];
  return submissions
    .slice(0, 2000)
    .map((submission) => ({
      id: cleanId(submission?.id) || createId("submission"),
      kind: ["waitlist", "contact", "form"].includes(submission?.kind) ? submission.kind : "form",
      sectionId: cleanId(submission?.sectionId),
      sectionKind: cleanText(submission?.sectionKind, 60) || "section",
      sectionTitle: cleanText(submission?.sectionTitle, 160) || "Untitled section",
      projectId: cleanId(submission?.projectId) || "palette-project",
      projectName: cleanText(submission?.projectName, 120) || "Untitled canvas",
      values: sanitizeValues(submission?.values),
      createdAt: typeof submission?.createdAt === "string" ? submission.createdAt : new Date().toISOString(),
    }))
    .filter((submission) => submission.sectionId && Object.keys(submission.values).length > 0);
}

function sanitizeValues(values) {
  if (!values || typeof values !== "object" || Array.isArray(values)) return {};
  return Object.fromEntries(
    Object.entries(values)
      .map(([key, value]) => [cleanKey(key), cleanText(String(value ?? ""), 500)])
      .filter(([key, value]) => key && value),
  );
}

function sanitizeLooseRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const cleaned = {};
  for (const [key, raw] of Object.entries(value).slice(0, 90)) {
    const safeKey = cleanKey(key);
    if (!safeKey) continue;
    if (typeof raw === "string") cleaned[safeKey] = raw.startsWith("data:image/") ? cleanReferenceUrl(raw) : cleanText(raw, 1500);
    if (typeof raw === "number" && Number.isFinite(raw)) cleaned[safeKey] = raw;
    if (typeof raw === "boolean") cleaned[safeKey] = raw;
    if (Array.isArray(raw)) cleaned[safeKey] = raw.slice(0, 30).map(sanitizeLooseValue).filter((item) => item !== undefined);
    if (raw && typeof raw === "object" && !Array.isArray(raw)) cleaned[safeKey] = sanitizeLooseRecord(raw);
  }
  return cleaned;
}

function sanitizeLooseValue(value) {
  if (typeof value === "string") return value.startsWith("data:image/") ? cleanReferenceUrl(value) : cleanText(value, 1500);
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "boolean") return value;
  if (value && typeof value === "object" && !Array.isArray(value)) return sanitizeLooseRecord(value);
  return undefined;
}

function validSelectedId(project, selectedId) {
  const id = cleanId(selectedId);
  if (!id) return null;
  return project.sections.some((section) => section.id === id) ? id : null;
}

function workspaceStatePath(env) {
  return path.join(path.resolve(env.PALETTE_WORKSPACE || process.cwd()), ".palette", "workspace-state.json");
}

function createOwnerToken() {
  return `plt_ws_${randomBytes(24).toString("base64url")}`;
}

function hashToken(token) {
  return createHash("sha256").update(token).digest("hex");
}

function createId(prefix) {
  return `${prefix}-${randomBytes(6).toString("hex")}`;
}

function cleanText(value, maxLength) {
  if (typeof value !== "string") return "";
  return value
    .replace(/[<>`]/g, "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function cleanId(value) {
  if (typeof value !== "string") return "";
  return value.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 100);
}

function cleanBuildProjectId(value) {
  if (typeof value !== "string") return "";
  return value
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 100);
}

function cleanKey(value) {
  if (typeof value !== "string") return "";
  return value.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80);
}

function cleanReferenceUrl(value) {
  if (typeof value !== "string") return undefined;
  if (value.startsWith("data:image/")) return value.slice(0, 9_000_000);
  if (value.startsWith("/") || /^https?:\/\//i.test(value)) return cleanText(value, 1200);
  return undefined;
}

function httpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}
