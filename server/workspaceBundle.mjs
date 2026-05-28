import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { cleanText, httpError, inside } from "./handoffBundle.mjs";
import { workspaceRoot } from "./skillRegistry.mjs";

const workspacePrefix = ".palette/workspaces";
const textFiles = [
  "PRODUCT.md",
  "DESIGN.md",
  "palette-brief.json",
  "skill-context.md",
  "generated/palette-project.json",
  "generated/PalettePage.tsx",
];
const maxBundleBytes = 12_000_000;

export async function createWorkspaceBundle(projectId, env = process.env) {
  const id = cleanId(projectId);
  if (!id) throw httpError(400, "projectId is required.");

  const workspace = workspaceRoot(env);
  const relative = `${workspacePrefix}/${id}`;
  const root = inside(workspace, relative);
  const rootStat = await stat(root).catch(() => null);
  if (!rootStat?.isDirectory()) throw httpError(404, "Palette workspace was not found.");

  const files = [];
  let totalBytes = 0;

  for (const file of textFiles) {
    const bundled = await readBundleFile(root, file);
    if (!bundled) continue;
    totalBytes += bundled.bytes;
    files.push(bundled.file);
  }

  const references = await readReferenceFiles(root);
  for (const bundled of references) {
    totalBytes += bundled.bytes;
    if (totalBytes > maxBundleBytes) break;
    files.push(bundled.file);
  }

  if (!files.some((file) => file.path === "generated/palette-project.json")) {
    throw httpError(409, "Begin painting before downloading generated workspace files.");
  }

  return {
    schemaVersion: "palette.workspace-bundle.v1",
    createdAt: new Date().toISOString(),
    projectId: id,
    workspace: relative,
    purpose: "Give this bundle to Codex, Claude Code, Cursor, or another code agent to continue the generated frontend.",
    expectedFiles: [
      "PRODUCT.md",
      "DESIGN.md",
      "palette-brief.json",
      "generated/palette-project.json",
      "generated/PalettePage.tsx",
    ],
    agentPrompt:
      "Use PRODUCT.md, DESIGN.md, palette-brief.json, and generated/palette-project.json as the source of truth. Integrate generated/PalettePage.tsx into the user's app without changing unrelated files.",
    files,
  };
}

async function readBundleFile(root, relativeFile) {
  const filePath = inside(root, relativeFile);
  const content = await readFile(filePath, "utf8").catch(() => null);
  if (content === null) return null;
  return {
    bytes: Buffer.byteLength(content),
    file: {
      path: normalizePath(relativeFile),
      encoding: "utf8",
      content,
    },
  };
}

async function readReferenceFiles(root) {
  const referencesDir = inside(root, "references");
  const entries = await readdir(referencesDir, { withFileTypes: true }).catch(() => []);
  const files = [];

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const safeName = cleanFileName(entry.name);
    if (!safeName) continue;
    const relativeFile = `references/${safeName}`;
    const filePath = inside(root, relativeFile);
    const buffer = await readFile(filePath).catch(() => null);
    if (!buffer) continue;
    files.push({
      bytes: buffer.byteLength,
      file: {
        path: normalizePath(relativeFile),
        encoding: "base64",
        contentBase64: buffer.toString("base64"),
      },
    });
  }

  return files;
}

function cleanId(value) {
  return cleanText(value, 100)
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-|-$/g, "");
}

function cleanFileName(value) {
  return cleanText(value, 140).replace(/[^a-zA-Z0-9._-]/g, "");
}

function normalizePath(value) {
  return String(value || "").replaceAll(path.sep, "/");
}
