import { randomBytes, createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { cleanText, httpError, inside } from "./handoffBundle.mjs";
import { loadSkillStack, workspaceRoot } from "./skillRegistry.mjs";

const workspacePrefix = ".palette/workspaces";

export async function ensureDesignWorkspace(payload = {}, env = process.env) {
  const workspace = workspaceRoot(env);
  const projectId = cleanId(payload.projectId || payload.id) || createProjectId(payload);
  const relative = path.join(workspacePrefix, projectId);
  const root = inside(workspace, relative);

  await mkdir(root, { recursive: true });
  await mkdir(path.join(root, "references"), { recursive: true });
  await mkdir(path.join(root, "generated"), { recursive: true });

  return {
    projectId,
    root,
    relative,
    referencesDir: path.join(root, "references"),
    generatedDir: path.join(root, "generated"),
  };
}

export async function saveDesignContext(payload = {}, env = process.env) {
  const designWorkspace = await ensureDesignWorkspace(payload, env);
  const skillStack = await loadSkillStack(env);
  const brief = normalizeBrief(payload.brief || payload);
  const references = await persistReferenceFiles(
    designWorkspace,
    normalizeReferences(payload.references || payload.project?.swatches || []),
  );
  const notes = normalizeNotes(payload.notes || []);
  const product = productMarkdown(brief, references, notes);
  const design = designMarkdown(brief, references, notes);
  const skillContext = skillContextMarkdown({ skillStack, brief, references, notes });

  await Promise.all([
    writeJson(path.join(designWorkspace.root, "palette-brief.json"), {
      projectId: designWorkspace.projectId,
      brief,
      references,
      notes,
      updatedAt: new Date().toISOString(),
    }),
    writeFile(path.join(designWorkspace.root, "PRODUCT.md"), product, "utf8"),
    writeFile(path.join(designWorkspace.root, "DESIGN.md"), design, "utf8"),
    writeFile(path.join(designWorkspace.root, "skill-context.md"), skillContext, "utf8"),
  ]);

  return {
    ok: true,
    projectId: designWorkspace.projectId,
    workspace: designWorkspace.relative.replaceAll("\\", "/"),
    files: [
      `${designWorkspace.relative}/palette-brief.json`,
      `${designWorkspace.relative}/PRODUCT.md`,
      `${designWorkspace.relative}/DESIGN.md`,
      `${designWorkspace.relative}/skill-context.md`,
    ].map((item) => item.replaceAll("\\", "/")),
    brief,
    references,
    notes,
    status: "Canvas brief and design context are ready.",
  };
}

export async function loadWorkspaceBrief(projectId, env = process.env) {
  const designWorkspace = await ensureDesignWorkspace({ projectId }, env);
  const file = path.join(designWorkspace.root, "palette-brief.json");
  const raw = await readFile(file, "utf8").catch(() => "");
  if (!raw) {
    return {
      projectId: designWorkspace.projectId,
      brief: normalizeBrief({}),
      references: [],
      notes: [],
    };
  }

  try {
    const parsed = JSON.parse(raw);
    return {
      projectId: designWorkspace.projectId,
      brief: normalizeBrief(parsed.brief || {}),
      references: normalizeReferences(parsed.references || []),
      notes: normalizeNotes(parsed.notes || []),
    };
  } catch {
    throw httpError(500, "Palette workspace brief is not valid JSON.");
  }
}

export function normalizeBrief(input = {}) {
  return {
    product: cleanText(input.product || input.what || input.prompt || input.idea, 260),
    audience: cleanText(input.audience || input.who, 240),
    feeling: cleanText(input.feeling || input.vibe || input.tone, 240),
    references: cleanText(input.references || input.styleReferences || input.style, 400),
    avoid: cleanText(input.avoid || input.antiReferences || input.not, 400),
    goal: cleanText(input.goal || input.outcome, 280),
    rawAnswers: Array.isArray(input.rawAnswers)
      ? input.rawAnswers.map((answer) => cleanText(answer, 500)).filter(Boolean).slice(0, 12)
      : [],
  };
}

export function normalizeReferences(input = []) {
  return Array.isArray(input)
    ? input.map(normalizeReference).filter(Boolean).slice(0, 24)
    : [];
}

export function normalizeNotes(input = []) {
  return Array.isArray(input)
    ? input
        .map((note) => {
          if (typeof note === "string") return { text: cleanText(note, 500) };
          return {
            id: cleanText(note?.id, 80),
            text: cleanText(note?.text || note?.note || note?.subtitle, 500),
            sectionId: cleanText(note?.sectionId || note?.pinnedTo, 120),
          };
        })
        .filter((note) => note.text)
        .slice(0, 24)
    : [];
}

function normalizeReference(reference) {
  if (!reference || typeof reference !== "object") return null;
  const url = cleanHref(reference.url || reference.href);
  const title = cleanText(reference.title || reference.name || reference.fileName, 120);
  const note = cleanText(reference.note || reference.text || reference.description, 500);
  if (!url && !title && !note) return null;
  return {
    id: cleanText(reference.id, 80) || createId("ref"),
    title: title || "Reference",
    note,
    url,
    kind: detectReferenceKind(url, reference.kind),
    colors: Array.isArray(reference.colors) ? reference.colors.map(cleanColor).filter(Boolean).slice(0, 8) : [],
  };
}

function productMarkdown(brief, references, notes) {
  const product = brief.product || "A new Palette canvas";
  const audience = brief.audience || "People who want to make software visually before they touch code.";
  const feeling = brief.feeling || "Clear, polished, and trustworthy.";
  const avoid = brief.avoid || "Generic AI slop, default SaaS templates, visual noise, and confusing jargon.";

  return `# Product

## Register

product

## Users

${audience}

## Product Purpose

${product}

Goal: ${brief.goal || "Turn the user's idea into a real, editable frontend."}

## Brand Personality

${feeling}

## Anti-references

${avoid}

## Design Principles

1. Make progress visible before asking the user to trust the result.
2. Keep every control plain enough for a first-time builder.
3. Use references as taste input, not decorative clutter.
4. Prefer direct steering over prompt retries.
5. Ship a real generated folder that another agent can continue.

## Reference Notes

${references.map((reference) => `- ${reference.title}: ${reference.note || reference.url || "visual reference"}`).join("\n") || "- No references yet."}

## Pinned Notes

${notes.map((note) => `- ${note.text}`).join("\n") || "- No pinned notes yet."}

## Accessibility & Inclusion

Keep copy direct, controls keyboard reachable, contrast readable, and motion reducible.
`;
}

function designMarkdown(brief, references, notes) {
  return `---
name: ${brief.product || "Palette-generated frontend"}
description: Generated through Palette with Impeccable, Taste Skill, and Emil design-engineering context.
colors:
  ink: "#1b160f"
  paper: "#f6efe1"
  aged-gold: "#b88a45"
  umber-glass: "#2b2117"
  soft-line: "#d8c7a8"
typography:
  display:
    fontFamily: "Cormorant Garamond, Georgia, serif"
    fontWeight: 400
    lineHeight: 1
    letterSpacing: "normal"
  body:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontWeight: 400
    lineHeight: 1.55
rounded:
  sm: "6px"
  md: "8px"
spacing:
  sm: "8px"
  md: "16px"
  lg: "28px"
components:
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
    rounded: "{rounded.sm}"
    padding: "12px 18px"
  panel-glass:
    backgroundColor: "{colors.umber-glass}"
    textColor: "{colors.paper}"
    rounded: "{rounded.md}"
---

# Design System

## Overview

Build a frontend that feels ${brief.feeling || "clear, crafted, and polished"}. Treat the surface like a small atelier: visible craft, direct manipulation, and calm confidence. The user is not asking for a generic AI template. The result should respond to the provided references and avoid: ${brief.avoid || "visual cliches and confusing defaults"}.

## Colors

Use a deliberate palette derived from the brief and references. Do not use pure black or pure white. Avoid generic purple-blue AI gradients unless the user explicitly asked for that exact style. Palette defaults lean toward ink, aged paper, muted gold, umber glass, and quiet painted neutrals.

## Typography

Use readable hierarchy, strong line-height, and restrained display choices. Keep labels plain and useful.

## Elevation

Prefer tonal layering, thin borders, and purposeful glass. Do not use decorative blur as a default. Shadows should feel like soft studio light, not a SaaS card preset.

## Components

The generated page should include only the components needed for the user's goal. Avoid identical card grids unless the content truly needs them. Controls should feel like tools on a worktable: clear, reachable, and not over-explained.

## Do's and Don'ts

Do use references as taste input. Do keep motion under control and useful. Do make editable sections obvious. Do not make a fake AI dashboard, neon grid, purple gradient launch page, or default shadcn surface.

References:
${references.map((reference) => `- ${reference.title}: ${reference.note || reference.url || "visual reference"}`).join("\n") || "- No references provided."}

Notes:
${notes.map((note) => `- ${note.text}`).join("\n") || "- No pinned notes yet."}
`;
}

function skillContextMarkdown({ skillStack, brief, references, notes }) {
  return [
    "# Palette Build Context",
    "",
    "## User Brief",
    JSON.stringify({ brief, references, notes }, null, 2),
    "",
    skillStack.asPrompt,
  ].join("\n");
}

function createProjectId(payload) {
  const seed = cleanText(payload.brief?.product || payload.product || payload.prompt || payload.name, 80)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 36);
  return `${seed || "palette"}-${randomBytes(3).toString("hex")}`;
}

