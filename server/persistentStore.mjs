import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

const storeVersion = 1;
const allowedKinds = new Set([
  "nav",
  "hero",
  "features",
  "pricing",
  "cta",
  "footer",
  "testimonials",
  "stats",
  "form",
  "gallery",
  "note",
]);
const allowedThemes = new Set(["atelier", "premium"]);
const allowedVariants = new Set(["atelier", "premium", "playful", "minimal", "glass", "editorial"]);
const allowedImageTypes = new Map([
  ["image/png", "png"],
  ["image/jpeg", "jpg"],
  ["image/webp", "webp"],
  ["image/gif", "gif"],
]);

let writeQueue = Promise.resolve();

export async function createProjectRecord(payload, env = process.env) {
  const ownerToken = createOwnerToken();

  return mutateStore(env, (store) => {
    const id = nextProjectId(store, payload?.id || payload?.project?.id, payload?.project?.name || payload?.name);
    const now = nowIso();
    const project = normalizeProjectForStorage(payload?.project || {}, id, payload?.name);
    project.id = id;

    const record = {
      id,
      project,
      ownerTokenHash: hashToken(ownerToken),
      notes: [],
      assets: [],
      components: [],
      submissions: [],
      createdAt: now,
      updatedAt: now,
    };
    store.projects[id] = record;

    return projectResponse(record, ownerToken);
  });
}

export async function persistSavedProject(payload, env = process.env) {
  const requestedToken = cleanToken(payload?.ownerToken);
  const requestedId = cleanId(payload?.projectId || payload?.id || payload?.project?.id);
  let ownerToken = requestedToken || createOwnerToken();

  return mutateStore(env, (store) => {
    const existing = requestedId ? store.projects[requestedId] : null;

    if (existing && requestedToken && isOwner(existing, requestedToken)) {
      const nextProject = normalizeProjectForStorage(payload?.project || {}, existing.id, payload?.project?.name);
      nextProject.id = existing.id;
      existing.project = nextProject;
      existing.updatedAt = nowIso();
      ownerToken = requestedToken;
      return projectResponse(existing, ownerToken);
    }

    const id = nextProjectId(store, payload?.project?.id, payload?.project?.name);
    const now = nowIso();
    const project = normalizeProjectForStorage(payload?.project || {}, id, payload?.project?.name);
    project.id = id;

    const record = {
      id,
      project,
      ownerTokenHash: hashToken(ownerToken),
      notes: extractNoteSections(project),
      assets: [],
      components: [],
      submissions: [],
      createdAt: now,
      updatedAt: now,
    };
    store.projects[id] = record;

    return projectResponse(record, ownerToken);
  });
}

export async function loadProjectRecord(projectId, ownerToken, env = process.env) {
  const record = await requireProject(projectId, env);
  requireOwner(record, ownerToken);
  return projectResponse(record);
}

export async function updateProjectRecord(projectId, payload, ownerToken, env = process.env) {
  return mutateStore(env, (store) => {
    const record = requireProjectFromStore(store, projectId);
    requireOwner(record, ownerToken);
    const nextProject = normalizeProjectForStorage(payload?.project || payload, record.id, record.project.name);
    nextProject.id = record.id;
    record.project = nextProject;
    record.updatedAt = nowIso();
    return projectResponse(record);
  });
}

export async function listProjectNotes(projectId, ownerToken, env = process.env) {
  const record = await requireProject(projectId, env);
  requireOwner(record, ownerToken);
  return {
    projectId: record.id,
    notes: record.notes.map(publicNote),
  };
}

export async function addProjectNote(projectId, payload, ownerToken, env = process.env) {
  return mutateStore(env, (store) => {
    const record = requireProjectFromStore(store, projectId);
    requireOwner(record, ownerToken);
    const text = cleanText(payload?.text || payload?.note || payload?.subtitle, 1200);
    if (!text) throw httpError(400, "Note text is required.");

    const note = {
      id: createId("note"),
      title: cleanText(payload?.title, 100) || "Studio note",
      text,
      sectionId: cleanId(payload?.sectionId),
      createdAt: nowIso(),
    };
    record.notes.unshift(dropEmpty(note));
    record.notes = record.notes.slice(0, 200);
    record.updatedAt = nowIso();
    return {
      projectId: record.id,
      note: publicNote(note),
    };
  });
}

