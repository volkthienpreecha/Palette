import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

export const GENERATED_ALLOWED_FILES = [
  "src/generated/palette-project.json",
  "src/generated/PalettePage.tsx",
];

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

const compatibleAgents = ["codex", "claude-code", "cursor", "generic"];

export function buildAgentHandoffBundle(payload, options = {}) {
  const rawProject = payload?.project && typeof payload.project === "object" ? payload.project : payload;
  const project = normalizeProject(rawProject);
  const selectedId = cleanId(payload?.selectedId);
  const selectedSection = selectedId
    ? project.sections.find((section) => section.id === selectedId)
    : undefined;
  const allowedFiles = [...GENERATED_ALLOWED_FILES];
  const instruction = cleanText(payload?.instruction, 800) ||
    "Apply this Palette canvas to generated React files.";

  return dropUndefined({
    schemaVersion: "palette.handoff.v1",
    createdAt: options.createdAt || new Date().toISOString(),
    source: "palette",
    agent: {
      kind: "agnostic",
      requested: cleanAgent(payload?.agent || options.agent),
      compatibleWith: compatibleAgents,
    },
    task: {
      title: "Apply Palette canvas to generated React files",
      instruction,
      outputContract: {
        allowedFiles,
        projectJsonPath: "src/generated/palette-project.json",
        reactComponentPath: "src/generated/PalettePage.tsx",
        componentExport: "PalettePage",
      },
    },
    constraints: [
      "Treat the project model as the source of truth.",
      "Write only the allowed generated files.",
      "Do not edit package files, app shell files, server files, docs, or git metadata.",
      "Do not run destructive commands.",
      "Return a short summary of the files written.",
    ],
    allowedFiles,
    project,
    context: buildHandoffContext({
      rawProject,
      project,
      selectedId,
      selectedSection,
      payload,
    }),
  });
}

export async function createHandoffBundleFile(payload, env = process.env, options = {}) {
  const bundle = buildAgentHandoffBundle(payload, options);
  if (bundle.project.sections.length === 0) {
    throw httpError(400, "Handoff needs at least one painted section.");
  }

  const workspace = path.resolve(env.PALETTE_WORKSPACE || process.cwd());
  const paletteDir = inside(workspace, ".palette");
  await mkdir(paletteDir, { recursive: true });

  const runId = options.runId || new Date().toISOString().replace(/[:.]/g, "-");
  const filenamePrefix = cleanFilePrefix(options.filenamePrefix) || "handoff-";
  const handoffRel = `.palette/${filenamePrefix}${runId}.json`;
  const handoffPath = inside(workspace, handoffRel);
  await writeFile(handoffPath, JSON.stringify(bundle, null, 2), "utf8");

  return {
    created: true,
    source: "handoff-bundle",
    status: "Prepared an agent-neutral Palette handoff bundle.",
    handoff: handoffRel,
    files: [handoffRel],
    allowedFiles: bundle.allowedFiles,
    bundle,
  };
}

export function normalizeProject(project) {
  if (!project || typeof project !== "object") {
    throw httpError(400, "Expected a Palette project.");
  }

  const sections = Array.isArray(project.sections)
    ? project.sections.map(sanitizeSection).filter(Boolean).slice(0, 24)
    : [];

  return {
    id: cleanText(project.id, 80) || "palette-project",
    name: cleanText(project.name, 80) || "Palette project",
    theme: project.theme === "premium" ? "premium" : "atelier",
    swatchAccent: cleanColor(project.swatchAccent),
    swatchColors: Array.isArray(project.swatchColors)
      ? project.swatchColors.map(cleanColor).filter(Boolean).slice(0, 5)
      : undefined,
    sections,
  };
}

export function inside(root, relativePath) {
  const resolved = path.resolve(root, relativePath);
  if (!resolved.toLowerCase().startsWith(root.toLowerCase() + path.sep)) {
    throw httpError(400, "Resolved path escaped the workspace.");
  }
  return resolved;
}

