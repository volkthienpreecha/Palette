import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { loadEnvFile } from "../server/env.mjs";
import { nextInterviewQuestion } from "../server/designInterview.mjs";
import { saveDesignContext } from "../server/designWorkspace.mjs";
import { skillStatus } from "../server/skillRegistry.mjs";
import {
  buildEngineStatus,
  patchWorkspaceBuild,
  polishWorkspaceBuild,
  startWorkspaceBuild,
} from "../server/workspaceBuild.mjs";
import { createWorkspaceBundle } from "../server/workspaceBundle.mjs";

loadEnvFile();

const tinyPng =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=";

const events = [];
const emit = (event) => {
  if (event?.type !== "output") events.push(event);
};

const failures = [];
const checks = [];

function check(name, condition, detail = "") {
  checks.push({ name, ok: Boolean(condition), detail });
  if (!condition) failures.push(`${name}${detail ? `: ${detail}` : ""}`);
}

function workspacePath(relative) {
  return path.resolve(process.cwd(), relative);
}

function compileGenerated(tsxPath) {
  const command = process.platform === "win32"
    ? path.join(process.cwd(), "node_modules", ".bin", "tsc.cmd")
    : path.join(process.cwd(), "node_modules", ".bin", "tsc");
  return spawnSync(
    command,
    [
      "--jsx",
      "react-jsx",
      "--moduleResolution",
      "bundler",
      "--module",
      "ESNext",
      "--target",
      "ES2022",
      "--lib",
      "DOM,DOM.Iterable,ES2022",
      "--skipLibCheck",
      "--esModuleInterop",
      "--resolveJsonModule",
      "--allowSyntheticDefaultImports",
      "--noEmit",
      tsxPath,
    ],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      windowsHide: true,
      shell: process.platform === "win32",
    },
  );
}

async function main() {
  if (!process.env.GROQ_API_KEY && process.env.PALETTE_BUILD_DRY_RUN !== "1") {
    throw new Error("Set GROQ_API_KEY or PALETTE_BUILD_DRY_RUN=1 before running the full-stack smoke test.");
  }

  const status = await skillStatus();
  check("skills status ok", status.ok, JSON.stringify(status.skills));
  check("impeccable loaded", status.skills?.impeccable?.loaded);
  check("taste loaded", status.skills?.taste?.loaded);
  check("emil loaded", status.skills?.emil?.loaded);

  const engine = buildEngineStatus();
  check("build engine status ok", engine.ok);
  check("build engine has selected provider", ["groq", "openai", "codex"].includes(engine.selectedProvider));
  check("build engine has human label", typeof engine.label === "string" && engine.label.length > 0);

  const interview = await nextInterviewQuestion({
    initialPrompt: "Build a landing page for a ceramic dentist",
    brief: { product: "ceramic dentist landing page" },
    references: [],
    notes: [],
    history: [],
  });
  check("interview asks question", typeof interview.question === "string" && interview.question.length > 0);
  check("interview uses impeccable", String(interview.source || "").startsWith("impeccable"));

  const context = await saveDesignContext({
    brief: {
      product: "smoke test ceramic dentist landing page",
      audience: "local patients who want calm dental care",
      feeling: "calm, artful, trustworthy",
      avoid: "generic medical stock site or AI SaaS gradients",
    },
    references: [
      {
        id: "smoke-ref-image",
        title: "Pasted screenshot",
        note: "Tiny pasted image should persist.",
        url: tinyPng,
      },
      {
        id: "smoke-ref-figma",
        title: "Figma reference",
        note: "Soft editorial spacing.",
        url: "https://figma.com/file/smoke",
      },
    ],
    notes: [{ id: "smoke-note", text: "Make the first screen feel human and finished." }],
  });
  const imageReference = context.references.find((reference) => reference.id === "smoke-ref-image");
  check("context workspace exists", existsSync(workspacePath(context.workspace)));
  check(
    "pasted image persisted",
    Boolean(imageReference?.file && existsSync(path.join(workspacePath(context.workspace), imageReference.file))),
  );
  check("product context written", existsSync(path.join(workspacePath(context.workspace), "PRODUCT.md")));
  check("design context written", existsSync(path.join(workspacePath(context.workspace), "DESIGN.md")));

  const start = await startWorkspaceBuild({
    projectId: context.projectId,
    brief: context.brief,
    references: context.references,
    notes: context.notes,
  }, emit);
  check("build applied", start.applied);
  check("build source is real or explicit dry run", ["groq", "openai", "codex-cli", "dry-run"].includes(start.source));
  check("build has enough sections", start.project.sections.length >= 4, `${start.project.sections.length} sections`);

  const selected = start.project.sections.find((section) => section.kind === "hero") || start.project.sections[0];
  const patch = await patchWorkspaceBuild({
    projectId: start.projectId,
    command: "Make only the selected section warmer and more personal.",
    selectedId: selected.id,
    selectedSection: selected,
    project: start.project,
    brief: context.brief,
    references: context.references,
    notes: context.notes,
  }, emit);
  check("patch applied", patch.applied);
  check(
    "patch preserves section count",
    patch.project.sections.length >= start.project.sections.length,
    `${patch.project.sections.length} after patch, ${start.project.sections.length} before`,
  );

  const polishedSection = patch.project.sections.find((section) => section.id === selected.id) || patch.project.sections[0];
  const polish = await polishWorkspaceBuild({
    projectId: start.projectId,
    command: "Make this selected section feel finished.",
    selectedId: polishedSection.id,
    selectedSection: polishedSection,
    project: patch.project,
    brief: context.brief,
    references: context.references,
    notes: context.notes,
  }, emit);
  check("polish applied", polish.applied);
  check("polish preserves sections", polish.project.sections.length >= patch.project.sections.length);

  const generatedDir = path.join(workspacePath(polish.workspace), "generated");
  const jsonPath = path.join(generatedDir, "palette-project.json");
  const tsxPath = path.join(generatedDir, "PalettePage.tsx");
  check("generated json exists", existsSync(jsonPath));
  check("generated tsx exists", existsSync(tsxPath));

  const tsx = existsSync(tsxPath) ? readFileSync(tsxPath, "utf8") : "";
  check("generated tsx is renderer", tsx.includes("function SectionView") && !tsx.includes("<pre>"));

  const compile = compileGenerated(tsxPath);
  check(
    "generated tsx compiles",
    compile.status === 0,
    (compile.error?.message || compile.stderr || compile.stdout || "").slice(0, 300),
  );

  const bundle = await createWorkspaceBundle(polish.projectId);
  check("workspace bundle created", bundle.projectId === polish.projectId);
  check("workspace bundle includes product doc", bundle.files.some((file) => file.path === "PRODUCT.md"));
  check("workspace bundle includes design doc", bundle.files.some((file) => file.path === "DESIGN.md"));
  check("workspace bundle includes generated json", bundle.files.some((file) => file.path === "generated/palette-project.json"));
  check("workspace bundle includes generated component", bundle.files.some((file) => file.path === "generated/PalettePage.tsx"));

  const summary = {
    ok: failures.length === 0,
    provider: start.source,
    projectId: start.projectId,
    workspace: polish.workspace,
    checks,
    events: events.map((event) => event.label).slice(-12),
  };

  console.log(JSON.stringify(summary, null, 2));

  if (failures.length > 0) {
    throw new Error(`Smoke failed: ${failures.join("; ")}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