export async function listProjectAssets(projectId, ownerToken, env = process.env) {
  const record = await requireProject(projectId, env);
  requireOwner(record, ownerToken);
  return {
    projectId: record.id,
    assets: record.assets.map(publicAsset),
  };
}

export async function addProjectAsset(projectId, input, ownerToken, env = process.env) {
  const record = await requireProject(projectId, env);
  requireOwner(record, ownerToken);

  const buffer = input.buffer;
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) throw httpError(400, "Asset file data is required.");
  if (buffer.length > 12_000_000) throw httpError(413, "Asset is too large.");

  const contentType = cleanContentType(input.contentType);
  const extension = allowedImageTypes.get(contentType);
  if (!extension) throw httpError(415, "Expected a PNG, JPEG, WebP, or GIF image.");

  const workspace = workspaceRoot(env);
  const assetId = createId("asset");
  const assetRel = normalizeStorePath(path.join(".palette", "assets", cleanId(projectId), `${assetId}.${extension}`));
  const assetPath = inside(workspace, assetRel);
  await mkdir(path.dirname(assetPath), { recursive: true });
  await writeFile(assetPath, buffer);

  return mutateStore(env, (store) => {
    const record = requireProjectFromStore(store, projectId);
    requireOwner(record, ownerToken);
    const asset = {
      id: assetId,
      projectId: record.id,
      fileName: cleanFileName(input.fileName) || `${assetId}.${extension}`,
      title: cleanText(input.title, 100),
      kind: cleanText(input.kind, 40) || "image",
      contentType,
      bytes: buffer.length,
      sha256: createHash("sha256").update(buffer).digest("hex"),
      path: assetRel,
      url: `/api/assets/${assetId}?projectId=${encodeURIComponent(record.id)}`,
      createdAt: nowIso(),
    };
    record.assets.unshift(dropEmpty(asset));
    record.assets = record.assets.slice(0, 200);
    record.updatedAt = nowIso();
    return {
      projectId: record.id,
      asset: publicAsset(asset),
    };
  });
}

export async function getAssetFile(projectId, assetId, env = process.env) {
  const record = await requireProject(projectId, env);
  const asset = record.assets.find((item) => item.id === cleanId(assetId));
  if (!asset) throw httpError(404, "Asset not found.");

  return {
    contentType: asset.contentType,
    fileName: asset.fileName,
    buffer: await readFile(inside(workspaceRoot(env), asset.path)),
  };
}

export async function listProjectComponents(projectId, ownerToken, env = process.env) {
  const record = await requireProject(projectId, env);
  requireOwner(record, ownerToken);
  return {
    projectId: record.id,
    components: record.components.map(publicComponent),
  };
}

export async function upsertProjectComponent(projectId, componentId, payload, ownerToken, env = process.env) {
  return mutateStore(env, (store) => {
    const record = requireProjectFromStore(store, projectId);
    requireOwner(record, ownerToken);
    const id = cleanId(componentId || payload?.id) || createId("component");
    const now = nowIso();
    const component = {
      id,
      name: cleanText(payload?.name, 100) || cleanText(payload?.title, 100) || "Live component",
      kind: cleanText(payload?.kind || payload?.type, 60) || "component",
      sectionId: cleanId(payload?.sectionId),
      status: cleanText(payload?.status, 80) || "live",
      props: sanitizeFreeJson(payload?.props || payload?.state || {}, 40),
      source: cleanText(payload?.source, 20_000),
      createdAt: now,
      updatedAt: now,
    };

    const index = record.components.findIndex((item) => item.id === id);
    if (index >= 0) {
      component.createdAt = record.components[index].createdAt;
      record.components[index] = dropEmpty(component);
    } else {
      record.components.unshift(dropEmpty(component));
    }
    record.components = record.components.slice(0, 120);
    record.updatedAt = now;

    return {
      projectId: record.id,
      component: publicComponent(component),
    };
  });
}