export function cleanText(value, maxLength) {
  if (typeof value !== "string") return "";
  return value.replace(/[<>`]/g, "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

export function httpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function buildHandoffContext({ rawProject, project, selectedId, selectedSection, payload }) {
  return dropUndefined({
    selectedId: selectedId || undefined,
    selectedSection: selectedSection ? summarizeSection(selectedSection) : undefined,
    notes: handoffNotes(payload?.notes, project),
    references: handoffReferences(payload?.references, rawProject),
  });
}

function handoffNotes(notes, project) {
  const explicitNotes = Array.isArray(notes)
    ? notes.map((note) => sanitizeContextNote(note)).filter(Boolean)
    : [];
  const sectionNotes = project.sections
    .filter((section) => section.kind === "note")
    .map((section) => ({
      id: section.id,
      title: section.title,
      note: section.subtitle || section.footerText || "",
      pinnedTo: section.eyebrow,
    }))
    .filter((note) => note.note);

  return dedupeByIdOrText([...explicitNotes, ...sectionNotes]).slice(0, 12);
}

function handoffReferences(references, rawProject) {
  const source = Array.isArray(references)
    ? references
    : Array.isArray(rawProject?.swatches)
      ? rawProject.swatches
      : [];

  return source
    .map((reference) => sanitizeReference(reference))
    .filter(Boolean)
    .slice(0, 12);
}

function sanitizeContextNote(note) {
  if (typeof note === "string") {
    const cleaned = cleanText(note, 240);
    return cleaned ? { note: cleaned } : null;
  }
  if (!note || typeof note !== "object") return null;

  const cleaned = {
    id: cleanId(note.id),
    title: cleanText(note.title, 80),
    note: cleanText(note.note || note.subtitle || note.detail, 240),
    pinnedTo: cleanText(note.pinnedTo || note.eyebrow, 100),
  };

  return cleaned.note ? dropUndefined(cleaned) : null;
}

function sanitizeReference(reference) {
  if (!reference || typeof reference !== "object") return null;

  const cleaned = {
    id: cleanId(reference.id),
    title: cleanText(reference.title, 80),
    note: cleanText(reference.note || reference.subtitle || reference.detail, 220),
    url: cleanHref(reference.url),
    tone: ["paper", "glass", "ink"].includes(reference.tone) ? reference.tone : undefined,
    colors: Array.isArray(reference.colors)
      ? reference.colors.map(cleanColor).filter(Boolean).slice(0, 5)
      : undefined,
  };

  return cleaned.title || cleaned.note || cleaned.url ? dropUndefined(cleaned) : null;
}

function summarizeSection(section) {
  return dropUndefined({
    id: section.id,
    kind: section.kind,
    title: section.title,
    subtitle: section.subtitle,
    eyebrow: section.eyebrow,
    variant: section.variant,
  });
}

function sanitizeSection(section) {
  if (!section || typeof section !== "object" || !allowedKinds.has(section.kind)) return null;

  return dropUndefined({
    id: cleanId(section.id) || `${section.kind}-${Math.random().toString(16).slice(2, 8)}`,
    kind: section.kind,
    title: cleanText(section.title, 120) || `${section.kind} section`,
    subtitle: cleanText(section.subtitle, 220),
    eyebrow: cleanText(section.eyebrow, 80),
    variant: cleanText(section.variant, 40),
    titleSizeBoost:
      typeof section.titleSizeBoost === "number" && Number.isFinite(section.titleSizeBoost)
        ? Math.max(0, Math.min(24, section.titleSizeBoost))
        : undefined,
    imageUrl: cleanHref(section.imageUrl),
    imageAlt: cleanText(section.imageAlt, 80),
    hasWaitlist: typeof section.hasWaitlist === "boolean" ? section.hasWaitlist : undefined,
    links: sanitizeList(section.links, 8),
    actions: sanitizeList(section.actions, 6),
    features: sanitizeList(section.features, 8),
    plans: sanitizeList(section.plans, 4),
    testimonials: sanitizeList(section.testimonials, 5),
    stats: sanitizeList(section.stats, 6),
    fields: sanitizeList(section.fields, 6),
    gallery: sanitizeList(section.gallery, 8),
    footerText: cleanText(section.footerText, 180),
  });
}

function sanitizeList(value, maxItems) {
  if (!Array.isArray(value)) return undefined;
  const items = value.slice(0, maxItems).map((item) => sanitizeRecord(item)).filter(Boolean);
  return items.length > 0 ? items : undefined;
}

function sanitizeRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const cleaned = {};

  for (const [key, raw] of Object.entries(value)) {
    if (!/^[a-zA-Z][a-zA-Z0-9]*$/.test(key)) continue;
    if (typeof raw === "string") cleaned[key] = cleanText(raw, 220);
    if (typeof raw === "boolean") cleaned[key] = raw;
    if (typeof raw === "number" && Number.isFinite(raw)) cleaned[key] = raw;
  }

  return Object.keys(cleaned).length > 0 ? cleaned : null;
}

function dedupeByIdOrText(items) {
  const seen = new Set();
  return items.filter((item) => {
    const key = item.id || item.note || item.title;
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function cleanAgent(value) {
  const cleaned = cleanText(value, 40).toLowerCase();
  return cleaned || "generic";
}

function cleanFilePrefix(value) {
  if (typeof value !== "string") return "";
  return value.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 40);
}

function cleanId(value) {
  if (typeof value !== "string") return "";
  return value.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80);
}

function cleanColor(value) {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value) ? value : undefined;
}

function cleanHref(value) {
  if (typeof value !== "string" || value.length > 240) return undefined;
  if (value.startsWith("#") || value.startsWith("/") || /^https?:\/\//i.test(value) || /^blob:/i.test(value)) {
    return value;
  }
  return undefined;
}

function dropUndefined(value) {
  return Object.fromEntries(valueEntries(value));
}

function valueEntries(value) {
  return Object.entries(value).filter(([, item]) => {
    if (item === undefined || item === "") return false;
    if (Array.isArray(item) && item.length === 0) return false;
    return true;
  });
}
