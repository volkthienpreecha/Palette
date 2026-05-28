import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, statSync } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  buildAgentHandoffBundle,
  cleanText,
  httpError,
  inside,
  normalizeProject,
} from "./handoffBundle.mjs";

export { inside, normalizeProject };

export async function applyProjectWithCodex(payload, env = process.env) {
  return applyProjectInternal(payload, env, null);
}

export async function applyProjectWithCodexStream(payload, emit = () => {}, env = process.env) {
  return applyProjectInternal(payload, env, emit);
}

async function applyProjectInternal(payload, env, emit) {
  const handoff = buildAgentHandoffBundle(payload, { agent: "codex" });
  const project = handoff.project;
  if (project.sections.length === 0) {
    throw httpError(400, "Codex apply needs at least one painted section.");
  }

  emitProgress(emit, "phase", "Codex received the Palette canvas", `${project.sections.length} sections queued.`);
  const workspace = path.resolve(env.PALETTE_WORKSPACE || process.cwd());
  const paletteDir = inside(workspace, ".palette");
  const generatedDir = inside(workspace, "src/generated");
  await mkdir(paletteDir, { recursive: true });
  await mkdir(generatedDir, { recursive: true });
  emitProgress(emit, "phase", "Codex checked the output boundary", "Only src/generated is allowed.");

  const runId = new Date().toISOString().replace(/[:.]/g, "-");
  const handoffRel = `.palette/codex-handoff-${runId}.json`;
  const handoffPath = inside(workspace, handoffRel);
  const lastMessagePath = inside(workspace, `.palette/codex-last-message-${runId}.txt`);

  await writeFile(handoffPath, JSON.stringify(handoff, null, 2), "utf8");
  emitProgress(emit, "phase", "Codex read handoff bundle", handoffRel);

  if (env.PALETTE_CODEX_DRY_RUN === "1") {
    emitProgress(emit, "result", "Codex dry run prepared the handoff", "Repo edits were skipped by configuration.");
    return {
      applied: false,
      source: "dry-run",
      status: "Codex apply dry run prepared the handoff file.",
      handoff: handoffRel,
      files: handoff.allowedFiles,
    };
  }

  const statusBefore = await gitStatus(workspace);
  const boundaryBefore = await boundarySnapshot(workspace, handoff.allowedFiles);
  emitProgress(emit, "phase", "Codex started the repo edit", "Running Codex CLI in workspace-write mode.");
  const result = await runCodex({
    workspace,
    handoffRel,
    lastMessagePath,
    model: cleanText(env.CODEX_MODEL, 80),
    timeoutMs: Number(env.PALETTE_CODEX_TIMEOUT_MS || 180000),
    env,
    emit,
  });
  emitProgress(emit, "phase", "Codex wrote PalettePage.tsx", "Generated React output is ready.");
  emitProgress(emit, "phase", "Codex wrote palette-project.json", "Structured canvas state is ready.");
  await verifyGeneratedFiles(workspace, handoff.allowedFiles);
  await verifyNoUnexpectedEdits(workspace, handoff.allowedFiles, statusBefore);
  await verifyBoundarySnapshot(workspace, handoff.allowedFiles, boundaryBefore);
  emitProgress(emit, "result", "Codex verified the generated files", "No edits escaped the Palette boundary.");

  return {
    applied: true,
    source: "codex-cli",
    status: "Codex applied the canvas to generated repo files.",
    handoff: handoffRel,
    files: handoff.allowedFiles,
    summary: result.summary,
  };
}

