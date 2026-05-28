import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { cleanText, httpError, inside } from "./handoffBundle.mjs";

const defaultImpeccablePath = String.raw`C:\Users\volko\OneDrive\Documents\Postmortem\.agents\skills\impeccable`;
const skillCacheDir = ".palette/skill-cache";

const remoteSkills = {
  taste: {
    name: "Taste Skill",
    urls: [
      "https://raw.githubusercontent.com/Leonxlnx/taste-skill/main/skills/taste-skill/SKILL.md",
      "https://raw.githubusercontent.com/Leonxlnx/taste-skill/main/skills/design-taste-frontend/SKILL.md",
      "https://raw.githubusercontent.com/Leonxlnx/taste-skill/main/skills/gpt-tasteskill/SKILL.md",
      "https://raw.githubusercontent.com/Leonxlnx/taste-skill/main/SKILL.md",
    ],
    cacheFile: "taste-skill.md",
  },
  emil: {
    name: "Emil Design Engineering",
    urls: [
      "https://raw.githubusercontent.com/emilkowalski/skill/main/skills/emil-design-eng/SKILL.md",
      "https://raw.githubusercontent.com/emilkowalski/skill/main/SKILL.md",
    ],
    cacheFile: "emil-design-eng.md",
  },
};

export async function skillStatus(env = process.env) {
  const workspace = workspaceRoot(env);
  const impeccable = await loadImpeccableSkill(env).catch((error) => ({ error: error.message }));
  const taste = await loadRemoteSkill("taste", env).catch((error) => ({ error: error.message }));
  const emil = await loadRemoteSkill("emil", env).catch((error) => ({ error: error.message }));

  return {
    ok: !impeccable.error && !taste.error && !emil.error,
    workspace,
    skills: {
      impeccable: summarizeSkill(impeccable),
      taste: summarizeSkill(taste),
      emil: summarizeSkill(emil),
    },
  };
}

export async function loadSkillStack(env = process.env) {
  const [impeccable, taste, emil] = await Promise.all([
    loadImpeccableSkill(env),
    loadRemoteSkill("taste", env),
    loadRemoteSkill("emil", env),
  ]);

  return {
    loadedAt: new Date().toISOString(),
    impeccable,
    taste,
    emil,
    asPrompt: [
      "# Palette Skill Stack",
      "",
      "These are real skill files loaded by the Palette backend. Do not treat these as labels only.",
      "",
      "## Impeccable",
      skillBlock("SKILL.md", impeccable.skill),
      skillBlock("reference/teach.md", impeccable.teach),
      skillBlock("reference/document.md", impeccable.document),
      skillBlock("reference/polish.md", impeccable.polish),
      "",
      "## Taste Skill",
      skillBlock(taste.source, taste.content),
      "",
      "## Emil Design Engineering",
      skillBlock(emil.source, emil.content),
    ].join("\n"),
  };
}

export async function loadImpeccableSkill(env = process.env) {
  const root = path.resolve(env.IMPECCABLE_SKILL_PATH || defaultImpeccablePath);
  const required = {
    skill: "SKILL.md",
    teach: "reference/teach.md",
    document: "reference/document.md",
    polish: "reference/polish.md",
    product: "reference/product.md",
  };

  for (const relative of Object.values(required)) {
    if (!existsSync(path.join(root, relative))) {
      throw httpError(500, `Impeccable skill file missing: ${path.join(root, relative)}`);
    }
  }

  const loaded = {};
  for (const [key, relative] of Object.entries(required)) {
    loaded[key] = await readFile(path.join(root, relative), "utf8");
  }

  return {
    kind: "local",
    name: "Impeccable",
    root,
    source: root,
    ...loaded,
  };
}

export async function loadRemoteSkill(key, env = process.env) {
  const config = remoteSkills[key];
  if (!config) throw httpError(500, `Unknown skill key: ${key}`);

  const cachePath = inside(workspaceRoot(env), path.join(skillCacheDir, config.cacheFile));
  await mkdir(path.dirname(cachePath), { recursive: true });

  let content = "";
  let source = config.urls[0];
  let lastError = null;

  try {
    for (const url of config.urls) {
      try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        content = await response.text();
        source = url;
        break;
      } catch (error) {
        lastError = error;
      }
    }
    if (!content) throw lastError || new Error("No candidate URL loaded.");
    await writeFile(cachePath, content, "utf8");
  } catch (error) {
    if (!existsSync(cachePath)) {
      throw httpError(500, `Could not load ${config.name}: ${error.message}`);
    }
    content = await readFile(cachePath, "utf8");
    source = cachePath;
  }

  if (!content.includes("name:") && content.length < 500) {
    throw httpError(500, `${config.name} did not load a valid SKILL.md file.`);
  }

  return {
    kind: "remote",
    name: config.name,
    source,
    cachePath,
    content,
  };
}

export function workspaceRoot(env = process.env) {
  return path.resolve(env.PALETTE_WORKSPACE || process.cwd());
}

function summarizeSkill(skill) {
  if (!skill || skill.error) {
    return {
      loaded: false,
      error: cleanText(skill?.error || "Skill unavailable.", 220),
    };
  }

  return {
    loaded: true,
    name: skill.name,
    source: skill.source,
    root: skill.root,
    bytes: byteCount(skill.content || skill.skill || ""),
  };
}

function byteCount(value) {
  return Buffer.byteLength(String(value), "utf8");
}

function skillBlock(label, content) {
  return [
    `### ${label}`,
    "```md",
    String(content || "").slice(0, 24000),
    "```",
  ].join("\n");
}
