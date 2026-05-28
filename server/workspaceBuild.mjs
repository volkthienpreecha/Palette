import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, statSync } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { cleanText, httpError, inside, normalizeProject } from "./handoffBundle.mjs";
import { ensureDesignWorkspace, loadWorkspaceBrief, saveDesignContext } from "./designWorkspace.mjs";
import { loadSkillStack, workspaceRoot } from "./skillRegistry.mjs";

const sectionKinds = new Set([
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

export async function startWorkspaceBuild(payload = {}, emit = () => {}, env = process.env, options = {}) {
  emitProgress(emit, "phase", "Reading your brief", "Palette is opening the project workspace.");
  const context = await saveDesignContext(payload, env);
  const designWorkspace = await ensureDesignWorkspace({ projectId: context.projectId }, env);
  const buildRequest = buildRequestPayload("start", {
    ...payload,
    projectId: context.projectId,
    brief: context.brief,
    references: context.references,
    notes: context.notes,
  });

  return runWorkspaceCodex({
    mode: "start",
    payload: buildRequest,
    designWorkspace,
    emit,
    env,
    options,
  });
}

export async function patchWorkspaceBuild(payload = {}, emit = () => {}, env = process.env, options = {}) {
  emitProgress(emit, "phase", "Reading the selected area", "Palette is preparing a focused steering pass.");
  const projectId = cleanText(payload.projectId, 100);
  if (!projectId) throw httpError(400, "projectId is required.");
  const designWorkspace = await ensureDesignWorkspace({ projectId }, env);
  const saved = await loadWorkspaceBrief(projectId, env);

  return runWorkspaceCodex({
    mode: "patch",
    payload: buildRequestPayload("patch", {
      ...payload,
      brief: payload.brief || saved.brief,
      references: payload.references || saved.references,
      notes: payload.notes || saved.notes,
    }),
    designWorkspace,
    emit,
    env,
    options,
  });
}

export async function polishWorkspaceBuild(payload = {}, emit = () => {}, env = process.env, options = {}) {
  emitProgress(emit, "phase", "Loading the finishing pass", "Palette is reading the real polish skill.");
  const projectId = cleanText(payload.projectId, 100);
  if (!projectId) throw httpError(400, "projectId is required.");
  const designWorkspace = await ensureDesignWorkspace({ projectId }, env);
  const saved = await loadWorkspaceBrief(projectId, env);

  return runWorkspaceCodex({
    mode: "polish",
    payload: buildRequestPayload("polish", {
      ...payload,
      brief: payload.brief || saved.brief,
      references: payload.references || saved.references,
      notes: payload.notes || saved.notes,
      command: payload.command || "Make this feel finished.",
    }),
    designWorkspace,
    emit,
    env,
    options,
  });
}

export function buildEngineStatus(env = process.env) {
  const selectedProvider = selectBuildProvider(env);
  const configuredProvider = cleanText(env.PALETTE_BUILD_PROVIDER, 40).toLowerCase() || "auto";
  const codexCommand = resolveCodexCommand(env);
  const codexLooksLocal = codexCommand !== "codex" && codexCommand !== "codex.cmd";
  const providers = {
    codex: {
      configured: codexLooksLocal || Boolean(env.CODEX_CMD || env.CODEX_CLI_PATH),
      model: cleanText(env.CODEX_MODEL, 80) || "codex default",
      command: codexCommand,
      detail: codexLooksLocal
        ? "Codex CLI was found locally. It still needs a valid logged-in session to run builds."
        : "Codex CLI is selected, but Palette has not confirmed a local Codex command path.",
    },
    claude: {
      configured: Boolean(env.ANTHROPIC_API_KEY || env.CLAUDE_API_KEY),
      model: providerModel("claude", env),
      detail: env.ANTHROPIC_API_KEY || env.CLAUDE_API_KEY
        ? "Claude key is set. Palette can ask Claude to generate workspace frontend files."
        : "Set ANTHROPIC_API_KEY or CLAUDE_API_KEY to use Claude builds.",
    },
    openai: {
      configured: Boolean(env.OPENAI_API_KEY || env.CODEX_API_KEY),
      model: providerModel("openai", env),
      detail: env.OPENAI_API_KEY || env.CODEX_API_KEY
        ? "OpenAI key is set. Palette can ask an OpenAI builder model for workspace frontend files."
        : "Set OPENAI_API_KEY or CODEX_API_KEY to use OpenAI builds.",
    },
  };
  const selected = providers[selectedProvider];
  const ready = selectedProvider === "codex" ? selected.configured : selected.configured;
  const label = selectedProvider === "codex"
    ? `Codex ${ready ? "CLI found" : "needs setup"}`
    : `${providerDisplayName(selectedProvider)} ${ready ? "ready" : "needs setup"}`;

  return {
    ok: true,
    selectedProvider,
    configuredProvider,
    label,
    ready,
    model: selected.model,
    detail: selected.detail,
    providers,
    note: "This is a local configuration check. The next build still verifies the provider by actually running it.",
  };
}

async function runWorkspaceCodex({ mode, payload, designWorkspace, emit, env, options = {} }) {
  const skillStack = await loadSkillStack(env);
  await mkdir(designWorkspace.generatedDir, { recursive: true });
  const requestRel = `${designWorkspace.relative}/build-request-${mode}.json`.replaceAll("\\", "/");
  const requestPath = inside(workspaceRoot(env), requestRel);
  await writeFile(requestPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  await writeFile(path.join(designWorkspace.root, "skill-context.md"), skillStack.asPrompt, "utf8");

  emitProgress(emit, "phase", "Studying references", `${payload.references.length} references and ${payload.notes.length} notes included.`);
  emitProgress(emit, "phase", "Sketching the first screen", "A real model is being asked to write a generated project.");

  if (env.PALETTE_BUILD_DRY_RUN === "1") {
    const project = fallbackProject(payload);
    await writeGeneratedFiles(designWorkspace, project);
    emitProgress(emit, "result", "Local dry run wrote generated files", "Codex was skipped by configuration.");
    return resultPayload({ mode, designWorkspace, project, source: "dry-run", summary: "Dry run generated Palette files." });
  }

  const allowedFiles = generatedFiles(designWorkspace);
  const boundaryBefore = await boundarySnapshot(workspaceRoot(env), designWorkspace.relative, allowedFiles);
  const provider = selectBuildProvider(env);

  if (provider === "codex") {
    await runCodex({
      mode,
      workspace: workspaceRoot(env),
      designWorkspace,
      requestRel,
      model: cleanText(env.CODEX_MODEL, 80),
      timeoutMs: Number(env.PALETTE_BUILD_TIMEOUT_MS || 240000),
      env,
      emit,
    });
  } else {
    await runModelBuild({
      mode,
      provider,
      payload,
      designWorkspace,
      skillStack,
      env,
      emit,
      options,
    });
  }

  emitProgress(emit, "phase", "Checking the details", "Palette is validating the generated project file.");
  await verifyGeneratedFiles(workspaceRoot(env), allowedFiles);
  await verifyBoundarySnapshot(workspaceRoot(env), designWorkspace.relative, allowedFiles, boundaryBefore);
  const project = await readGeneratedProject(designWorkspace);
  emitProgress(emit, "result", "Ready to steer", "The generated canvas is live.");
  return resultPayload({
    mode,
    designWorkspace,
    project,
    source: provider === "codex" ? "codex-cli" : provider,
    summary: provider === "codex" ? "Codex wrote the workspace generated files." : `${providerDisplayName(provider)} wrote the workspace generated files.`,
  });
}

async function runModelBuild({ mode, provider, payload, designWorkspace, skillStack, env, emit, options = {} }) {
  if (mode === "start") {
    await runProgressiveModelBuild({ provider, payload, designWorkspace, skillStack, env, emit, options });
    return;
  }

  if ((mode === "patch" || mode === "polish") && payload.selectedSection && payload.currentProject?.sections?.length) {
    await runFocusedSectionModelBuild({ mode, provider, payload, designWorkspace, skillStack, env, emit, options });
    return;
  }

  emitProgress(emit, "phase", providerDisplayName(provider), "A real model is painting the workspace files.");
  const project = await requestModelProject({ mode, provider, payload, skillStack, env, signal: options.signal });
  const normalized = normalizeGeneratedProject(project, payload, mode);
  await writeGeneratedFiles(designWorkspace, normalized);
  emitProgress(emit, "phase", "Writing generated files", "Palette wrote the model output into the workspace.");
}

async function runFocusedSectionModelBuild({ mode, provider, payload, designWorkspace, skillStack, env, emit, options = {} }) {
  const currentProject = normalizeFrontendProject(payload.currentProject);
  const selectedId = cleanId(payload.selectedId || payload.selectedSection?.id);
  const selectedIndex = Math.max(
    0,
    currentProject.sections.findIndex((section) => section.id === selectedId),
  );
  const originalSection = currentProject.sections[selectedIndex] || payload.selectedSection;
  const plannedSection = {
    id: originalSection.id,
    kind: originalSection.kind,
    title: originalSection.title,
    purpose: mode === "polish"
      ? "Apply a finishing pass to this selected section."
      : cleanText(payload.command, 260) || "Apply the user's steering note to this selected section.",
  };

  emitProgress(
    emit,
    "phase",
    mode === "polish" ? "Finishing the selected area" : "Steering the selected area",
    "Claude is regenerating the selected section artifact only.",
  );

  const generated = await requestModelJson({
    provider,
    messages: buildSectionPatchMessages({ mode, payload, skillStack, plannedSection, originalSection, currentProject, index: selectedIndex }),
    env,
    mode: "section",
    signal: options.signal,
  });
  const patchedSection = normalizeGeneratedSection(generated, plannedSection, payload, selectedIndex);
  const nextSection = {
    ...originalSection,
    ...patchedSection,
    id: originalSection.id,
    kind: originalSection.kind,
    title: patchedSection.title || originalSection.title,
    generated: patchedSection.generated,
  };

  currentProject.sections = currentProject.sections.map((section, index) =>
    index === selectedIndex ? nextSection : section,
  );
  currentProject.brushLog = [
    ...(currentProject.brushLog || []),
    {
      id: `log-${mode}-${Date.now()}`,
      label: mode === "polish" ? "section finished" : "section steered",
      detail: `Generated ${nextSection.generated?.componentName || nextSection.title} as an updated section artifact.`,
    },
  ].slice(-50);

  await writeGeneratedFiles(designWorkspace, currentProject);
  emitSection(emit, {
    label: mode === "polish" ? "Section finished" : "Section updated",
    detail: "Preview updated from a regenerated section artifact.",
    index: selectedIndex,
    section: nextSection,
    project: currentProject,
    designWorkspace,
  });
}

async function runProgressiveModelBuild({ provider, payload, designWorkspace, skillStack, env, emit, options = {} }) {
  emitProgress(emit, "phase", "Planning the canvas", "Palette is choosing the shortest useful section path.");
  const plan = env.PALETTE_AI_SECTION_PLAN === "1"
    ? normalizeSectionPlan(
        await requestModelJson({
          provider,
          messages: buildPlanMessages({ payload, skillStack, env }),
          env,
          mode: "plan",
          signal: options.signal,
        }),
        payload,
        env,
      )
    : defaultSectionPlan(payload, env);

  const project = {
    id: payload.projectId || `palette-${Date.now()}`,
    name: plan.name,
    theme: plan.theme,
    swatches: payload.references || [],
    sections: [],
    brushLog: [
      { id: "log-plan", label: "Plan mixed", detail: `${providerDisplayName(provider)} planned ${plan.sections.length} sections before painting.` },
    ],
    past: [],
    future: [],
  };

  await writeGeneratedFiles(designWorkspace, project);

  for (let index = 0; index < plan.sections.length; index += 1) {
    throwIfAborted(options.signal);
    const plannedSection = plan.sections[index];
    emitProgress(
      emit,
      "phase",
      sectionPaintLabel(plannedSection, index),
      plannedSection.purpose || "A focused section is being generated as real TSX and CSS.",
    );

    const generated = await requestGeneratedSection({
      provider,
      payload,
      skillStack,
      env,
      plan,
      plannedSection,
      project,
      index,
      signal: options.signal,
    });
    const section = normalizeGeneratedSection(generated, plannedSection, payload, index);
    project.sections.push(section);
    project.brushLog.push({
      id: `log-${section.id}`,
      label: `${section.kind} painted`,
      detail: `Generated ${section.generated?.componentName || section.title} as a section artifact.`,
    });
    await writeGeneratedFiles(designWorkspace, project);
    emitSection(emit, {
      label: sectionStatusLabel(section, index),
      detail: "Preview updated from a generated section artifact.",
      index,
      section,
      project,
      designWorkspace,
    });
  }
}

async function requestGeneratedSection({ provider, payload, skillStack, env, plan, plannedSection, project, index, signal }) {
  return requestModelJson({
    provider,
    messages: buildSectionMessages({ payload, skillStack, plan, plannedSection, project, index }),
    env,
    mode: "section",
    signal,
  });
}

async function requestModelProject({ mode, provider, payload, skillStack, env, signal }) {
  const messages = buildModelMessages({ mode, payload, skillStack });
  return requestModelJson({ provider, messages, env, mode, signal });
}

async function requestModelJson({ provider, messages, env, mode, signal }) {
  const requestBody = modelRequestBody(provider, messages, mode, env);

  let body = {};
  let response = null;
  let fetchFailure = null;
  let parseFailure = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    throwIfAborted(signal);
    try {
      response = await fetch(providerEndpoint(provider), {
        method: "POST",
        headers: providerHeaders(provider, env),
        body: requestBody,
        signal,
      });
      fetchFailure = null;
    } catch (error) {
      if (error?.name === "AbortError") throw error;
      fetchFailure = error;
      if (attempt === 2) break;
      await delay(1000 * (attempt + 1));
      continue;
    }

    body = await response.json().catch(() => ({}));
    if (response.ok) {
      const structured = providerResponseObject(provider, body, mode);
      if (structured) return structured;

      const content = cleanModelJson(providerResponseContent(provider, body));
      if (!content) {
        parseFailure = new Error(`${providerDisplayName(provider)} returned no project JSON.`);
        if (attempt === 2) break;
        await delay(1000 * (attempt + 1));
        continue;
      }

      try {
        return JSON.parse(content);
      } catch (error) {
        parseFailure = error;
        if (attempt === 2) break;
        await delay(1000 * (attempt + 1));
        continue;
      }
    }

    if (response.status !== 429 || attempt === 2) break;
    await delay(modelRetryDelayMs(response, body, attempt));
  }

  if (fetchFailure) {
    const message = cleanText(fetchFailure.message || "network request failed", 220);
    throw httpError(502, `${providerDisplayName(provider)} build failed. ${message}`);
  }

  if (parseFailure) {
    const message = parseFailure.message?.includes("no project JSON")
      ? `${providerDisplayName(provider)} returned no project JSON.`
      : `${providerDisplayName(provider)} returned invalid project JSON.`;
    throw httpError(500, message);
  }

  if (!response?.ok) {
    const message = cleanText(providerErrorMessage(provider, body, response), 220);
    throw httpError(response?.status || 500, `${providerDisplayName(provider)} build failed. ${message}`);
  }
}

function providerResponseObject(provider, body, mode) {
  if (provider !== "claude" || !Array.isArray(body?.content)) return null;
  const toolUse = body.content.find((block) =>
    block?.type === "tool_use" &&
    block?.name === "return_palette_json" &&
    block?.input &&
    typeof block.input === "object" &&
    !Array.isArray(block.input)
  );
  const input = toolUse?.input || null;
  if (!input) return null;
  if (mode === "section") {
    const generated = input.generated && typeof input.generated === "object" ? input.generated : null;
    if (
      !generated ||
      typeof generated.html !== "string" ||
      typeof generated.css !== "string" ||
      typeof generated.tsx !== "string"
    ) {
      return null;
    }
  }
  if (mode === "plan" && !Array.isArray(input.sections)) return null;
  return input;
}

function modelRequestBody(provider, messages, mode, env) {
  const temperature = mode === "start" ? 0.62 : 0.35;
  if (provider === "claude") {
    const system = messages
      .filter((message) => message.role === "system")
      .map((message) => message.content)
      .join("\n\n");
    const user = messages
      .filter((message) => message.role !== "system")
      .map((message) => message.content)
      .join("\n\n");

    return JSON.stringify({
      model: providerModel(provider, env),
      max_tokens: positiveInteger(
        env.CLAUDE_MAX_TOKENS,
        mode === "section" ? 4500 : mode === "plan" ? 2200 : 7000,
      ),
      temperature,
      system,
      messages: [{ role: "user", content: user }],
      tools: [
        {
          name: "return_palette_json",
          description: "Return the requested Palette JSON object.",
          input_schema: claudeToolSchema(mode),
        },
      ],
      tool_choice: { type: "tool", name: "return_palette_json" },
    });
  }

  return JSON.stringify({
    model: providerModel(provider, env),
    messages,
    temperature,
    response_format: { type: "json_object" },
  });
}

function claudeToolSchema(mode) {
  if (mode === "section") {
    return {
      type: "object",
      required: ["section", "generated"],
      properties: {
        section: {
          type: "object",
          required: ["id", "kind", "title"],
          properties: {
            id: { type: "string" },
            kind: { type: "string" },
            title: { type: "string" },
            subtitle: { type: "string" },
            eyebrow: { type: "string" },
            variant: { type: "string" },
          },
          additionalProperties: true,
        },
        generated: {
          type: "object",
          required: ["componentName", "html", "css", "tsx"],
          properties: {
            componentName: { type: "string" },
            html: { type: "string" },
            css: { type: "string" },
            tsx: { type: "string" },
          },
          additionalProperties: false,
        },
      },
      additionalProperties: false,
    };
  }

  if (mode === "plan") {
    return {
      type: "object",
      required: ["name", "theme", "sections"],
      properties: {
        name: { type: "string" },
        theme: { type: "string" },
        sections: {
          type: "array",
          items: {
            type: "object",
            required: ["id", "kind", "title", "purpose"],
            properties: {
              id: { type: "string" },
              kind: { type: "string" },
              title: { type: "string" },
              purpose: { type: "string" },
            },
            additionalProperties: false,
          },
        },
      },
      additionalProperties: false,
    };
  }

  return {
    type: "object",
    properties: {},
    additionalProperties: true,
  };
}

function providerHeaders(provider, env) {
  if (provider === "claude") {
    return {
      "Content-Type": "application/json",
      "x-api-key": providerKey(provider, env),
      "anthropic-version": cleanText(env.ANTHROPIC_VERSION, 50) || "2023-06-01",
    };
  }

  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${providerKey(provider, env)}`,
  };
}

function providerResponseContent(provider, body) {
  if (provider === "claude") {
    if (Array.isArray(body?.content)) {
      return body.content
        .map((block) => block?.type === "text" ? block.text : "")
        .filter(Boolean)
        .join("\n");
    }
    return body?.completion || body?.content || "";
  }

  return body?.choices?.[0]?.message?.content || body?.output_text || "";
}

function providerErrorMessage(provider, body, response) {
  if (provider === "claude") {
    return body?.error?.message || body?.error?.type || body?.message || `${providerDisplayName(provider)} returned ${response?.status}`;
  }
  return body?.error?.message || body?.message || `${providerDisplayName(provider)} returned ${response?.status}`;
}

function modelRetryDelayMs(response, body, attempt) {
  const retryAfter = Number(response.headers.get("retry-after"));
  if (Number.isFinite(retryAfter) && retryAfter > 0) return Math.min(20000, retryAfter * 1000);
  const message = String(body?.error?.message || body?.message || "");
  const match = message.match(/try again in\s+([0-9.]+)s/i);
  if (match) return Math.min(20000, Math.ceil(Number(match[1]) * 1000) + 500);
  return 1500 * (attempt + 1);
}

function buildModelMessages({ mode, payload, skillStack }) {
  const system = [
    "You are Palette's real frontend-building model provider.",
    "Return JSON only. No markdown. No commentary.",
    "Create a PaletteProject-shaped object with id, name, theme, sections, swatches, brushLog, past, and future.",
    "Allowed section kinds: nav, hero, features, pricing, cta, footer, testimonials, stats, form, gallery, note.",
    "Allowed section variants: atelier, premium, playful, minimal, glass, editorial.",
    "Use no emojis. Do not include secrets, API keys, file paths, or terminal instructions.",
    "Use the Impeccable, Taste, and Emil skill context as design rules, not as visible copy.",
    "The visual direction should feel painterly, premium, direct, and non-slop.",
    mode === "patch"
      ? "Patch only what the user asked for. Preserve unrelated sections and ids when possible."
      : "",
    mode === "polish"
      ? "Apply a finishing pass: improve hierarchy, spacing, copy clarity, section balance, and interaction readiness without changing intent."
      : "",
  ].filter(Boolean).join(" ");

  const user = JSON.stringify({
    mode,
    brief: payload.brief,
    command: payload.command,
    selectedId: payload.selectedId,
    selectedSection: payload.selectedSection,
    references: payload.references,
    notes: payload.notes,
    currentProject: payload.currentProject,
    skillContext: compactSkillContext(skillStack, mode),
    outputContract: exampleProjectContract(payload, mode),
  });

  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}

function buildPlanMessages({ payload, skillStack, env }) {
  const sectionLimit = positiveInteger(env.PALETTE_SECTION_LIMIT, 7);
  const system = [
    "You are Palette's planning pass for a live frontend painter.",
    "Return JSON only. No markdown. No commentary.",
    "Plan a website as a sequence of sections that can be generated one at a time.",
    "Do not design generic placeholders. Section titles must be real user-facing copy, never labels like nav section or stats section.",
    "Allowed section kinds: nav, hero, features, pricing, cta, footer, testimonials, stats, form, gallery, note.",
    `Return ${Math.max(4, Math.min(sectionLimit, 8))} sections maximum.`,
    "Use the loaded Impeccable, Taste, and Emil skill context as design direction.",
  ].join(" ");

  const user = JSON.stringify({
    brief: payload.brief,
    references: payload.references,
    notes: payload.notes,
    skillContext: compactSkillContext(skillStack, "start"),
    outputContract: {
      name: "Meaningful project name",
      theme: "atelier",
      sections: [
        {
          id: "section-nav",
          kind: "nav",
          title: "Brand or product name, not nav section",
          purpose: "What this section must communicate",
        },
      ],
    },
  });

  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}

function buildSectionMessages({ payload, skillStack, plan, plannedSection, project, index }) {
  const system = [
    "You are Palette's live section painter.",
    "Return JSON only. No markdown. No commentary.",
    "Generate exactly one section as real frontend artifacts, not a template selection.",
    "The visible preview must come from generated.html and generated.css. The export must include generated.tsx.",
    "Use semantic HTML, bespoke layout, and section-specific CSS. Avoid generic cards unless the content truly needs cards.",
    "Keep the section compact: CSS under 180 lines, HTML under 80 lines, TSX under 120 lines.",
    "Do not use @import, remote font CSS, CSS comments, or long decorative SVG illustrations.",
    "Never use placeholder text such as nav section, stats section, lorem ipsum, or section title.",
    "Do not include script tags, external dependencies, imports, secrets, terminal instructions, or emojis.",
    "The TSX must export a named React component with no imports and no external libraries.",
    "Use plain class names scoped by the component name. CSS should target those class names.",
    "Honor Impeccable, Taste Skill, and Emil motion/design rules as craft direction.",
  ].join(" ");

  const user = JSON.stringify({
    brief: payload.brief,
    references: payload.references,
    notes: payload.notes,
    overallPlan: plan,
    previousSections: project.sections.map((section) => ({
      id: section.id,
      kind: section.kind,
      title: section.title,
    })),
    sectionIndex: index,
    plannedSection,
    skillContext: compactSkillContext(skillStack, "start"),
    outputContract: {
      section: {
        id: plannedSection.id,
        kind: plannedSection.kind,
        title: "Real user-facing title",
        subtitle: "Optional user-facing support copy",
        eyebrow: "Optional short label",
        variant: "editorial",
        actions: [{ label: "Real action", tone: "primary" }],
      },
      generated: {
        componentName: "PascalCaseComponentName",
        html: "<div class=\"component-name\">semantic preview markup for this one section</div>",
        css: ".component-name { ... }",
        tsx: "export function PascalCaseComponentName() { return (<section className=\"component-name\">...</section>); }",
      },
    },
  });

  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}

function buildSectionPatchMessages({ mode, payload, skillStack, plannedSection, originalSection, currentProject, index }) {
  const system = [
    "You are Palette's selected-section steering painter.",
    "Return JSON only. No markdown. No commentary.",
    "Regenerate exactly one selected section as real frontend artifacts.",
    "The visible preview must come from generated.html and generated.css. The export must include generated.tsx.",
    "Do not return the whole project. Do not modify unrelated sections.",
    "Keep the section compact: CSS under 180 lines, HTML under 80 lines, TSX under 120 lines.",
    "Do not use @import, remote font CSS, CSS comments, long decorative SVG illustrations, placeholders, or emojis.",
    "The TSX must export a named React component with no imports and no external libraries.",
    "Preserve the selected section's purpose unless the user explicitly asks to change it.",
    mode === "polish"
      ? "Apply polish through spacing, hierarchy, motion readiness, copy clarity, and interaction states."
      : "Apply the user's steering note directly to the selected section.",
    "Honor Impeccable, Taste Skill, and Emil motion/design rules as craft direction.",
  ].join(" ");

  const user = JSON.stringify({
    mode,
    command: payload.command,
    selectedId: payload.selectedId,
    selectedSection: originalSection,
    currentGenerated: originalSection.generated,
    neighboringSections: currentProject.sections.map((section) => ({
      id: section.id,
      kind: section.kind,
      title: section.title,
      selected: section.id === originalSection.id,
    })),
    references: payload.references,
    notes: payload.notes,
    skillContext: compactSkillContext(skillStack, mode),
    sectionIndex: index,
    plannedSection,
    outputContract: {
      section: {
        id: originalSection.id,
        kind: originalSection.kind,
        title: "Real user-facing title",
        subtitle: "Optional user-facing support copy",
        eyebrow: "Optional short label",
      },
      generated: {
        componentName: "PascalCaseComponentName",
        html: "<section class=\"component-scope\">Real preview markup</section>",
        css: ".component-scope { real scoped CSS }",
        tsx: "export function PascalCaseComponentName() { return <section className=\"component-scope\">...</section>; }",
      },
    },
  });

  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}

function compactSkillContext(skillStack, mode) {
  const impeccable = skillStack.impeccable || {};
  const chunks = [
    "# Loaded Skill Context",
    "The backend loaded the real local Impeccable skill and remote Taste/Emil skills before this call.",
    "",
    "## Impeccable Teach Rules",
    compactText(impeccable.teach, 1200),
    "",
    mode === "polish" ? "## Impeccable Polish Rules" : "## Impeccable Product Rules",
    compactText(mode === "polish" ? impeccable.polish : impeccable.product, 1100),
    "",
    "## Taste Skill Rules",
    compactText(skillStack.taste?.content, 900),
    "",
    "## Emil Motion Rules",
    compactText(skillStack.emil?.content, 900),
  ];
  return chunks.join("\n");
}

function compactText(value, maxLength) {
  return String(value || "")
    .replace(/```[\s\S]*?```/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function exampleProjectContract(payload, mode) {
  return {
    id: payload.projectId || "palette-project",
    name: payload.brief?.product || "Generated canvas",
    theme: "atelier",
    sections: [
      {
        id: "hero",
        kind: "hero",
        title: "Clear headline",
        subtitle: "Useful supporting copy.",
        eyebrow: "Optional label",
        variant: "editorial",
        actions: [{ label: "Join waitlist", tone: "primary" }],
      },
    ],
    swatches: payload.references || [],
    brushLog: [{ id: `log-${mode}`, label: "Canvas painted", detail: "A real AI provider wrote this workspace." }],
    past: [],
    future: [],
  };
}

function normalizeGeneratedProject(project, payload, mode) {
  const normalized = normalizeFrontendProject({
    ...project,
    id: cleanText(project?.id, 80) || payload.projectId || `palette-${Date.now()}`,
    name: cleanText(project?.name, 80) || cleanText(payload.brief?.product, 80) || "Palette project",
    swatches: Array.isArray(project?.swatches) && project.swatches.length > 0 ? project.swatches : payload.references,
    brushLog: Array.isArray(project?.brushLog) && project.brushLog.length > 0
      ? project.brushLog
      : [
          {
            id: `log-${mode}-${Date.now()}`,
            label: mode === "start" ? "Canvas painted" : mode === "patch" ? "Canvas steered" : "Canvas finished",
            detail: "Palette used real skill context and a live model provider.",
          },
        ],
    past: [],
    future: [],
  });

  if (mode !== "start") {
    normalized.sections = preserveUnchangedSections(normalized.sections, payload.currentProject?.sections);
  }

  if (mode === "start" && normalized.sections.length < 4) {
    normalized.sections = ensureStarterSections(normalized.sections, payload);
  }

  if (normalized.sections.length === 0) {
    throw httpError(500, "The model returned no usable Palette sections.");
  }

  return normalized;
}

function normalizeSectionPlan(plan, payload, env) {
  const product = cleanText(payload.brief?.product || payload.command || "Generated canvas", 90) || "Generated canvas";
  const sectionLimit = Math.max(4, Math.min(positiveInteger(env.PALETTE_SECTION_LIMIT, 7), 8));
  const rawSections = Array.isArray(plan?.sections) ? plan.sections : [];
  const sections = rawSections
    .map((section, index) => normalizePlannedSection(section, index))
    .filter(Boolean)
    .slice(0, sectionLimit);

  const hasNav = sections.some((section) => section.kind === "nav");
  const hasHero = sections.some((section) => section.kind === "hero");
  const hasFooter = sections.some((section) => section.kind === "footer");
  const completed = [
    hasNav ? null : { id: "section-nav", kind: "nav", title: product, purpose: "Navigation and primary action." },
    hasHero ? null : { id: "section-hero", kind: "hero", title: product, purpose: "First viewport promise and action." },
    ...sections,
    hasFooter ? null : { id: "section-footer", kind: "footer", title: product, purpose: "Final brand mark and contact path." },
  ].filter(Boolean);

  return {
    name: cleanText(plan?.name, 90) || product,
    theme: plan?.theme === "premium" ? "premium" : "atelier",
    sections: dedupePlannedSections(completed).slice(0, sectionLimit),
  };
}

function defaultSectionPlan(payload, env) {
  const product = cleanText(payload.brief?.product || payload.command || "Generated canvas", 90) || "Generated canvas";
  const goal = cleanText(payload.brief?.goal, 140);
  const limit = Math.max(3, Math.min(positiveInteger(env.PALETTE_SECTION_LIMIT, 4), 6));
  const base = [
    {
      id: "section-nav",
      kind: "nav",
      title: product,
      purpose: "Brand navigation and one clear primary action.",
    },
    {
      id: "section-hero",
      kind: "hero",
      title: product,
      purpose: goal || "First viewport with a specific promise, a clear action, and a visual point of view.",
    },
    {
      id: "section-features",
      kind: "features",
      title: "Why it matters",
      purpose: "Three concrete reasons, services, or benefits that make the page useful.",
    },
    {
      id: "section-form",
      kind: "form",
      title: "Start the conversation",
      purpose: "A useful lead, booking, waitlist, or contact path.",
    },
    {
      id: "section-footer",
      kind: "footer",
      title: product,
      purpose: "Final brand mark and contact reminder.",
    },
  ];

  return {
    name: product,
    theme: "atelier",
    sections: base.slice(0, limit),
  };
}

function normalizePlannedSection(section, index) {
  const kind = sectionKinds.has(section?.kind) ? section.kind : "";
  if (!kind) return null;
  const fallbackId = `section-${kind}-${index + 1}`;
  return {
    id: cleanId(section.id) || fallbackId,
    kind,
    title: cleanSectionTitle(section.title, kind),
    purpose: cleanText(section.purpose || section.subtitle || section.goal, 260),
  };
}

function dedupePlannedSections(sections) {
  const seenIds = new Set();
  return sections.map((section, index) => {
    let id = cleanId(section.id) || `section-${section.kind}-${index + 1}`;
    if (seenIds.has(id)) id = `${id}-${index + 1}`;
    seenIds.add(id);
    return { ...section, id };
  });
}

function normalizeGeneratedSection(generated, plannedSection, payload, index) {
  const rawSection = generated?.section && typeof generated.section === "object" ? generated.section : generated;
  const kind = sectionKinds.has(rawSection?.kind) ? rawSection.kind : plannedSection.kind;
  const section = normalizeFrontendProject({
    id: payload.projectId || `palette-${Date.now()}`,
    name: payload.brief?.product || "Palette project",
    theme: "atelier",
    sections: [
      {
        ...rawSection,
        id: cleanId(rawSection?.id) || plannedSection.id,
        kind,
        title: cleanSectionTitle(rawSection?.title || plannedSection.title, kind),
      },
    ],
    swatches: [],
    brushLog: [],
  }).sections[0];

  const assetSource = generated?.generated && typeof generated.generated === "object" ? generated.generated : generated;
  const componentName = cleanComponentName(assetSource?.componentName) || componentNameForSection(section, index);
  const asset = sanitizeGeneratedAsset(assetSource, section, componentName);
  return {
    ...section,
    generated: asset,
  };
}

function sanitizeGeneratedAsset(assetSource, section, componentName) {
  const html = cleanGeneratedHtml(assetSource?.html) || fallbackGeneratedHtml(section, componentName);
  const css = cleanGeneratedCss(assetSource?.css) || fallbackGeneratedCss(componentName);
  const tsx = cleanGeneratedTsx(assetSource?.tsx) || fallbackGeneratedTsx(section, componentName);

  return {
    componentName,
    html,
    css,
    tsx,
    files: [
      { path: `generated/sections/${componentName}.tsx`, content: tsx },
      { path: `generated/sections/${componentName}.css`, content: css },
    ],
  };
}

function cleanSectionTitle(value, kind) {
  const cleaned = cleanText(value, 120);
  if (!cleaned || new RegExp(`^${kind}\\s+section$`, "i").test(cleaned) || /^section\s+\d+$/i.test(cleaned)) {
    if (kind === "nav") return "Studio";
    if (kind === "hero") return "A page with a point of view.";
    if (kind === "footer") return "Stay in touch.";
    return "Built with intention.";
  }
  return cleaned;
}

function cleanComponentName(value) {
  const cleaned = cleanText(value, 80).replace(/[^a-zA-Z0-9]/g, "");
  if (!cleaned) return "";
  const next = `${cleaned[0].toUpperCase()}${cleaned.slice(1)}`;
  return /^[A-Z][A-Za-z0-9]*$/.test(next) ? next : "";
}

function componentNameForSection(section, index) {
  const base = cleanComponentName(`${section.kind}${index + 1}`) || `Section${index + 1}`;
  return `Palette${base}`;
}

function cleanGeneratedHtml(value) {
  if (typeof value !== "string") return "";
  return normalizeGeneratedText(value)
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/javascript:/gi, "")
    .trim()
    .slice(0, 18000);
}

function cleanGeneratedCss(value) {
  if (typeof value !== "string") return "";
  return normalizeGeneratedText(value)
    .replace(/@import\s+url\([^)]*\)\s*;?/gi, "")
    .replace(/^\s*@import[^\r\n]*(?:\r?\n|$)/gim, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/url\(\s*javascript:[^)]+\)/gi, "")
    .trim()
    .slice(0, 18000);
}

function cleanGeneratedTsx(value) {
  if (typeof value !== "string") return "";
  return normalizeGeneratedText(value)
    .replace(/import\s+[^;]+;?/g, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/javascript:/gi, "")
    .trim()
    .slice(0, 24000);
}

function normalizeGeneratedText(value) {
  return String(value ?? "")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\u2026/g, "...")
    .replace(/[^\x09\x0A\x0D\x20-\x7E]/g, "");
}

function fallbackGeneratedHtml(section, componentName) {
  return `<section class="${kebabCase(componentName)}"><p>${escapeHtml(section.eyebrow || section.kind)}</p><h2>${escapeHtml(section.title)}</h2>${section.subtitle ? `<p>${escapeHtml(section.subtitle)}</p>` : ""}</section>`;
}

function fallbackGeneratedCss(componentName) {
  const className = kebabCase(componentName);
  return `.${className} { padding: 48px; border-radius: 24px; background: #f6efe1; color: #1b160f; } .${className} h2 { margin: 0; font-size: clamp(2rem, 5vw, 4.5rem); font-family: Georgia, serif; font-weight: 400; }`;
}

function fallbackGeneratedTsx(section, componentName) {
  const className = kebabCase(componentName);
  return `export function ${componentName}() {\n  return (\n    <section className="${className}">\n      <p>${escapeHtml(section.eyebrow || section.kind)}</p>\n      <h2>${escapeHtml(section.title)}</h2>\n      ${section.subtitle ? `<p>${escapeHtml(section.subtitle)}</p>` : "null"}\n    </section>\n  );\n}\n`;
}

function kebabCase(value) {
  return String(value || "section")
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function preserveUnchangedSections(modelSections, currentSections = []) {
  if (!Array.isArray(currentSections) || currentSections.length <= modelSections.length) return modelSections;
  const byId = new Map(modelSections.map((section) => [section.id, section]));
  const merged = currentSections.map((section) => byId.get(section.id) || section);
  const known = new Set(merged.map((section) => section.id));
  for (const section of modelSections) {
    if (!known.has(section.id)) merged.push(section);
  }
  return merged;
}

function ensureStarterSections(modelSections, payload) {
  const fallback = fallbackProject(payload).sections;
  const byKind = new Set(modelSections.map((section) => section.kind));
  const next = [...modelSections];

  for (const section of fallback) {
    if (next.length >= 5) break;
    if (byKind.has(section.kind)) continue;
    byKind.add(section.kind);
    next.push(section);
  }

  return next;
}

function runCodex({ mode, workspace, designWorkspace, requestRel, model, timeoutMs, env, emit }) {
  const allowedJson = `${designWorkspace.relative}/generated/palette-project.json`.replaceAll("\\", "/");
  const allowedTsx = `${designWorkspace.relative}/generated/PalettePage.tsx`.replaceAll("\\", "/");
  const prompt = [
    "You are Codex building a Palette workspace from real design skills.",
    `Read ${requestRel}.`,
    `Read ${designWorkspace.relative.replaceAll("\\", "/")}/PRODUCT.md, DESIGN.md, and skill-context.md.`,
    `Write exactly these files and no others: ${allowedJson} and ${allowedTsx}.`,
    "The JSON file must contain a PaletteProject-shaped object with id, name, theme, sections, swatches, brushLog, past, and future.",
    "Use only these section kinds: nav, hero, features, pricing, cta, footer, testimonials, stats, form, gallery, note.",
    "Use only these variants: atelier, premium, playful, minimal, glass, editorial.",
    mode === "start"
      ? "Create a complete first frontend from the user's brief and references."
      : "Patch the existing project according to the steering command while preserving unrelated sections.",
    mode === "polish"
      ? "Apply the Impeccable polish pass: fix alignment, spacing, hierarchy, copy clarity, and motion details without changing the user's intent."
      : "Keep the result useful and directly editable.",
    "Do not include secrets or API keys. Do not use emojis. Do not edit Palette app source files.",
    "When done, summarize the files written.",
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
  ];
  if (model) codexArgs.push("-m", model);
  codexArgs.push("--", prompt);

  const usesCmdShim = process.platform === "win32" && /\.cmd$/i.test(codexCommand);
  const command = usesCmdShim ? "cmd.exe" : codexCommand;
  const args = usesCmdShim ? ["/d", "/s", "/c", codexCommand, ...codexArgs] : codexArgs;

  return new Promise((resolve, reject) => {
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
      reject(httpError(504, "Codex build timed out."));
    }, Math.max(30000, timeoutMs || 240000));

    const progress = (label) => (chunk) => {
      const text = chunk.toString();
      if (label.includes("writing")) stdout = tail(stdout + text, 8000);
      else stderr = tail(stderr + text, 8000);
      emitProgress(emit, "output", label, cleanProgressDetail(text) || "Codex is still working.");
    };

    child.stdout.on("data", progress("Codex is writing the workspace"));
    child.stderr.on("data", progress("Codex is checking the workspace"));
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(httpError(500, `Could not start Codex CLI: ${error.message}`));
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code !== 0) {
        reject(httpError(500, `Codex build failed with exit code ${code}. ${cleanProgressDetail(stderr || stdout)}`));
        return;
      }
      if (codexOutputIndicatesFailure(stdout, stderr)) {
        reject(httpError(500, `Codex build failed. ${cleanProgressDetail(stderr || stdout)}`));
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

function buildRequestPayload(mode, payload) {
  return {
    mode,
    projectId: cleanText(payload.projectId, 100),
    command: cleanText(payload.command || payload.instruction || "", 1000),
    selectedId: cleanText(payload.selectedId, 120),
    selectedSection: payload.selectedSection || null,
    brief: payload.brief || {},
    references: Array.isArray(payload.references) ? payload.references : [],
    notes: Array.isArray(payload.notes) ? payload.notes : [],
    currentProject: payload.project || null,
    createdAt: new Date().toISOString(),
  };
}

async function readGeneratedProject(designWorkspace) {
  const file = path.join(designWorkspace.generatedDir, "palette-project.json");
  const raw = await readFile(file, "utf8");
  const parsed = JSON.parse(raw);
  return normalizeFrontendProject(parsed);
}

async function writeGeneratedFiles(designWorkspace, project) {
  const sectionsDir = path.join(designWorkspace.generatedDir, "sections");
  await mkdir(sectionsDir, { recursive: true });
  await writeFile(path.join(designWorkspace.generatedDir, "palette-project.json"), `${JSON.stringify(project, null, 2)}\n`, "utf8");
  await writeFile(path.join(designWorkspace.generatedDir, "PalettePage.tsx"), generatedPalettePageSource(), "utf8");
  await writeSectionArtifacts(sectionsDir, project);
}

async function writeSectionArtifacts(sectionsDir, project) {
  const manifest = [];
  for (const section of project.sections || []) {
    const asset = section.generated;
    if (!asset?.componentName) continue;
    const componentName = cleanComponentName(asset.componentName);
    if (!componentName) continue;
    const tsx = cleanGeneratedTsx(asset.tsx);
    const css = cleanGeneratedCss(asset.css);
    if (tsx) {
      await writeFile(path.join(sectionsDir, `${componentName}.tsx`), `${tsx}\n`, "utf8");
    }
    if (css) {
      await writeFile(path.join(sectionsDir, `${componentName}.css`), `${css}\n`, "utf8");
    }
    manifest.push({
      id: section.id,
      kind: section.kind,
      componentName,
      files: [
        tsx ? `generated/sections/${componentName}.tsx` : "",
        css ? `generated/sections/${componentName}.css` : "",
      ].filter(Boolean),
    });
  }

  await writeFile(path.join(sectionsDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

function generatedPalettePageSource() {
  return String.raw`import type { CSSProperties, FormEvent } from "react";
import project from "./palette-project.json";

type PaletteProject = {
  id: string;
  name: string;
  theme: string;
  swatchAccent?: string;
  swatchColors?: string[];
  sections: PaletteSection[];
};

type PaletteAction = { label: string; href?: string; tone?: "primary" | "secondary" };
type PaletteLink = { label: string; href?: string };
type PaletteFeature = { title: string; copy: string; accent?: string };
type PalettePlan = { name: string; price: string; copy: string; featured?: boolean };
type PaletteTestimonial = { quote: string; name: string; role?: string };
type PaletteStat = { value: string; label: string };
type PaletteField = { id: string; label: string; type?: "text" | "email" | "tel" | "url" | "number"; placeholder?: string };
type PaletteGalleryItem = { title: string; copy?: string; imageUrl?: string; imageAlt?: string };

type PaletteSection = {
  id: string;
  kind: string;
  title: string;
  subtitle?: string;
  eyebrow?: string;
  variant?: string;
  imageUrl?: string;
  imageAlt?: string;
  hasWaitlist?: boolean;
  links?: PaletteLink[];
  actions?: PaletteAction[];
  features?: PaletteFeature[];
  plans?: PalettePlan[];
  testimonials?: PaletteTestimonial[];
  stats?: PaletteStat[];
  fields?: PaletteField[];
  gallery?: PaletteGalleryItem[];
  footerText?: string;
};

const paletteProject = project as PaletteProject;

const defaultFeatures: PaletteFeature[] = [
  { title: "Clear promise", copy: "A focused section shaped from the saved Palette brief." },
  { title: "Reference-aware", copy: "Images, links, and notes remain attached to the generated workspace." },
  { title: "Ready to steer", copy: "Each section keeps a stable id for follow-up edits." },
];

const styles: Record<string, CSSProperties> = {
  page: {
    minHeight: "100vh",
    background: "linear-gradient(180deg, #f6efe1 0%, #e8dcc6 100%)",
    color: "#211a12",
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif",
  },
  inner: {
    width: "min(1120px, calc(100% - 32px))",
    margin: "0 auto",
    padding: "48px 0",
    display: "grid",
    gap: 18,
  },
  section: {
    border: "1px solid rgba(90, 70, 42, 0.2)",
    borderRadius: 18,
    padding: 28,
    background: "rgba(255, 250, 239, 0.72)",
    boxShadow: "0 22px 70px rgba(47, 36, 22, 0.08)",
  },
  eyebrow: {
    display: "inline-block",
    marginBottom: 10,
    fontSize: 11,
    fontWeight: 800,
    letterSpacing: "0.12em",
    textTransform: "uppercase",
    color: "#8b6a33",
  },
  h1: {
    margin: 0,
    maxWidth: 820,
    fontFamily: "Cormorant Garamond, Georgia, serif",
    fontSize: "clamp(48px, 7vw, 92px)",
    fontWeight: 400,
    lineHeight: 0.98,
  },
  h2: {
    margin: 0,
    fontFamily: "Cormorant Garamond, Georgia, serif",
    fontSize: "clamp(32px, 4vw, 56px)",
    fontWeight: 400,
    lineHeight: 1.05,
  },
  paragraph: {
    maxWidth: 680,
    margin: "12px 0 0",
    color: "#5f5142",
    fontSize: 16,
    lineHeight: 1.65,
  },
  row: {
    display: "flex",
    flexWrap: "wrap",
    gap: 10,
    marginTop: 22,
  },
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))",
    gap: 14,
    marginTop: 22,
  },
  card: {
    border: "1px solid rgba(90, 70, 42, 0.18)",
    borderRadius: 14,
    padding: 18,
    background: "rgba(255, 253, 246, 0.76)",
  },
  button: {
    border: 0,
    borderRadius: 999,
    padding: "12px 18px",
    background: "#211a12",
    color: "#f8efe0",
    fontWeight: 800,
  },
  secondary: {
    border: "1px solid rgba(90, 70, 42, 0.24)",
    borderRadius: 999,
    padding: "11px 17px",
    background: "transparent",
    color: "#211a12",
    fontWeight: 800,
  },
  nav: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 16,
  },
  navLinks: {
    display: "flex",
    flexWrap: "wrap",
    gap: 14,
  },
};

export function PalettePage() {
  const accent = paletteProject.swatchAccent || paletteProject.swatchColors?.[0];
  const pageStyle = accent ? ({ ...styles.page, "--palette-accent": accent } as CSSProperties) : styles.page;

  return (
    <main style={pageStyle} data-palette-project={paletteProject.id}>
      <div style={styles.inner}>
        {paletteProject.sections.map((section) => (
          <section
            key={section.id}
            style={section.kind === "nav" ? { ...styles.section, padding: "18px 22px" } : styles.section}
            data-section-id={section.id}
            data-section-kind={section.kind}
            data-section-variant={section.variant || paletteProject.theme}
          >
            <SectionView section={section} />
          </section>
        ))}
      </div>
    </main>
  );
}

function SectionView({ section }: { section: PaletteSection }) {
  switch (section.kind) {
    case "nav":
      return <NavSection section={section} />;
    case "hero":
      return <HeroSection section={section} />;
    case "features":
      return <FeaturesSection section={section} />;
    case "pricing":
      return <PricingSection section={section} />;
    case "testimonials":
      return <TestimonialsSection section={section} />;
    case "stats":
      return <StatsSection section={section} />;
    case "form":
      return <FormSection section={section} />;
    case "gallery":
      return <GallerySection section={section} />;
    case "cta":
      return <CtaSection section={section} />;
    case "footer":
      return <FooterSection section={section} />;
    default:
      return <Intro section={section} />;
  }
}

function NavSection({ section }: { section: PaletteSection }) {
  return (
    <nav style={styles.nav} aria-label={section.title}>
      <strong>{section.title}</strong>
      <div style={styles.navLinks}>
        {(section.links || []).map((link) => (
          <a href={link.href || "#"} key={link.label}>{link.label}</a>
        ))}
      </div>
      {section.actions?.[0] ? <ActionButton action={section.actions[0]} /> : null}
    </nav>
  );
}

function HeroSection({ section }: { section: PaletteSection }) {
  return (
    <div>
      {section.eyebrow ? <span style={styles.eyebrow}>{section.eyebrow}</span> : null}
      <h1 style={styles.h1}>{section.title}</h1>
      {section.subtitle ? <p style={styles.paragraph}>{section.subtitle}</p> : null}
      {section.imageUrl ? <img src={section.imageUrl} alt={section.imageAlt || ""} style={{ width: "100%", marginTop: 22, borderRadius: 16 }} /> : null}
      {section.hasWaitlist ? <InlineForm section={section} /> : <Actions actions={section.actions} />}
    </div>
  );
}

function FeaturesSection({ section }: { section: PaletteSection }) {
  const items = section.features && section.features.length > 0 ? section.features : defaultFeatures;
  return (
    <div>
      <Intro section={section} />
      <div style={styles.grid}>
        {items.map((item) => (
          <article style={styles.card} key={item.title}>
            <h3>{item.title}</h3>
            <p style={styles.paragraph}>{item.copy}</p>
          </article>
        ))}
      </div>
    </div>
  );
}

function PricingSection({ section }: { section: PaletteSection }) {
  return (
    <div>
      <Intro section={section} />
      <div style={styles.grid}>
        {(section.plans || []).map((plan) => (
          <article style={{ ...styles.card, borderColor: plan.featured ? "#8b6a33" : "rgba(90, 70, 42, 0.18)" }} key={plan.name}>
            <h3>{plan.name}</h3>
            <strong>{plan.price}</strong>
            <p style={styles.paragraph}>{plan.copy}</p>
          </article>
        ))}
      </div>
    </div>
  );
}

function TestimonialsSection({ section }: { section: PaletteSection }) {
  return (
    <div>
      <Intro section={section} />
      <div style={styles.grid}>
        {(section.testimonials || []).map((item) => (
          <blockquote style={styles.card} key={item.name}>
            <p style={styles.paragraph}>{item.quote}</p>
            <footer>{item.name}{item.role ? " · " + item.role : ""}</footer>
          </blockquote>
        ))}
      </div>
    </div>
  );
}

function StatsSection({ section }: { section: PaletteSection }) {
  return (
    <div>
      <Intro section={section} />
      <div style={styles.grid}>
        {(section.stats || []).map((item) => (
          <article style={styles.card} key={item.label}>
            <strong style={{ fontSize: 34 }}>{item.value}</strong>
            <p style={styles.paragraph}>{item.label}</p>
          </article>
        ))}
      </div>
    </div>
  );
}

function FormSection({ section }: { section: PaletteSection }) {
  return (
    <div>
      <Intro section={section} />
      <InlineForm section={section} />
    </div>
  );
}

function GallerySection({ section }: { section: PaletteSection }) {
  return (
    <div>
      <Intro section={section} />
      <div style={styles.grid}>
        {(section.gallery || []).map((item) => (
          <article style={styles.card} key={item.title}>
            {item.imageUrl ? <img src={item.imageUrl} alt={item.imageAlt || ""} style={{ width: "100%", borderRadius: 12 }} /> : null}
            <h3>{item.title}</h3>
            {item.copy ? <p style={styles.paragraph}>{item.copy}</p> : null}
          </article>
        ))}
      </div>
    </div>
  );
}

function CtaSection({ section }: { section: PaletteSection }) {
  return (
    <div>
      <Intro section={section} />
      <Actions actions={section.actions} />
    </div>
  );
}

function FooterSection({ section }: { section: PaletteSection }) {
  return (
    <footer>
      <strong>{section.title}</strong>
      {section.footerText || section.subtitle ? <p style={styles.paragraph}>{section.footerText || section.subtitle}</p> : null}
    </footer>
  );
}

function Intro({ section }: { section: PaletteSection }) {
  return (
    <div>
      {section.eyebrow ? <span style={styles.eyebrow}>{section.eyebrow}</span> : null}
      <h2 style={styles.h2}>{section.title}</h2>
      {section.subtitle ? <p style={styles.paragraph}>{section.subtitle}</p> : null}
    </div>
  );
}

function Actions({ actions }: { actions?: PaletteAction[] }) {
  if (!actions || actions.length === 0) return null;
  return (
    <div style={styles.row}>
      {actions.map((action, index) => (
        <ActionButton action={action} secondary={index > 0 || action.tone === "secondary"} key={action.label} />
      ))}
    </div>
  );
}

function ActionButton({ action, secondary = false }: { action: PaletteAction; secondary?: boolean }) {
  return (
    <button type="button" style={secondary ? styles.secondary : styles.button} onClick={() => navigateTo(action.href)}>
      {action.label}
    </button>
  );
}

function InlineForm({ section }: { section: PaletteSection }) {
  const fields: PaletteField[] = section.fields && section.fields.length > 0
    ? section.fields
    : [{ id: "email", label: "Email", type: "email", placeholder: "name@example.com" }];
  return (
    <form onSubmit={preventSubmit} style={{ ...styles.grid, gridTemplateColumns: "1fr auto" }}>
      {fields.map((field) => (
        <label key={field.id} style={{ display: "grid", gap: 6 }}>
          <span>{field.label}</span>
          <input
            name={field.id}
            type={field.type || "text"}
            placeholder={field.placeholder}
            style={{ minHeight: 44, borderRadius: 12, border: "1px solid rgba(90, 70, 42, 0.24)", padding: "0 12px" }}
          />
        </label>
      ))}
      <button type="submit" style={{ ...styles.button, alignSelf: "end" }}>Send</button>
    </form>
  );
}

function preventSubmit(event: FormEvent<HTMLFormElement>) {
  event.preventDefault();
}

function navigateTo(href?: string) {
  if (!href) return;
  window.location.href = href;
}

export default PalettePage;
`;
}

function normalizeFrontendProject(project) {
  const normalized = normalizeProject(project);
  return {
    id: normalized.id,
    name: normalized.name,
    theme: normalized.theme,
    swatchAccent: normalized.swatchAccent,
    swatchColors: normalized.swatchColors,
    sections: normalized.sections,
    swatches: Array.isArray(project.swatches) ? project.swatches.slice(0, 24) : [],
    brushLog: Array.isArray(project.brushLog) && project.brushLog.length > 0
      ? project.brushLog.slice(0, 40)
      : [{ id: `log-${Date.now()}`, label: "Canvas painted", detail: "Codex wrote the generated workspace files." }],
    past: [],
    future: [],
  };
}

function fallbackProject(payload) {
  const product = cleanText(payload.brief?.product || payload.command || "Generated canvas", 80) || "Generated canvas";
  const audience = cleanText(payload.brief?.audience, 120) || "the intended audience";
  const feeling = cleanText(payload.brief?.feeling, 120) || "polished and clear";

  return {
    id: payload.projectId || `palette-${Date.now()}`,
    name: product.slice(0, 70),
    theme: "atelier",
    sections: [
      {
        id: "nav",
        kind: "nav",
        title: product,
        links: [{ label: "Work" }, { label: "Details" }, { label: "Contact" }],
        actions: [{ label: "Start" }],
        variant: "atelier",
      },
      {
        id: "hero",
        kind: "hero",
        title: product,
        subtitle: `A ${feeling} first screen shaped for ${audience}.`,
        eyebrow: "Painted from your brief",
        actions: [{ label: "Join waitlist" }],
        variant: "editorial",
      },
      {
        id: "features",
        kind: "features",
        title: "What the canvas makes clear",
        subtitle: "The first version stays useful, editable, and ready to steer.",
        features: [
          { title: "Clear promise", copy: "The page says what it does without extra jargon." },
          { title: "Reference-aware", copy: "Images, links, and notes shape the visual direction." },
          { title: "Ready to revise", copy: "Every section can be selected and steered." },
        ],
        variant: "atelier",
      },
      {
        id: "cta",
        kind: "cta",
        title: "Ready for the next stroke.",
        subtitle: "Select any section and tell Palette what to change.",
        actions: [{ label: "Steer this" }],
        variant: "glass",
      },
    ],
    swatches: payload.references || [],
    brushLog: [
      { id: "log-brief", label: "Brief read", detail: "Palette used the workspace design brief." },
      { id: "log-skills", label: "Skills loaded", detail: "Impeccable, Taste Skill, and Emil context were included." },
    ],
    past: [],
    future: [],
  };
}

function resultPayload({ mode, designWorkspace, project, source, summary }) {
  const sectionFiles = (project.sections || [])
    .flatMap((section) => section.generated?.files || [])
    .map((file) => `${designWorkspace.relative}/${file.path}`.replaceAll("\\", "/"));

  return {
    applied: true,
    mode,
    source,
    projectId: designWorkspace.projectId,
    workspace: designWorkspace.relative.replaceAll("\\", "/"),
    project,
    files: [
      `${designWorkspace.relative}/generated/palette-project.json`,
      `${designWorkspace.relative}/generated/PalettePage.tsx`,
      `${designWorkspace.relative}/generated/sections/manifest.json`,
      ...sectionFiles,
    ].map((item) => item.replaceAll("\\", "/")),
    status: mode === "polish" ? "Finished the selected surface." : mode === "patch" ? "Steered the generated canvas." : "Painted the first generated canvas.",
    summary,
  };
}

function generatedFiles(designWorkspace) {
  return [
    `${designWorkspace.relative}/generated/palette-project.json`,
    `${designWorkspace.relative}/generated/PalettePage.tsx`,
  ].map((item) => item.replaceAll("\\", "/"));
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
    throw httpError(500, `Codex finished but did not produce the expected workspace files: ${details}.`);
  }
}

async function boundarySnapshot(workspace, allowedRoot, allowedFiles) {
  const allowed = new Set(allowedFiles.map(normalizePath));
  const allowedPrefix = `${normalizePath(allowedRoot).replace(/\/$/, "")}/`;
  const ignoredDirs = new Set([".git", "dist", "node_modules", "qa"]);
  const snapshot = new Map();

  async function walk(directory, relativeBase = "") {
    const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);

    for (const entry of entries) {
      const relativePath = normalizePath(path.join(relativeBase, entry.name));
      if (entry.isDirectory()) {
        if (ignoredDirs.has(entry.name)) continue;
        if (relativePath === normalizePath(allowedRoot) || relativePath.startsWith(allowedPrefix)) continue;
        await walk(path.join(directory, entry.name), relativePath);
        continue;
      }

      if (!entry.isFile() || allowed.has(relativePath) || isBoundaryIgnoredFile(relativePath)) continue;
      const content = await readFile(path.join(directory, entry.name)).catch(() => null);
      if (content) snapshot.set(relativePath, createHash("sha256").update(content).digest("hex"));
    }
  }

  await walk(workspace);
  return snapshot;
}

async function verifyBoundarySnapshot(workspace, allowedRoot, allowedFiles, before) {
  const after = await boundarySnapshot(workspace, allowedRoot, allowedFiles);
  const changed = [];

  for (const [file, hash] of after.entries()) {
    if (!before.has(file) || before.get(file) !== hash) changed.push(file);
  }

  for (const file of before.keys()) {
    if (!after.has(file)) changed.push(file);
  }

  if (changed.length > 0) {
    throw httpError(500, `Builder changed files outside the Palette workspace boundary: ${changed.slice(0, 5).join(", ")}.`);
  }
}

function isBoundaryIgnoredFile(relativePath) {
  const normalized = normalizePath(relativePath);
  return normalized === ".env" ||
    normalized === ".palette/workspace-state.json" ||
    /^\.palette\/workspace-state\.json\.\d+\.\d+\.tmp$/.test(normalized);
}

function normalizePath(value) {
  return String(value).replace(/\\/g, "/").replace(/^"|"$/g, "");
}

function cleanId(value) {
  if (typeof value !== "string") return "";
  return value
    .replace(/[^a-zA-Z0-9_-]/g, "")
    .slice(0, 80);
}

function emitProgress(emit, type, label, detail) {
  if (typeof emit !== "function") return;
  emit({
    type,
    label: cleanText(label, 140),
    detail: cleanProgressDetail(detail),
    at: new Date().toISOString(),
  });
}

function emitSection(emit, { label, detail, index, section, project, designWorkspace }) {
  if (typeof emit !== "function") return;
  emit({
    type: "section",
    label: cleanText(label, 140),
    detail: cleanProgressDetail(detail),
    index,
    projectId: designWorkspace.projectId,
    workspace: designWorkspace.relative.replaceAll("\\", "/"),
    section,
    project,
    at: new Date().toISOString(),
  });
}

function sectionPaintLabel(plannedSection, index) {
  if (plannedSection.kind === "nav") return "Painting navigation";
  if (plannedSection.kind === "hero") return "Laying the hero wash";
  if (plannedSection.kind === "footer") return "Signing the footer";
  return `Painting ${plannedSection.kind || `section ${index + 1}`}`;
}

function sectionStatusLabel(section, index) {
  if (section.kind === "nav") return "Navigation appeared";
  if (section.kind === "hero") return "Hero appeared";
  if (section.kind === "footer") return "Footer appeared";
  return `${section.kind[0].toUpperCase()}${section.kind.slice(1)} appeared`;
}

function throwIfAborted(signal) {
  if (!signal?.aborted) return;
  throw httpError(499, "Painting interrupted.");
}

function codexEnv(env) {
  const next = { ...env };
  if (next.PALETTE_CODEX_USE_API_KEY === "1") {
    if (next.CODEX_API_KEY && !next.OPENAI_API_KEY) next.OPENAI_API_KEY = next.CODEX_API_KEY;
  } else {
    delete next.OPENAI_API_KEY;
    delete next.CODEX_API_KEY;
  }
  return next;
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

function selectBuildProvider(env) {
  const configured = cleanText(env.PALETTE_BUILD_PROVIDER, 20).toLowerCase();
  if (["codex", "claude", "openai"].includes(configured)) return configured;
  if (env.ANTHROPIC_API_KEY || env.CLAUDE_API_KEY) return "claude";
  const codexCommand = resolveCodexCommand(env);
  if (codexCommand !== "codex" && codexCommand !== "codex.cmd") return "codex";
  if (env.CODEX_CMD || env.CODEX_CLI_PATH) return "codex";
  if (env.OPENAI_API_KEY || env.CODEX_API_KEY) return "openai";
  return "codex";
}

function providerEndpoint(provider) {
  if (provider === "claude") return "https://api.anthropic.com/v1/messages";
  if (provider === "groq") return "https://api.groq.com/openai/v1/chat/completions";
  return "https://api.openai.com/v1/chat/completions";
}

function providerKey(provider, env) {
  if (provider === "claude") {
    const key = env.ANTHROPIC_API_KEY || env.CLAUDE_API_KEY;
    if (!key) throw httpError(500, "ANTHROPIC_API_KEY or CLAUDE_API_KEY is required for Claude builds.");
    return key;
  }

  if (provider === "groq") {
    if (!env.GROQ_API_KEY) throw httpError(500, "GROQ_API_KEY is required for Groq builds.");
    return env.GROQ_API_KEY;
  }

  const key = env.OPENAI_API_KEY || env.CODEX_API_KEY;
  if (!key) throw httpError(500, "OPENAI_API_KEY or CODEX_API_KEY is required for OpenAI builds.");
  return key;
}

function providerModel(provider, env) {
  if (provider === "claude") return cleanText(env.CLAUDE_BUILD_MODEL || env.ANTHROPIC_MODEL || env.CLAUDE_MODEL, 100) || "claude-sonnet-4-6";
  if (provider === "groq") return cleanText(env.GROQ_BUILD_MODEL, 100) || "openai/gpt-oss-120b";
  return cleanText(env.OPENAI_BUILD_MODEL || env.OPENAI_MODEL, 100) || "gpt-4.1";
}

function providerDisplayName(provider) {
  if (provider === "groq") return "Groq";
  if (provider === "claude") return "Claude";
  if (provider === "openai") return "OpenAI";
  return "Codex";
}

function newestDesktopCodex(desktopBin) {
  if (!existsSync(desktopBin)) return "";
  return readdirSync(desktopBin, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(desktopBin, entry.name, "codex.exe"))
    .filter((candidate) => existsSync(candidate))
    .sort((left, right) => statSync(right).mtimeMs - statSync(left).mtimeMs)[0] || "";
}

function cleanModelJson(value) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) return "";
  if (text.startsWith("{")) return text;
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) return fenced[1].trim();
  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  return first >= 0 && last > first ? text.slice(first, last + 1) : text;
}

function cleanProgressDetail(value) {
  if (typeof value !== "string") return "";
  return value
    .replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/sk-[A-Za-z0-9_-]+/g, "[redacted]")
    .replace(/gsk_[A-Za-z0-9_-]+/g, "[redacted]")
    .replace(/\*{8,}[A-Za-z0-9_-]*/g, "[redacted]")
    .replace(/[^\x09\x0A\x0D\x20-\x7E]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 220);
}

function codexOutputIndicatesFailure(stdout, stderr) {
  const text = `${stderr || ""}\n${stdout || ""}`;
  return /\b401 Unauthorized\b/i.test(text) ||
    /\bexceeded retry limit\b/i.test(text) ||
    /(^|\n)\s*ERROR:/i.test(text);
}

function tail(value, maxLength) {
  return value.length > maxLength ? value.slice(value.length - maxLength) : value;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
}