function runCodex({ workspace, handoffRel, lastMessagePath, model, timeoutMs, env, emit }) {
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
    "-c",
    `model_reasoning_effort="${cleanReasoningEffort(env.CODEX_REASONING_EFFORT)}"`,
    "-c",
    "plugins={}",
    "--output-last-message",
    lastMessagePath,
  ];

  if (model) codexArgs.push("-m", model);
  codexArgs.push("--", prompt);

  const usesCmdShim = process.platform === "win32" && /\.cmd$/i.test(codexCommand);
  const command = usesCmdShim ? "cmd.exe" : codexCommand;
  const args = usesCmdShim
    ? ["/d", "/s", "/c", codexCommand, ...codexArgs]
    : codexArgs;

  return new Promise((resolve, reject) => {
    const stdoutProgress = throttledCodexProgress(emit, "Codex is reading the repo");
    const stderrProgress = throttledCodexProgress(emit, "Codex is applying the canvas");
    const child = spawn(command, args, {
      cwd: workspace,
      env: codexEnv(env),
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
      stdoutProgress(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr = tail(stderr + chunk.toString(), 8000);
      stderrProgress(chunk);
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
        const detail = cleanFailureDetail(stderr || stdout || summary);
        reject(httpError(500, `Codex apply failed with exit code ${code}.${detail ? ` ${detail}` : ""}`));
        return;
      }
      if (codexOutputIndicatesFailure(stdout, stderr)) {
        const detail = cleanFailureDetail(stderr || stdout || summary);
        reject(httpError(500, `Codex apply failed.${detail ? ` ${detail}` : ""}`));
        return;
      }

      resolve({
        summary: cleanText(summary, 2000),
      });
    });
  });
}

function codexEnv(env) {
  const next = { ...env };
  if (next.PALETTE_CODEX_USE_API_KEY === "1") {
    if (next.CODEX_API_KEY && !next.OPENAI_API_KEY) {
      next.OPENAI_API_KEY = next.CODEX_API_KEY;
    }
  } else {
    delete next.OPENAI_API_KEY;
    delete next.CODEX_API_KEY;
  }
  return next;
}

function emitProgress(emit, type, label, detail) {
  if (typeof emit !== "function") return;
  try {
    emit({
      type,
      label: cleanText(label, 140),
      detail: cleanProgressDetail(detail),
      at: new Date().toISOString(),
    });
  } catch {
    // Streaming progress must never fail the underlying Codex run.
  }
}

function throttledCodexProgress(emit, label) {
  let last = 0;

  return (chunk) => {
    if (typeof emit !== "function") return;
    const now = Date.now();
    if (now - last < 1200) return;
    last = now;
    const detail = cleanProgressDetail(chunk.toString()) || "Codex CLI is still working.";
    emitProgress(emit, "output", label, detail);
  };
}

function cleanProgressDetail(value) {
  if (typeof value !== "string") return "";
  const cleaned = value
    .replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/sk-[A-Za-z0-9_-]+/g, "[redacted]")
    .replace(/gsk_[A-Za-z0-9_-]+/g, "[redacted]")
    .replace(/\*{8,}[A-Za-z0-9_-]*/g, "[redacted]")
    .replace(/[^\x09\x0A\x0D\x20-\x7E]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.slice(0, 180);
}

function cleanFailureDetail(value) {
  if (typeof value !== "string") return "";
  const cleaned = value
    .replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/sk-[A-Za-z0-9_-]+/g, "[redacted]")
    .replace(/gsk_[A-Za-z0-9_-]+/g, "[redacted]")
    .replace(/\*{8,}[A-Za-z0-9_-]*/g, "[redacted]")
    .replace(/[^\x09\x0A\x0D\x20-\x7E]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.slice(Math.max(0, cleaned.length - 360));
}

