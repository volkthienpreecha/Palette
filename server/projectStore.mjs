import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { inside, normalizeProject } from "./handoffBundle.mjs";
import { persistSavedProject } from "./persistentStore.mjs";

export async function saveProjectFolder(payload, env = process.env) {
  const project = normalizeProject(payload?.project);
  if (project.sections.length === 0) {
    throw httpError(400, "Save needs at least one painted section.");
  }
  const persisted = await persistSavedProject(payload, env);

  const workspace = path.resolve(env.PALETTE_WORKSPACE || process.cwd());
  const runId = new Date().toISOString().replace(/[:.]/g, "-");
  const folderName = `${slug(project.name || project.id)}-${runId}`;
  const folderRel = `.palette/projects/${folderName}`;
  const folderPath = inside(workspace, folderRel);
  await mkdir(folderPath, { recursive: true });

  const instruction = cleanText(payload?.instruction, 800) ||
    "This folder is a saved Palette canvas. Codex can use project.json as the source of truth.";
  const files = [
    "project.json",
    "codex-notes.md",
  ];

  await Promise.all([
    writeFile(
      path.join(folderPath, "project.json"),
      JSON.stringify(project, null, 2),
      "utf8",
    ),
    writeFile(
      path.join(folderPath, "codex-notes.md"),
      [
        `# ${project.name}`,
        "",
        instruction,
        "",
        "## Codex handoff",
        "",
        "- Read `project.json` first.",
        "- Treat sections as the source component tree.",
        "- Preserve the Palette atelier style unless the user asks to change it.",
        "- Write generated app files outside this folder only when the user explicitly applies to repo.",
        "",
      ].join("\n"),
      "utf8",
    ),
  ]);

  return {
    saved: true,
    source: "folder-store",
    status: "Saved the canvas as a Codex-readable project folder.",
    projectId: persisted.projectId,
    ownerToken: persisted.ownerToken,
    reopen: `/api/projects/${persisted.projectId}`,
    handoff: `/api/projects/${persisted.projectId}/handoff`,
    folder: folderRel,
    files,
  };
}

function slug(value) {
  const cleaned = cleanText(value, 80)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return cleaned || "palette-project";
}

function cleanText(value, maxLength) {
  if (typeof value !== "string") return "";
  return value.replace(/[<>`]/g, "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function httpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}