export async function addProjectSubmission(projectId, payload, requestMeta = {}, env = process.env) {
  return mutateStore(env, (store) => {
    const record = requireProjectFromStore(store, projectId);
    const values = sanitizeSubmissionValues(payload?.values || payload?.fields || payload || {});
    if (Object.keys(values).length === 0) throw httpError(400, "Submission values are required.");

    const kind = cleanSubmissionKind(payload?.kind || payload?.type || inferSubmissionKind(record, payload));
    const submission = {
      id: createId("submission"),
      projectId: record.id,
      kind,
      sectionId: cleanId(payload?.sectionId),
      componentId: cleanId(payload?.componentId),
      values,
      meta: requestMetaForStorage(requestMeta),
      submittedAt: nowIso(),
    };
    record.submissions.unshift(dropEmpty(submission));
    record.submissions = record.submissions.slice(0, 2000);
    record.updatedAt = nowIso();

    return {
      stored: true,
      projectId: record.id,
      submission: publicSubmission(submission),
    };
  });
}

export async function listProjectSubmissions(projectId, ownerToken, env = process.env) {
  const record = await requireProject(projectId, env);
  requireOwner(record, ownerToken);
  return {
    projectId: record.id,
    submissions: record.submissions.map(publicSubmission),
  };
}

export async function submissionsCsv(projectId, ownerToken, env = process.env) {
  const record = await requireProject(projectId, env);
  requireOwner(record, ownerToken);
  return submissionsToCsv(record.submissions);
}

export async function handoffArtifact(projectId, ownerToken, env = process.env) {
  const record = await requireProject(projectId, env);
  requireOwner(record, ownerToken);

  return {
    kind: "palette-handoff",
    version: storeVersion,
    generatedAt: nowIso(),
    project: record.project,
    notes: record.notes.map(publicNote),
    assets: record.assets.map(publicAsset),
    components: record.components.map(publicComponent),
    submissions: record.submissions.map(publicSubmission),
    files: [
      {
        path: "palette-project.json",
        contentType: "application/json",
        content: JSON.stringify(record.project, null, 2),
      },
      {
        path: "palette-notes.json",
        contentType: "application/json",
        content: JSON.stringify(record.notes.map(publicNote), null, 2),
      },
      {
        path: "palette-submissions.csv",
        contentType: "text/csv",
        content: submissionsToCsv(record.submissions),
      },
    ],
  };
}

export async function listProjectSummaries(ownerToken, env = process.env) {
  const store = await readStore(env);
  if (!isAdmin(ownerToken, env)) throw httpError(401, "Admin token required.");

  return {
    projects: Object.values(store.projects)
      .map((record) => ({
        id: record.id,
        name: record.project.name,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
        notes: record.notes.length,
        assets: record.assets.length,
        submissions: record.submissions.length,
      }))
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)),
  };
}

export function assetInputFromJson(payload) {
  const dataUrl = typeof payload?.dataUrl === "string" ? payload.dataUrl : "";
  if (dataUrl) {
    const match = dataUrl.match(/^data:([^;,]+);base64,(.+)$/i);
    if (!match) throw httpError(400, "Invalid dataUrl asset payload.");
    return {
      buffer: Buffer.from(match[2], "base64"),
      contentType: match[1].toLowerCase(),
      fileName: payload?.fileName,
      title: payload?.title,
      kind: payload?.kind,
    };
  }

  const base64 = typeof payload?.base64 === "string" ? payload.base64 : "";
  if (!base64) throw httpError(400, "Asset payload needs dataUrl or base64.");
  return {
    buffer: Buffer.from(base64, "base64"),
    contentType: payload?.contentType,
    fileName: payload?.fileName,
    title: payload?.title,
    kind: payload?.kind,
  };
}

function projectResponse(record, ownerToken) {
  return dropEmpty({
    id: record.id,
    projectId: record.id,
    project: record.project,
    ownerToken,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    counts: {
      notes: record.notes.length,
      assets: record.assets.length,
      components: record.components.length,
      submissions: record.submissions.length,
    },
  });
}

async function requireProject(projectId, env) {
  const store = await readStore(env);
  return requireProjectFromStore(store, projectId);
}

function requireProjectFromStore(store, projectId) {
  const id = cleanId(projectId);
  const record = id ? store.projects[id] : null;
  if (!record) throw httpError(404, "Project not found.");
  return record;
}