function createId(prefix) {
  return `${prefix}-${randomBytes(6).toString("hex")}`;
}

function cleanId(value) {
  return cleanText(value, 100)
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-|-$/g, "");
}

function cleanHref(value) {
  if (typeof value !== "string") return "";
  const raw = value.trim();
  if (!raw) return "";
  if (/^data:image\//i.test(raw)) return raw.slice(0, 9_000_000);
  if (/^\/api\/assets\//i.test(raw)) return raw.slice(0, 1200);
  const text = cleanText(raw, 1200);
  try {
    const parsed = new URL(text);
    if (!["http:", "https:"].includes(parsed.protocol)) return "";
    return parsed.href;
  } catch {
    return "";
  }
}

function cleanColor(value) {
  const text = cleanText(value, 80);
  return /^(#[0-9a-f]{3,8}|oklch\([^)]+\)|rgb(a)?\([^)]+\)|hsl(a)?\([^)]+\))$/i.test(text) ? text : "";
}

function detectReferenceKind(url, fallback) {
  const explicit = cleanText(fallback, 40);
  if (explicit) return explicit;
  if (/figma\.com/i.test(url)) return "figma";
  if (/^data:image\//i.test(url)) return "image";
  return url ? "link" : "note";
}

async function writeJson(file, value) {
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function persistReferenceFiles(designWorkspace, references) {
  const next = [];

  for (const reference of references) {
    if (!reference.url?.startsWith("data:image/")) {
      next.push(reference);
      continue;
    }

    const match = reference.url.match(/^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i);
    if (!match) {
      next.push(reference);
      continue;
    }

    const extension = imageExtension(match[1]);
    const fileName = `${reference.id || createId("ref")}.${extension}`;
    const file = path.join(designWorkspace.referencesDir, fileName);
    await writeFile(file, Buffer.from(match[2], "base64"));
    next.push({
      ...reference,
      file: `references/${fileName}`,
    });
  }

  return next;
}

function imageExtension(contentType) {
  if (/png/i.test(contentType)) return "png";
  if (/webp/i.test(contentType)) return "webp";
  if (/gif/i.test(contentType)) return "gif";
  return "jpg";
}

export function projectDigest(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 12);
}