function codexOutputIndicatesFailure(stdout, stderr) {
  const text = `${stderr || ""}\n${stdout || ""}`;
  return /\b401 Unauthorized\b/i.test(text) ||
    /\bexceeded retry limit\b/i.test(text) ||
    /(^|\n)\s*ERROR:/i.test(text);
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

function cleanReasoningEffort(value) {
  const allowed = new Set(["minimal", "low", "medium", "high"]);
  const effort = cleanText(value, 20);
  return allowed.has(effort) ? effort : "high";
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

async function verifyNoUnexpectedEdits(workspace, allowedFiles, statusBefore) {
  const status = await gitStatus(workspace);
  if (!status) return;

  const before = new Set(statusBefore.map(statusPath));
  const allowed = new Set(allowedFiles.map(normalizeGitPath));
  const unexpected = status
    .map(statusPath)
    .filter((file) => !before.has(file))
    .filter((file) => !allowed.has(file))
    .filter((file) => file !== "src/generated/")
    .filter((file) => !file.startsWith(".palette/"));

  const generatedFiles = await listGeneratedFiles(workspace);
  const unexpectedGenerated = generatedFiles.filter((file) => !allowed.has(file));

  if (unexpected.length > 0 || unexpectedGenerated.length > 0) {
    const details = [...unexpected, ...unexpectedGenerated].slice(0, 5).join(", ");
    throw httpError(500, `Codex touched files outside the Palette output boundary: ${details}.`);
  }
}

function statusPath(line) {
  const file = line.slice(3).trim();
  return normalizeGitPath(file.includes(" -> ") ? file.split(" -> ").pop().trim() : file);
}

async function listGeneratedFiles(workspace) {
  const root = inside(workspace, "src/generated");
  if (!existsSync(root)) return [];

  async function walk(directory, relativeBase = "") {
    const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
    const files = [];

    for (const entry of entries) {
      const relativePath = path.join(relativeBase, entry.name);
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        files.push(...await walk(fullPath, relativePath));
      } else if (entry.isFile()) {
        files.push(normalizeGitPath(path.join("src/generated", relativePath)));
      }
    }

    return files;
  }

  return walk(root);
}

function gitStatus(workspace) {
  return new Promise((resolve) => {
    const child = spawn("git", ["status", "--porcelain"], {
      cwd: workspace,
      windowsHide: true,
      stdio: ["ignore", "pipe", "ignore"],
    });
    let stdout = "";
    child.stdout.on("data", (chunk) => {
      stdout = tail(stdout + chunk.toString(), 10000);
    });
    child.on("error", () => resolve([]));
    child.on("close", (code) => {
      if (code !== 0) {
        resolve([]);
        return;
      }
      resolve(stdout.split(/\r?\n/).filter(Boolean));
    });
  });
}

function normalizeGitPath(value) {
  return value.replace(/\\/g, "/").replace(/^"|"$/g, "");
}

async function boundarySnapshot(workspace, allowedFiles) {
  const allowed = new Set(allowedFiles.map(normalizeGitPath));
  const ignoredDirs = new Set([".git", ".palette", "dist", "node_modules", "qa"]);
  const snapshot = new Map();

  async function walk(directory, relativeBase = "") {
    const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);

    for (const entry of entries) {
      const relativePath = normalizeGitPath(path.join(relativeBase, entry.name));
      if (entry.isDirectory()) {
        if (ignoredDirs.has(entry.name)) continue;
        if (relativePath === "src/generated") continue;
        await walk(path.join(directory, entry.name), relativePath);
        continue;
      }

      if (!entry.isFile() || allowed.has(relativePath) || relativePath === ".env") continue;
      const content = await readFile(path.join(directory, entry.name)).catch(() => null);
      if (content) snapshot.set(relativePath, createHash("sha256").update(content).digest("hex"));
    }
  }

  await walk(workspace);
  return snapshot;
}

async function verifyBoundarySnapshot(workspace, allowedFiles, before) {
  const after = await boundarySnapshot(workspace, allowedFiles);
  const changed = [];

  for (const [file, hash] of after.entries()) {
    if (!before.has(file) || before.get(file) !== hash) changed.push(file);
  }

  for (const file of before.keys()) {
    if (!after.has(file)) changed.push(file);
  }

  if (changed.length > 0) {
    throw httpError(500, `Codex changed files outside src/generated: ${changed.slice(0, 5).join(", ")}.`);
  }
}

function tail(value, maxLength) {
  return value.length > maxLength ? value.slice(value.length - maxLength) : value;
}