function requireOwner(record, ownerToken) {
  if (!isOwner(record, ownerToken)) throw httpError(401, "Owner token required.");
}

function isOwner(record, ownerToken) {
  const token = cleanToken(ownerToken);
  if (!token || !record?.ownerTokenHash) return false;
  const actual = Buffer.from(hashToken(token), "hex");
  const expected = Buffer.from(record.ownerTokenHash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function isAdmin(ownerToken, env) {
  const adminToken = cleanToken(env.PALETTE_ADMIN_TOKEN);
  const token = cleanToken(ownerToken);
  if (!adminToken || !token) return false;
  const actual = Buffer.from(hashToken(token), "hex");
  const expected = Buffer.from(hashToken(adminToken), "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function nextProjectId(store, requestedId, name) {
  const preferred = cleanId(requestedId);
  if (preferred && preferred !== "palette-project" && !store.projects[preferred]) return preferred;

  const base = slug(name || requestedId || "palette-project");
  let candidate = `${base}-${randomBytes(3).toString("hex")}`;
  while (store.projects[candidate]) candidate = `${base}-${randomBytes(3).toString("hex")}`;
  return candidate;
}

async function mutateStore(env, mutator) {
  const run = writeQueue.then(async () => {
    const store = await readStore(env);
    const result = await mutator(store);
    await writeStore(env, store);
    return result;
  });
  writeQueue = run.catch(() => undefined);
  return run;
}

async function readStore(env) {
  const file = storePath(env);
  try {
    const raw = await readFile(file, "utf8");
    const parsed = JSON.parse(raw);
    return normalizeStore(parsed);
  } catch (error) {
    if (error?.code === "ENOENT") return emptyStore();
    if (error instanceof SyntaxError) throw httpError(500, "Palette store JSON is corrupt.");
    throw error;
  }
}

async function writeStore(env, store) {
  const file = storePath(env);
  await mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temp, JSON.stringify(normalizeStore(store), null, 2), "utf8");
  await rename(temp, file);
}

function normalizeStore(store) {
  return {
    version: storeVersion,
    projects: store && typeof store.projects === "object" && !Array.isArray(store.projects) ? store.projects : {},
  };
}

function emptyStore() {
  return {
    version: storeVersion,
    projects: {},
  };
}

function storePath(env) {
  return inside(workspaceRoot(env), ".palette/store.json");
}

function workspaceRoot(env) {
  return path.resolve(env.PALETTE_WORKSPACE || process.cwd());
}

function normalizeProjectForStorage(project, fallbackId, fallbackName) {
  const source = project && typeof project === "object" && !Array.isArray(project) ? project : {};
  const sections = Array.isArray(source.sections)
    ? source.sections.map(sanitizeSection).filter(Boolean).slice(0, 80)
    : [];

  return {
    id: cleanId(source.id) || fallbackId,
    name: cleanText(source.name || fallbackName, 120) || "Untitled canvas",
    theme: allowedThemes.has(source.theme) ? source.theme : "atelier",
    swatchAccent: cleanColor(source.swatchAccent),
    swatchColors: Array.isArray(source.swatchColors) ? source.swatchColors.map(cleanColor).filter(Boolean).slice(0, 8) : undefined,
    sections,
    swatches: sanitizeSwatches(source.swatches),
    brushLog: sanitizeBrushLog(source.brushLog),
    past: [],
    future: [],
  };
}

function sanitizeSection(section) {
  if (!section || typeof section !== "object" || !allowedKinds.has(section.kind)) return null;
  return dropEmpty({
    id: cleanId(section.id) || createId(section.kind),
    kind: section.kind,
    title: cleanText(section.title, 160) || `${section.kind} section`,
    subtitle: cleanText(section.subtitle, 500),
    eyebrow: cleanText(section.eyebrow, 120),
    variant: allowedVariants.has(section.variant) ? section.variant : undefined,
    titleSizeBoost:
      typeof section.titleSizeBoost === "number" && Number.isFinite(section.titleSizeBoost)
        ? Math.max(0, Math.min(32, section.titleSizeBoost))
        : undefined,
    imageUrl: cleanHref(section.imageUrl),
    imageAlt: cleanText(section.imageAlt, 120),
    hasWaitlist: typeof section.hasWaitlist === "boolean" ? section.hasWaitlist : undefined,
    links: sanitizeRecordList(section.links, 16),
    actions: sanitizeRecordList(section.actions, 12),
    features: sanitizeRecordList(section.features, 24),
    plans: sanitizeRecordList(section.plans, 12),
    testimonials: sanitizeRecordList(section.testimonials, 12),
    stats: sanitizeRecordList(section.stats, 16),
    fields: sanitizeRecordList(section.fields, 16),
    gallery: sanitizeRecordList(section.gallery, 24),
    footerText: cleanText(section.footerText, 300),
  });
}

function sanitizeRecordList(value, max) {
  if (!Array.isArray(value)) return undefined;
  const list = value.slice(0, max).map((item) => sanitizeFreeJson(item, 4)).filter((item) => Object.keys(item).length > 0);
  return list.length > 0 ? list : undefined;
}

function sanitizeSwatches(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 80).map((swatch) => dropEmpty({
    id: cleanId(swatch?.id) || createId("swatch"),
    title: cleanText(swatch?.title, 120) || "Reference",
    note: cleanText(swatch?.note, 500),
    url: cleanHref(swatch?.url),
    tone: ["paper", "glass", "ink"].includes(swatch?.tone) ? swatch.tone : undefined,
    colors: Array.isArray(swatch?.colors) ? swatch.colors.map(cleanColor).filter(Boolean).slice(0, 8) : undefined,
  }));
}

function sanitizeBrushLog(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 50).map((entry) => dropEmpty({
    id: cleanId(entry?.id) || createId("log"),
    label: cleanText(entry?.label, 120),
    detail: cleanText(entry?.detail, 500),
  })).filter((entry) => entry.label || entry.detail);
}

