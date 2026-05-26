import { spawn } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

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
]);

export async function applyProjectWithCodex(payload, env = process.env) {
  const project = normalizeProject(payload?.project);
  if (project.sections.length === 0) {
    throw httpError(400, "Codex apply needs at least one painted section.");
  }

  const workspace = path.resolve(env.PALETTE_WORKSPACE || process.cwd());
  const paletteDir = inside(workspace, ".palette");
  const generatedDir = inside(workspace, "src/generated");
  await mkdir(paletteDir, { recursive: true });
  await mkdir(generatedDir, { recursive: true });

  const runId = new Date().toISOString().replace(/[:.]/g, "-");
  const handoffRel = `.palette/codex-handoff-${runId}.json`;
  const handoffPath = inside(workspace, handoffRel);
  const lastMessagePath = inside(workspace, `.palette/codex-last-message-${runId}.txt`);

  const handoff = {
    project,
    instruction: cleanText(payload?.instruction, 500) || "Apply this Palette canvas to generated React files.",
    allowedFiles: ["src/generated/palette-project.json", "src/generated/PalettePage.tsx"],
  };

  await writeFile(handoffPath, JSON.stringify(handoff, null, 2), "utf8");

  if (env.PALETTE_CODEX_DRY_RUN === "1") {
    return {
      applied: false,
      source: "dry-run",
      status: "Codex apply dry run prepared the handoff file.",
      handoff: handoffRel,
      files: handoff.allowedFiles,
    };
  }

  const result = await runCodex({
    workspace,
    handoffRel,
    lastMessagePath,
    model: cleanText(env.CODEX_MODEL, 80),
    timeoutMs: Number(env.PALETTE_CODEX_TIMEOUT_MS || 180000),
    env,
  });
  await verifyGeneratedFiles(workspace, handoff.allowedFiles);

  return {
    applied: true,
    source: "codex-cli",
    status: "Codex applied the canvas to generated repo files.",
    handoff: handoffRel,
    files: handoff.allowedFiles,
    summary: result.summary,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

function normalizeProject(project) {
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

function sanitizeSection(section) {
  if (!section || typeof section !== "object" || !allowedKinds.has(section.kind)) return null;

  return dropUndefined({
    id: cleanId(section.id) || `${section.kind}-${Math.random().toString(16).slice(2, 8)}`,
    kind: section.kind,
    title: cleanText(section.title, 120) || `${section.kind} section`,
    subtitle: cleanText(section.subtitle, 220),
    eyebrow: cleanText(section.eyebrow, 80),
    variant: cleanText(section.variant, 40),
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

function runCodex({ workspace, handoffRel, lastMessagePath, model, timeoutMs, env }) {
  const prompt = [
    "You are Codex applying a Palette canvas to this repository.",
    `Read ${handoffRel}.`,
    "Create or update exactly these files and no others:",
    "src/generated/palette-project.json and src/generated/PalettePage.tsx.",
    "The JSON file must contain the serialized project from the handoff.",
    "The TSX file must export a React component named PalettePage that renders the current sections.",
    "Use simple React and class names already present in the app where useful.",
    "Do not edit package files, app shell files, server files, docs, or git metadata.",
    "Do not run destructive commands.",
    "When finished, summarize the files you wrote.",
  ].join(" ");
  const codexCommand = resolveCodexCommand(env);
  const codexArgs = [
    "exec",
    "-C",
    workspace,
    "--sandbox",
    "workspace-write",
    "--output-last-message",
    lastMessagePath,
  ];

  if (model) codexArgs.push("-m", model);
  codexArgs.push(prompt);

  const usesCmdShim = process.platform === "win32" && /\.cmd$/i.test(codexCommand);
  const command = usesCmdShim ? "cmd.exe" : codexCommand;
  const args = usesCmdShim
    ? ["/d", "/s", "/c", codexCommand, ...codexArgs]
    : codexArgs;

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: workspace,
      env,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      reject(httpError(504, "Codex apply timed out."));
    }, Math.max(30000, timeoutMs || 180000));

    child.stdout.on("data", (chunk) => {
      stdout = tail(stdout + chunk.toString(), 8000);
    });
    child.stderr.on("data", (chunk) => {
      stderr = tail(stderr + chunk.toString(), 8000);
    });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(httpError(500, `Could not start Codex CLI: ${error.message}`));
    });
    child.on("close", async (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);

      const summary = await readFile(lastMessagePath, "utf8").catch(() => "");
      if (code !== 0) {
        reject(httpError(500, `Codex apply failed with exit code ${code}. ${tail(stderr || stdout, 1000)}`));
        return;
      }

      resolve({
        stdout: tail(stdout, 3000),
        stderr: tail(stderr, 3000),
        summary: cleanText(summary, 2000),
      });
    });
  });
}

function resolveCodexCommand(env) {
  if (env.CODEX_CMD) return env.CODEX_CMD;
  if (env.CODEX_CLI_PATH) return env.CODEX_CLI_PATH;

  if (process.platform !== "win32") return "codex";

  const localAppData = env.LOCALAPPDATA || path.join(env.USERPROFILE || "", "AppData", "Local");
  const desktopBin = path.join(localAppData, "OpenAI", "Codex", "bin");
  const desktopCandidate = newestDesktopCodex(desktopBin);
  return desktopCandidate || "codex.cmd";
}

function newestDesktopCodex(desktopBin) {
  if (!existsSync(desktopBin)) return "";

  return readdirSync(desktopBin, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(desktopBin, entry.name, "codex.exe"))
    .filter((candidate) => existsSync(candidate))
    .sort((left, right) => statSync(right).mtimeMs - statSync(left).mtimeMs)[0] || "";
}

async function verifyGeneratedFiles(workspace, relativeFiles) {
  const missing = [];
  const empty = [];

  await Promise.all(relativeFiles.map(async (relativeFile) => {
    const content = await readFile(inside(workspace, relativeFile), "utf8").catch(() => null);
    if (content === null) {
      missing.push(relativeFile);
      return;
    }
    if (content.trim().length === 0) empty.push(relativeFile);
  }));

  if (missing.length > 0 || empty.length > 0) {
    const details = [
      missing.length > 0 ? `missing ${missing.join(", ")}` : "",
      empty.length > 0 ? `empty ${empty.join(", ")}` : "",
    ].filter(Boolean).join("; ");
    throw httpError(500, `Codex CLI finished but did not produce the expected repo edits: ${details}.`);
  }
}

function inside(root, relativePath) {
  const resolved = path.resolve(root, relativePath);
  if (!resolved.toLowerCase().startsWith(root.toLowerCase() + path.sep)) {
    throw httpError(400, "Resolved path escaped the workspace.");
  }
  return resolved;
}

function cleanText(value, maxLength) {
  if (typeof value !== "string") return "";
  return value.replace(/[<>`]/g, "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function cleanId(value) {
  if (typeof value !== "string") return "";
  return value.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80);
}

function cleanColor(value) {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value) ? value : undefined;
}

function dropUndefined(value) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined && item !== ""));
}

function tail(value, maxLength) {
  return value.length > maxLength ? value.slice(value.length - maxLength) : value;
}

function httpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}