function extractNoteSections(project) {
  return project.sections
    .filter((section) => section.kind === "note")
    .map((section) => dropEmpty({
      id: cleanId(section.id) || createId("note"),
      title: section.title || "Studio note",
      text: section.subtitle || section.footerText || "",
      sectionId: cleanId(section.eyebrow?.replace(/^Pinned to /i, "")),
      createdAt: nowIso(),
    }))
    .filter((note) => note.text);
}

function sanitizeFreeJson(value, maxDepth) {
  if (maxDepth <= 0) return {};
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};

  const cleaned = {};
  for (const [key, raw] of Object.entries(value).slice(0, 80)) {
    const safeKey = cleanJsonKey(key);
    if (!safeKey) continue;
    if (typeof raw === "string") cleaned[safeKey] = cleanText(raw, 1200);
    if (typeof raw === "number" && Number.isFinite(raw)) cleaned[safeKey] = raw;
    if (typeof raw === "boolean") cleaned[safeKey] = raw;
    if (Array.isArray(raw)) {
      cleaned[safeKey] = raw
        .slice(0, 40)
        .map((item) => sanitizeFreeJsonValue(item, maxDepth - 1))
        .filter((item) => item !== undefined);
    }
    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
      const nested = sanitizeFreeJson(raw, maxDepth - 1);
      if (Object.keys(nested).length > 0) cleaned[safeKey] = nested;
    }
  }
  return cleaned;
}

function sanitizeFreeJsonValue(value, maxDepth) {
  if (typeof value === "string") return cleanText(value, 1200);
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "boolean") return value;
  if (value && typeof value === "object" && !Array.isArray(value)) return sanitizeFreeJson(value, maxDepth);
  return undefined;
}

function sanitizeSubmissionValues(value) {
  return sanitizeFreeJson(value, 4);
}

function inferSubmissionKind(record, payload) {
  const sectionId = cleanId(payload?.sectionId);
  const section = sectionId ? record.project.sections.find((item) => item.id === sectionId) : null;
  if (section?.hasWaitlist) return "waitlist";
  if (section?.kind === "form" && /contact/i.test(section.title)) return "contact";
  if (section?.kind === "form") return "form";
  return "submission";
}

function cleanSubmissionKind(value) {
  const kind = cleanText(value, 40).toLowerCase();
  if (["waitlist", "contact", "form", "component", "submission"].includes(kind)) return kind;
  return "submission";
}

function requestMetaForStorage(meta) {
  const ip = cleanText(meta?.ip, 160);
  return dropEmpty({
    userAgent: cleanText(meta?.userAgent, 400),
    origin: cleanText(meta?.origin, 240),
    ipHash: ip ? createHash("sha256").update(ip).digest("hex") : undefined,
  });
}

function submissionsToCsv(submissions) {
  const valueKeys = Array.from(new Set(submissions.flatMap((submission) => Object.keys(submission.values || {})))).sort();
  const columns = ["id", "submittedAt", "kind", "projectId", "sectionId", "componentId", ...valueKeys];
  const rows = [columns, ...submissions.map((submission) =>
    columns.map((column) => {
      if (column in (submission.values || {})) return submission.values[column];
      return submission[column] ?? "";
    })
  )];
  return `${rows.map((row) => row.map(csvCell).join(",")).join("\n")}\n`;
}

function csvCell(value) {
  if (value === null || value === undefined) return "";
  const text = typeof value === "object" ? JSON.stringify(value) : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

function publicNote(note) {
  return dropEmpty({
    id: note.id,
    title: note.title,
    text: note.text,
    sectionId: note.sectionId,
    createdAt: note.createdAt,
  });
}

function publicAsset(asset) {
  return dropEmpty({
    id: asset.id,
    projectId: asset.projectId,
    fileName: asset.fileName,
    title: asset.title,
    kind: asset.kind,
    contentType: asset.contentType,
    bytes: asset.bytes,
    sha256: asset.sha256,
    path: asset.path,
    url: asset.url,
    createdAt: asset.createdAt,
  });
}

function publicComponent(component) {
  return dropEmpty({
    id: component.id,
    name: component.name,
    kind: component.kind,
    sectionId: component.sectionId,
    status: component.status,
    props: component.props,
    source: component.source,
    createdAt: component.createdAt,
    updatedAt: component.updatedAt,
  });
}

function publicSubmission(submission) {
  return dropEmpty({
    id: submission.id,
    projectId: submission.projectId,
    kind: submission.kind,
    sectionId: submission.sectionId,
    componentId: submission.componentId,
    values: submission.values,
    meta: submission.meta,
    submittedAt: submission.submittedAt,
  });
}

function createOwnerToken() {
  return randomBytes(24).toString("base64url");
}

function hashToken(token) {
  return createHash("sha256").update(token).digest("hex");
}

function createId(prefix) {
  return `${slug(prefix || "item")}-${randomBytes(6).toString("hex")}`;
}

function nowIso() {
  return new Date().toISOString();
}

function cleanId(value) {
  if (typeof value !== "string") return "";
  return value.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 100);
}

function cleanToken(value) {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, 200);
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

function cleanJsonKey(value) {
  if (typeof value !== "string") return "";
  return value.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80);
}

function cleanColor(value) {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value) ? value : undefined;
}

function cleanHref(value) {
  if (typeof value !== "string" || value.length > 500) return undefined;
  if (value.startsWith("#") || value.startsWith("/") || /^https?:\/\//i.test(value)) return cleanText(value, 500);
  return undefined;
}

function cleanContentType(value) {
  if (typeof value !== "string") return "";
  return value.split(";")[0].trim().toLowerCase();
}

function cleanFileName(value) {
  if (typeof value !== "string") return "";
  const base = path.basename(value).replace(/[^a-zA-Z0-9._-]/g, "-").slice(0, 120);
  return base.replace(/^-+|-+$/g, "");
}

function slug(value) {
  const cleaned = cleanText(value, 80)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return cleaned || "palette-project";
}

function dropEmpty(value) {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => {
      if (item === undefined || item === "") return false;
      if (Array.isArray(item) && item.length === 0) return false;
      if (item && typeof item === "object" && !Array.isArray(item) && Object.keys(item).length === 0) return false;
      return true;
    }),
  );
}

function normalizeStorePath(value) {
  return value.replace(/\\/g, "/");
}

function inside(root, relativePath) {
  const resolved = path.resolve(root, relativePath);
  if (!resolved.toLowerCase().startsWith(root.toLowerCase() + path.sep)) {
    throw httpError(400, "Resolved path escaped the workspace.");
  }
  return resolved;
}

function httpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}
