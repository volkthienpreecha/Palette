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

const sectionVariants = new Set(["atelier", "premium", "playful", "minimal", "glass", "editorial"]);
const templates = new Set(["robot-coffee", "portfolio", "studio-saas"]);
const themes = new Set(["atelier", "premium"]);
const fieldTypes = new Set(["text", "email", "tel", "url"]);
const robotCoffeeReference = "/robot-coffee-reference.png";
const patchKeys = new Set([
  "title",
  "subtitle",
  "eyebrow",
  "variant",
  "titleSizeBoost",
  "imageUrl",
  "imageAlt",
  "hasWaitlist",
  "footerText",
  "actions",
  "links",
  "features",
  "plans",
  "testimonials",
  "stats",
  "fields",
  "gallery",
]);

export async function resolvePlanner(payload, env = process.env) {
  const request = normalizeRequest(payload);
  const local = parseLocalIntent(request);

  if (local.operations.some((operation) => operation.type === "start_project")) {
    return {
      operations: local.operations,
      status: local.status,
      source: "local",
      provider: "local",
    };
  }

  if (local.operations.length > 0 && shouldPreferLocal(request)) {
    return {
      operations: local.operations,
      status: local.status,
      source: "local",
      provider: "local",
    };
  }

  const provider = selectPlannerProvider(env);
  if (provider.name === "local") {
    return {
      operations: local.operations,
      status: local.status,
      source: "local",
      provider: "local",
    };
  }

  if (!provider.available) {
    return {
      operations: local.operations,
      status: `${provider.unavailableReason} ${local.status}`,
      source: "local",
      provider: provider.name,
    };
  }

  try {
    const generated = await callPlannerProvider(request, provider, env);
    const validated = validateIntentResult(generated, request);

    if (validated.operations.length === 0) {
      return {
        operations: local.operations,
        status: `Planner returned no valid Palette operations. ${local.status}`,
        source: "fallback",
        provider: provider.name,
      };
    }

    return {
      operations: validated.operations,
      status: validated.status || "Translated the stroke into safe Palette operations.",
      source: "provider",
      provider: provider.name,
    };
  } catch (error) {
    return {
      operations: local.operations,
      status: `Planner bridge unavailable. ${local.status}`,
      source: "fallback",
      provider: provider.name,
      detail: error instanceof Error ? error.message : "Unknown bridge error",
    };
  }
}

export async function resolveIntent(payload, env = process.env) {
  const result = await resolvePlanner(payload, env);
  return {
    ...result,
    source: result.source === "provider" && result.provider === "openai" ? "openai" : result.source,
  };
}

function normalizeRequest(payload) {
  if (!payload || typeof payload !== "object") {
    throw httpError(400, "Expected a JSON object.");
  }

  const command = typeof payload.command === "string" ? payload.command.trim() : "";
  const selectedId = typeof payload.selectedId === "string" ? payload.selectedId : null;
  const project = payload.project && typeof payload.project === "object" ? payload.project : {};
  const selectedSection = summarizeSelectedSection(payload.selectedSection, project, selectedId);
  const notes = summarizeNotes(payload.notes, project);
  const references = summarizeReferences(payload.references, project);

  return { command, selectedId, project, selectedSection, notes, references };
}

function summarizeSelectedSection(selectedSection, project, selectedId) {
  if (selectedSection && typeof selectedSection === "object") {
    return summarizeSectionForPlanner(selectedSection);
  }

  const sections = Array.isArray(project.sections) ? project.sections : [];
  const section = selectedId ? sections.find((item) => item.id === selectedId) : undefined;
  return section ? summarizeSectionForPlanner(section) : null;
}

function summarizeNotes(notes, project) {
  const explicitNotes = Array.isArray(notes)
    ? notes.map((note) => sanitizePlannerNote(note)).filter(Boolean)
    : [];
  const sectionNotes = Array.isArray(project.sections)
    ? project.sections
        .filter((section) => section?.kind === "note")
        .map((section) => sanitizePlannerNote({
          id: section.id,
          title: section.title,
          note: section.subtitle,
          pinnedTo: section.eyebrow,
        }))
        .filter(Boolean)
    : [];

  return dedupeContext([...explicitNotes, ...sectionNotes]).slice(0, 10);
}

function summarizeReferences(references, project) {
  const source = Array.isArray(references)
    ? references
    : Array.isArray(project.swatches)
      ? project.swatches
      : [];

  return source.map((reference) => sanitizePlannerReference(reference)).filter(Boolean).slice(0, 10);
}

function summarizeSectionForPlanner(section) {
  return dropUndefined({
    id: cleanId(section.id),
    kind: sectionKinds.has(section.kind) ? section.kind : undefined,
    title: cleanText(section.title, 100),
    subtitle: cleanText(section.subtitle, 180),
    eyebrow: cleanText(section.eyebrow, 80),
    variant: sectionVariants.has(section.variant) ? section.variant : undefined,
  });
}

function sanitizePlannerNote(note) {
  if (typeof note === "string") {
    const cleaned = cleanText(note, 220);
    return cleaned ? { note: cleaned } : null;
  }
  if (!note || typeof note !== "object") return null;

  const cleaned = dropUndefined({
    id: cleanId(note.id),
    title: cleanText(note.title, 80),
    note: cleanText(note.note || note.subtitle || note.detail, 220),
    pinnedTo: cleanText(note.pinnedTo || note.eyebrow, 100),
  });
  return cleaned.note ? cleaned : null;
}

function sanitizePlannerReference(reference) {
  if (!reference || typeof reference !== "object") return null;

  const cleaned = dropUndefined({
    id: cleanId(reference.id),
    title: cleanText(reference.title, 80),
    note: cleanText(reference.note || reference.subtitle || reference.detail, 180),
    url: cleanHref(reference.url),
    tone: ["paper", "glass", "ink"].includes(reference.tone) ? reference.tone : undefined,
    colors: arrayOf(reference.colors, 5).map(cleanColor).filter(Boolean),
  });
  return cleaned.title || cleaned.note || cleaned.url ? cleaned : null;
}

function dedupeContext(items) {
  const seen = new Set();
  return items.filter((item) => {
    const key = item.id || item.note || item.title;
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function parseLocalIntent({ command, selectedId, project }) {
  const text = command.toLowerCase();
  const sections = Array.isArray(project.sections) ? project.sections : [];
  const selected = selectedId ? sections.find((section) => section.id === selectedId) : undefined;

  if (!text) {
    return { operations: [], status: "No brushstroke given." };
  }

  const preciseOperations = preciseSectionOperationsFromText(command, text, project, selectedId, selected);
  if (preciseOperations.length > 0) {
    return {
      operations: preciseOperations,
      status: statusForPreciseOperations(preciseOperations),
    };
  }

  if (text.includes("portfolio") || looksLikeAtelierSite(text)) {
    return {
      operations: [{ type: "start_project", template: "portfolio" }],
      status: "Local parser selected an editorial portfolio model.",
    };
  }

  if (text.includes("saas") || text.includes("dashboard") || text.includes("team")) {
    return {
      operations: [{ type: "start_project", template: "studio-saas" }],
      status: "Local parser selected a calm software workspace model.",
    };
  }

  if (
    text.includes("robot coffee") ||
    text.includes("coffee shop") ||
    text.includes("coffee") ||
    text.includes("cafe") ||
    text.includes("roast")
  ) {
    return {
      operations: [{ type: "start_project", template: "robot-coffee" }],
      status: "Local parser selected the robot coffee shop model.",
    };
  }

  if (text.includes("build") || text.includes("landing page") || text.includes("website") || text.includes("site")) {
    return {
      operations: [{ type: "start_project", template: "studio-saas" }],
      status: "Local parser selected a calm software workspace model.",
    };
  }

  if (text.includes("darker") || text.includes("premium") || text.includes("apple")) {
    return {
      operations: [
        { type: "set_theme", theme: "premium" },
        ...sections.map((section) => ({
          type: "set_variant",
          id: section.id,
          variant: section.variant === "playful" ? "playful" : "premium",
        })),
      ],
      status: "Local parser mixed a darker glaze.",
    };
  }

  if (text.includes("lighter") || text.includes("atelier") || text.includes("classic")) {
    return { operations: [{ type: "set_theme", theme: "atelier" }], status: "Local parser restored atelier mode." };
  }

  const sectionOperations = sectionOperationsFromText(text, project, selectedId, selected);
  if (sectionOperations.length > 0) {
    return {
      operations: sectionOperations,
      status:
        sectionOperations.length === 1
          ? statusForSectionOperation(sectionOperations[0])
          : "Local parser painted the requested canvas changes in one pass.",
    };
  }

  if (text.includes("playful")) {
    const id = selectedId ?? firstSectionId(project, "features") ?? firstSectionId(project, "hero");
    return id
      ? { operations: [{ type: "set_variant", id, variant: "playful" }], status: "Local parser changed one area." }
      : { operations: [], status: "Select a section before painting that style." };
  }

  if (text.includes("minimal") || text.includes("quieter")) {
    const id = selectedId ?? firstSectionId(project, "hero");
    return id
      ? { operations: [{ type: "set_variant", id, variant: "minimal" }], status: "Local parser quieted one area." }
      : { operations: [], status: "Select a section before quieting it." };
  }

  if (text.includes("delete") || text.includes("remove")) {
    return selectedId
      ? { operations: [{ type: "remove_section", id: selectedId }], status: "Local parser removed the selected section." }
      : { operations: [], status: "Select a section before removing it." };
  }

  if (text.includes("move up")) {
    return selectedId
      ? { operations: [{ type: "move_section", id: selectedId, direction: -1 }], status: "Local parser moved it upward." }
      : { operations: [], status: "Select a section before moving it." };
  }

  if (text.includes("move down")) {
    return selectedId
      ? { operations: [{ type: "move_section", id: selectedId, direction: 1 }], status: "Local parser moved it downward." }
      : { operations: [], status: "Select a section before moving it." };
  }

  if (text.includes("set paint") || text.includes("export")) {
    return { operations: [{ type: "export_project" }], status: "Local parser set the paint into a bundle." };
  }

  const id = selectedId ?? firstSectionId(project, "hero") ?? firstAnySectionId(project);
  if (id && (text.includes("headline") || text.includes("title"))) {
    return {
      operations: [{ type: "update_section", id, patch: { title: toTitle(command.replace(/headline|title/gi, "")) } }],
      status: "Local parser repainted the headline.",
    };
  }

  return { operations: [], status: "Local parser saved the note. Select a section for a precise stroke." };
}

function shouldPreferLocal({ command, selectedId }) {
  const text = command.toLowerCase();
  if (selectedId) return true;
  return (
    text.includes("note:") ||
    text.includes("add note") ||
    text.includes("pin note") ||
    text.includes("headline") ||
    text.includes("title:") ||
    text.includes("bigger") ||
    text.includes("picture") ||
    text.includes("image") ||
    text.includes("subtitle") ||
    text.includes("copy:") ||
    text.includes("delete") ||
    text.includes("remove") ||
    text.includes("move up") ||
    text.includes("move down")
  );
}

function preciseSectionOperationsFromText(command, text, project, selectedId, selected) {
  const operations = [];
  const targetId = selectedId ?? firstSectionId(project, "hero") ?? firstAnySectionId(project);
  const noteText = extractNoteText(command);
  const imageTarget = imageTargetSection(project, selectedId);

  if (noteText) {
    const morningRushTarget = morningRushTargetSection(project, selectedId);
    if (wantsMorningRushUseCase(`${text} ${noteText}`) && morningRushTarget) {
      operations.push({
        type: "update_section",
        id: morningRushTarget.id,
        patch: morningRushPatchForSection(morningRushTarget),
      });
    } else {
      operations.push({
        type: "add_section",
        section: noteSection(noteText, selected),
        afterId: selectedId ?? undefined,
      });
    }
  }

  if (targetId && wantsLargerTitle(text)) {
    operations.push({
      type: "update_section",
      id: targetId,
      patch: { titleSizeBoost: nextTitleBoost(selected) },
    });
  }

  if (imageTarget && wantsBetterImage(text)) {
    operations.push({
      type: "update_section",
      id: imageTarget.id,
      patch: imagePatchForSection(imageTarget, project),
    });
  }

  const heroId = firstSectionId(project, "hero") ?? targetId;
  if (heroId && wantsShorterSharperCopy(text)) {
    operations.push({
      type: "update_section",
      id: heroId,
      patch: {
        subtitle: "Fast robot coffee, quiet studio service, ready before the morning rush.",
      },
    });
  }

  if (targetId && wantsPremiumSection(text)) {
    operations.push({
      type: "update_section",
      id: targetId,
      patch: {
        variant: "glass",
        eyebrow: "Premium service pass",
      },
    });
  }

  const title = extractRewriteText(command, [
    /\b(?:change|set|make|rewrite)\s+(?:the\s+)?(?:headline|title|heading)\s+(?:to|as)\s+(.+)$/i,
    /\b(?:headline|title|heading)\s*:\s*(.+)$/i,
    /\bmake\s+(?:this|it|section)\s+say\s+(.+)$/i,
  ]);
  if (targetId && title) {
    operations.push({ type: "update_section", id: targetId, patch: { title } });
  }

  const subtitle = extractRewriteText(command, [
    /\b(?:change|set|make|rewrite)\s+(?:the\s+)?(?:subtitle|subhead|copy|body|description)\s+(?:to|as)\s+(.+)$/i,
    /\b(?:subtitle|subhead|copy|body|description)\s*:\s*(.+)$/i,
  ]);
  if (targetId && subtitle) {
    operations.push({ type: "update_section", id: targetId, patch: { subtitle } });
  }

  const variant = selectedId ? variantFromText(text) : undefined;
  if (selectedId && variant) {
    operations.push({ type: "set_variant", id: selectedId, variant });
  }

  return operations;
}

function extractNoteText(command) {
  return extractRewriteText(command, [
    /\b(?:add|pin|write|leave)\s+(?:a\s+)?note(?:\s+(?:that|says|about))?\s*:?\s*(.+)$/i,
    /^note\s*:?\s*(.+)$/i,
  ]);
}

function extractRewriteText(command, patterns) {
  for (const pattern of patterns) {
    const match = command.match(pattern);
    if (match?.[1]) return cleanFreeform(match[1]);
  }
  return "";
}

function cleanFreeform(value) {
  return value
    .replace(/^[\s"']+|[\s"']+$/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);
}

function variantFromText(text) {
  if (text.includes("playful") || text.includes("fun")) return "playful";
  if (text.includes("minimal") || text.includes("quieter") || text.includes("simple")) return "minimal";
  if (text.includes("glass") || text.includes("glassy") || text.includes("liquid")) return "glass";
  if (text.includes("editorial") || text.includes("atelier") || text.includes("classic")) return "editorial";
  if (text.includes("darker") || text.includes("premium") || text.includes("apple") || text.includes("luxury")) {
    return "glass";
  }
  return undefined;
}

function statusForPreciseOperations(operations) {
  if (
    operations.some(
      (operation) =>
        operation.type === "update_section" && operation.patch.eyebrow === "Morning rush pass",
    )
  ) {
    return "Local parser emphasized the morning rush use case.";
  }

  if (
    operations.some(
      (operation) =>
        operation.type === "update_section" &&
        ("titleSizeBoost" in operation.patch || "imageUrl" in operation.patch || "gallery" in operation.patch),
    )
  ) {
    return "Local parser repainted the selected section from the note.";
  }
  if (operations.some((operation) => operation.type === "add_section" && operation.section.kind === "note")) {
    return "Local parser pinned a note beside the selected section.";
  }
  if (operations.some((operation) => operation.type === "update_section" && "features" in operation.patch)) {
    return "Local parser emphasized the morning rush use case.";
  }
  if (operations.some((operation) => operation.type === "update_section")) {
    if (
      operations.some(
        (operation) =>
          operation.type === "update_section" &&
          ("variant" in operation.patch || "eyebrow" in operation.patch),
      )
    ) {
      return "Local parser repainted the selected section finish.";
    }
    return "Local parser repainted the selected wording.";
  }
  if (operations.some((operation) => operation.type === "set_variant")) {
    return "Local parser changed only the selected section.";
  }
  return "Local parser painted the selected canvas change.";
}

function wantsLargerTitle(text) {
  return (
    (text.includes("bigger") || text.includes("larger") || text.includes("increase")) &&
    (text.includes("title") || text.includes("headline") || text.includes("heading") || text.includes("text"))
  );
}

function nextTitleBoost(selected) {
  return Math.min(18, (Number(selected?.titleSizeBoost) || 0) + 6);
}

function wantsBetterImage(text) {
  return (
    (text.includes("picture") || text.includes("image") || text.includes("photo") || text.includes("visual")) &&
    (text.includes("better") || text.includes("change") || text.includes("replace") || text.includes("swap"))
  );
}

function wantsShorterSharperCopy(text) {
  return (
    (text.includes("copy") || text.includes("subtitle") || text.includes("description") || text.includes("body")) &&
    (text.includes("shorter") || text.includes("sharper") || text.includes("tighter"))
  );
}

function wantsPremiumSection(text) {
  return text.includes("premium") && (text.includes("section") || text.includes("feel") || text.includes("this"));
}

function wantsMorningRushUseCase(text) {
  return text.includes("morning") && (text.includes("rush") || text.includes("commuter") || text.includes("use case"));
}

function morningRushTargetSection(project, selectedId) {
  const sections = Array.isArray(project.sections) ? project.sections : [];
  const selected = selectedId ? sections.find((section) => section.id === selectedId) : undefined;
  return (
    selected ??
    sections.find((section) => section.kind === "features") ??
    sections.find((section) => section.kind === "hero") ??
    sections[0]
  );
}

function morningRushPatchForSection(section) {
  if (section.kind === "features") {
    const features = Array.isArray(section.features) && section.features.length > 0
      ? section.features
      : [
          { title: "Measured pour", copy: "Robotic arms tune grind, heat, and timing for each order." },
          { title: "Human calm", copy: "The room stays quiet, tactile, and easy to understand." },
          { title: "Morning memory", copy: "Regular orders reappear before the line reaches the counter." },
        ];

    return {
      eyebrow: "Morning rush pass",
      title: "Built for the morning rush",
      subtitle: "Fast enough for commuters, quiet enough for regulars.",
      features: features.map((item, index) =>
        index === features.length - 1
          ? {
              ...item,
              title: "Morning rush memory",
              copy: "Regular orders, pickup timing, and repeat favorites surface before the line reaches the counter.",
              accent: "oklch(0.71 0.09 82)",
            }
          : item,
      ),
    };
  }

  return {
    eyebrow: "Morning rush pass",
    subtitle: "Regular orders, pickup timing, and repeat favorites surface before the line reaches the counter.",
  };
}

function imageTargetSection(project, selectedId) {
  const sections = Array.isArray(project.sections) ? project.sections : [];
  const selected = selectedId ? sections.find((section) => section.id === selectedId) : undefined;
  if (selected?.kind === "hero" || selected?.kind === "gallery") return selected;
  return sections.find((section) => section.kind === "hero") ?? sections.find((section) => section.kind === "gallery");
}

function imagePatchForSection(section, project) {
  const reference = latestImageReference(project);
  if (section.kind === "gallery") {
    const gallery = Array.isArray(section.gallery) && section.gallery.length > 0
      ? section.gallery
      : [
          { title: "Robot coffee study", copy: "A softer machine reference for the canvas." },
          { title: "Counter rhythm", copy: "Warm service with a mechanical assistant." },
          { title: "Morning pour", copy: "A clearer visual note for the section." },
        ];

    return {
      gallery: gallery.map((item, index) =>
        index === 0
          ? {
              ...item,
              title: reference.title,
              copy: "A cleaner robot-and-espresso reference for this canvas.",
              imageUrl: reference.url,
              imageAlt: reference.alt,
            }
          : item,
      ),
    };
  }

  return {
    imageUrl: reference.url,
    imageAlt: reference.alt,
    eyebrow: section.eyebrow ?? "Reference upgraded",
  };
}

function latestImageReference(project) {
  const swatch = Array.isArray(project.swatches) ? project.swatches.find((item) => item?.url) : undefined;
  return {
    url: swatch?.url ?? robotCoffeeReference,
    alt: swatch?.title || "Robot assistant beside an espresso machine",
    title: swatch?.title || "Robot coffee study",
  };
}

function selectPlannerProvider(env) {
  const requested = cleanText(env.PALETTE_PLANNER_PROVIDER || env.PALETTE_AI_PROVIDER || "openai", 40).toLowerCase();
  if (!requested || requested === "local") {
    return { name: "local", available: false, unavailableReason: "" };
  }

  if (requested === "openai") {
    return openAiKey(env)
      ? { name: "openai", available: true }
      : {
          name: "openai",
          available: false,
          unavailableReason: "No OPENAI_API_KEY or CODEX_API_KEY set.",
        };
  }

  return {
    name: requested,
    available: false,
    unavailableReason: `Planner provider "${requested}" is not configured.`,
  };
}

async function callPlannerProvider(request, provider, env) {
  if (provider.name === "openai") return callOpenAI(request, env);
  throw new Error(`Unsupported planner provider: ${provider.name}`);
}

async function callOpenAI(request, env) {
  const model = env.OPENAI_MODEL || "gpt-4.1-mini";
  const body = {
    model,
    input: [
      {
        role: "system",
        content: [
          {
            type: "input_text",
            text:
              "You are the Palette planner. Translate canvas steering commands into PaletteOperation JSON only. " +
              "Use the selected section, pinned notes, and reference swatches as context for the smallest safe operation. " +
              "Return safe operations from the allowlist. Do not return code, prose outside JSON, CSS, scripts, or arbitrary state. " +
              "Never return an empty operations array when the command clearly maps to an allowed operation. " +
              "Rules: darker, premium, black, luxury -> set_theme premium and set_variant premium for existing sections. " +
              "lighter, editorial, quiet, atelier -> set_theme atelier. " +
              "waitlist, form, email, signup -> add_waitlist for the selected section, or add a form section if nothing is selected. " +
              "headline/title edits -> update_section title for selectedId when present. copy/subtitle edits -> update_section subtitle for selectedId when present. " +
              "add note or note: text -> add_section with kind note after selectedId, using the note text as subtitle. " +
              "gallery, portfolio, images -> add a gallery section. " +
              "contact -> add a form section titled Contact the studio. " +
              "remove, delete -> remove_section only when selectedId is present. " +
              "Example response: {\"status\":\"Applied a darker glaze.\",\"operations\":[{\"type\":\"set_theme\",\"theme\":\"premium\"},{\"type\":\"set_variant\",\"id\":\"hero\",\"variant\":\"premium\"}]}",
          },
        ],
      },
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: JSON.stringify({
              command: request.command,
              selectedId: request.selectedId,
              selectedSection: request.selectedSection,
              notes: request.notes,
              references: request.references,
              currentSections: summarizeSections(request.project),
              allowedOperationTypes: [
                "start_project",
                "set_theme",
                "add_section",
                "remove_section",
                "move_section",
                "update_section",
                "set_variant",
                "add_waitlist",
                "add_swatch",
                "export_project",
              ],
            }),
          },
        ],
      },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "palette_planner_result",
        strict: false,
        schema: {
          type: "object",
          additionalProperties: false,
          required: ["operations", "status"],
          properties: {
            status: { type: "string" },
            operations: {
              type: "array",
              maxItems: 5,
              items: { type: "object", additionalProperties: true },
            },
          },
        },
      },
    },
  };

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${openAiKey(env)}`,
    },
    body: JSON.stringify(body),
  });

  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(json.error?.message || `OpenAI request failed with ${response.status}`);
  }

  const text = extractOutputText(json);
  if (!text) throw new Error("OpenAI response had no output text.");
  return JSON.parse(text);
}

function openAiKey(env) {
  return env.OPENAI_API_KEY || env.CODEX_API_KEY || "";
}

function validateIntentResult(result, request) {
  if (!result || typeof result !== "object" || !Array.isArray(result.operations)) {
    return { operations: [], status: "Planner did not return an operation list." };
  }

  const operations = result.operations
    .slice(0, 5)
    .map((operation) => validateOperation(operation, request))
    .filter(Boolean);

  return {
    operations,
    status: cleanText(result.status, 180) || "Translated the stroke into Palette operations.",
  };
}

function validateOperation(operation, request) {
  if (!operation || typeof operation !== "object" || typeof operation.type !== "string") return null;

  switch (operation.type) {
    case "start_project":
      return templates.has(operation.template) ? { type: "start_project", template: operation.template } : null;
    case "set_theme":
      return themes.has(operation.theme) ? { type: "set_theme", theme: operation.theme } : null;
    case "add_section": {
      const section = sanitizeSection(operation.section);
      if (!section) return null;
      const afterId = validKnownId(operation.afterId, request) ? operation.afterId : undefined;
      return afterId ? { type: "add_section", section, afterId } : { type: "add_section", section };
    }
    case "remove_section":
      return validKnownId(operation.id, request) ? { type: "remove_section", id: operation.id } : null;
    case "move_section":
      return validKnownId(operation.id, request) && (operation.direction === -1 || operation.direction === 1)
        ? { type: "move_section", id: operation.id, direction: operation.direction }
        : null;
    case "update_section": {
      const patch = sanitizePatch(operation.patch);
      return validKnownId(operation.id, request) && Object.keys(patch).length > 0
        ? { type: "update_section", id: operation.id, patch }
        : null;
    }
    case "set_variant":
      return validKnownId(operation.id, request) && sectionVariants.has(operation.variant)
        ? { type: "set_variant", id: operation.id, variant: operation.variant }
        : null;
    case "add_waitlist":
      return validKnownId(operation.id, request) ? { type: "add_waitlist", id: operation.id } : null;
    case "add_swatch": {
      const swatch = sanitizeSwatch(operation.swatch);
      return swatch ? { type: "add_swatch", swatch } : null;
    }
    case "export_project":
      return { type: "export_project" };
    default:
      return null;
  }
}

function sanitizeSection(section) {
  if (!section || typeof section !== "object") return null;
  if (!sectionKinds.has(section.kind)) return null;

  const id = cleanId(section.id) || uniqueId(section.kind);
  const title = cleanText(section.title, 90) || defaultTitle(section.kind);
  const cleaned = { id, kind: section.kind, title };
  const patch = sanitizePatch(section);
  delete patch.id;
  delete patch.kind;
  return { ...cleaned, ...patch };
}

function sanitizePatch(patch) {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) return {};

  const cleaned = {};
  for (const key of Object.keys(patch)) {
    if (!patchKeys.has(key)) continue;

    if (["title", "subtitle", "eyebrow", "footerText"].includes(key)) {
      const value = cleanText(patch[key], key === "title" ? 90 : 180);
      if (value) cleaned[key] = value;
    }

    if (key === "titleSizeBoost" && typeof patch[key] === "number" && Number.isFinite(patch[key])) {
      cleaned.titleSizeBoost = Math.max(0, Math.min(24, patch[key]));
    }
    if (key === "imageUrl") cleaned.imageUrl = cleanHref(patch[key]);
    if (key === "imageAlt") cleaned.imageAlt = cleanText(patch[key], 70);
    if (key === "variant" && sectionVariants.has(patch[key])) cleaned.variant = patch[key];
    if (key === "hasWaitlist" && typeof patch[key] === "boolean") cleaned.hasWaitlist = patch[key];
    if (key === "actions") cleaned.actions = sanitizeActions(patch[key]);
    if (key === "links") cleaned.links = sanitizeLinks(patch[key]);
    if (key === "features") cleaned.features = sanitizeFeatures(patch[key]);
    if (key === "plans") cleaned.plans = sanitizePlans(patch[key]);
    if (key === "testimonials") cleaned.testimonials = sanitizeTestimonials(patch[key]);
    if (key === "stats") cleaned.stats = sanitizeStats(patch[key]);
    if (key === "fields") cleaned.fields = sanitizeFields(patch[key]);
    if (key === "gallery") cleaned.gallery = sanitizeGallery(patch[key]);
  }

  return dropEmptyArrays(cleaned);
}

function sanitizeActions(value) {
  return arrayOf(value, 4)
    .map((item) => ({
      label: cleanText(item?.label, 40),
      href: cleanHref(item?.href),
      tone: item?.tone === "primary" || item?.tone === "secondary" ? item.tone : undefined,
    }))
    .filter((item) => item.label)
    .map(dropUndefined);
}

function sanitizeLinks(value) {
  return arrayOf(value, 6)
    .map((item) => ({ label: cleanText(item?.label, 32), href: cleanHref(item?.href) }))
    .filter((item) => item.label)
    .map(dropUndefined);
}

function sanitizeFeatures(value) {
  return arrayOf(value, 4)
    .map((item) => ({
      title: cleanText(item?.title, 50),
      copy: cleanText(item?.copy, 140),
      accent: cleanColor(item?.accent),
    }))
    .filter((item) => item.title && item.copy)
    .map(dropUndefined);
}

function sanitizePlans(value) {
  return arrayOf(value, 3)
    .map((item) => ({
      name: cleanText(item?.name, 40),
      price: cleanText(item?.price, 24),
      copy: cleanText(item?.copy, 120),
      featured: typeof item?.featured === "boolean" ? item.featured : undefined,
    }))
    .filter((item) => item.name && item.price && item.copy)
    .map(dropUndefined);
}

function sanitizeTestimonials(value) {
  return arrayOf(value, 3)
    .map((item) => ({
      quote: cleanText(item?.quote, 160),
      name: cleanText(item?.name, 48),
      role: cleanText(item?.role, 64),
    }))
    .filter((item) => item.quote && item.name)
    .map(dropUndefined);
}

function sanitizeStats(value) {
  return arrayOf(value, 4)
    .map((item) => ({ value: cleanText(item?.value, 18), label: cleanText(item?.label, 60) }))
    .filter((item) => item.value && item.label);
}

function sanitizeFields(value) {
  return arrayOf(value, 4)
    .map((item) => ({
      id: cleanId(item?.id),
      label: cleanText(item?.label, 40),
      type: fieldTypes.has(item?.type) ? item.type : undefined,
      placeholder: cleanText(item?.placeholder, 60),
    }))
    .filter((item) => item.id && item.label)
    .map(dropUndefined);
}

function sanitizeGallery(value) {
  return arrayOf(value, 4)
    .map((item) => ({
      title: cleanText(item?.title, 54),
      copy: cleanText(item?.copy, 120),
      imageUrl: cleanHref(item?.imageUrl),
      imageAlt: cleanText(item?.imageAlt, 70),
    }))
    .filter((item) => item.title)
    .map(dropUndefined);
}

function sanitizeSwatch(swatch) {
  if (!swatch || typeof swatch !== "object") return null;
  const id = cleanId(swatch.id) || uniqueId("swatch");
  const title = cleanText(swatch.title, 50);
  const note = cleanText(swatch.note, 140);
  if (!title || !note) return null;

  return dropUndefined({
    id,
    title,
    note,
    url: cleanHref(swatch.url),
    tone: ["paper", "glass", "ink"].includes(swatch.tone) ? swatch.tone : undefined,
    colors: arrayOf(swatch.colors, 5).map(cleanColor).filter(Boolean),
  });
}

function firstSectionId(project, kind) {
  return Array.isArray(project.sections) ? project.sections.find((section) => section.kind === kind)?.id : undefined;
}

function firstAnySectionId(project) {
  return Array.isArray(project.sections) ? project.sections[0]?.id : undefined;
}

function looksLikeAtelierSite(text) {
  const siteIntent =
    text.includes("build") ||
    text.includes("landing page") ||
    text.includes("website") ||
    text.includes("site") ||
    text.includes("page");
  const atelierSubject =
    text.includes("ceramic") ||
    text.includes("pottery") ||
    text.includes("atelier") ||
    text.includes("artist") ||
    text.includes("gallery") ||
    text.includes("studio notes");
  return siteIntent && atelierSubject;
}

function sectionOperationsFromText(text, project, selectedId, selected) {
  const operations = [];
  const afterId = selectedId ?? undefined;

  if (text.includes("waitlist") || text.includes("signup") || text.includes("email form")) {
    const id = selected?.kind === "hero" ? selected.id : firstSectionId(project, "hero");
    operations.push(id ? { type: "add_waitlist", id } : { type: "add_section", section: formSection(), afterId });
  }

  if (
    text.includes("testimonial") ||
    text.includes("quote") ||
    text.includes("studio note") ||
    text.includes("studio notes") ||
    text.includes("notes")
  ) {
    operations.push({ type: "add_section", section: testimonialsSection(), afterId });
  }

  if (text.includes("gallery") || text.includes("image strip") || text.includes("references")) {
    operations.push({ type: "add_section", section: gallerySection(), afterId });
  }

  if (text.includes("stats") || text.includes("numbers")) {
    operations.push({ type: "add_section", section: statsSection(), afterId });
  }

  if (text.includes("contact")) {
    operations.push({ type: "add_section", section: contactSection(), afterId });
  } else if (text.includes("form")) {
    operations.push({ type: "add_section", section: formSection(), afterId });
  }

  if (text.includes("pricing")) {
    operations.push({ type: "add_section", section: pricingSection(), afterId });
  }

  return operations;
}

function statusForSectionOperation(operation) {
  if (operation.type === "add_waitlist") return "Local parser painted a waitlist into the hero.";
  if (operation.type !== "add_section") return "Local parser painted the selected canvas change.";
  if (operation.section.kind === "testimonials") return "Local parser pinned studio notes.";
  if (operation.section.kind === "gallery") return "Local parser painted a gallery strip.";
  if (operation.section.kind === "stats") return "Local parser added a structure strip.";
  if (operation.section.kind === "note") return "Local parser pinned a note beside the selected section.";
  if (operation.section.kind === "form" && operation.section.title?.toLowerCase().includes("contact")) {
    return "Local parser painted a contact section.";
  }
  if (operation.section.kind === "form") return "Local parser painted a form section.";
  if (operation.section.kind === "pricing") return "Local parser framed pricing.";
  return "Local parser painted a new section.";
}

function validKnownId(id, { project, selectedId }) {
  if (typeof id !== "string" || id.length > 80) return false;
  if (id === selectedId) return true;
  return Array.isArray(project.sections) && project.sections.some((section) => section.id === id);
}

function summarizeSections(project) {
  const sections = Array.isArray(project.sections) ? project.sections : [];
  return sections.slice(0, 20).map((section) => ({
    id: section.id,
    kind: section.kind,
    title: section.title,
    variant: section.variant,
  }));
}

function extractOutputText(response) {
  if (typeof response.output_text === "string") return response.output_text;
  if (!Array.isArray(response.output)) return "";

  return response.output
    .flatMap((item) => (Array.isArray(item.content) ? item.content : []))
    .map((content) => content.text)
    .filter((text) => typeof text === "string")
    .join("");
}

function formSection() {
  return {
    id: uniqueId("form"),
    kind: "form",
    title: "Reserve a tasting",
    subtitle: "Leave a note and Palette keeps the flow in place.",
    actions: [{ label: "Send note" }],
    variant: "atelier",
  };
}

function contactSection() {
  return {
    ...formSection(),
    title: "Contact the studio",
    subtitle: "Send a note, collaboration idea, or request for the next study.",
  };
}

function testimonialsSection() {
  return {
    id: uniqueId("testimonials"),
    kind: "testimonials",
    title: "Studio notes",
    subtitle: "Generated notes that show how the canvas responds to steering.",
    variant: "atelier",
  };
}

function noteSection(note, target) {
  const targetLabel = target ? `${target.kind} section` : "canvas";
  return {
    id: uniqueId("note"),
    kind: "note",
    title: "Studio note",
    subtitle: note || "Keep this direction visible while Palette keeps painting.",
    eyebrow: `Pinned to ${targetLabel}`,
    variant: "atelier",
  };
}

function gallerySection() {
  return {
    id: uniqueId("gallery"),
    kind: "gallery",
    title: "Reference studies",
    subtitle: "Pinned swatches become visual direction on the canvas.",
    variant: "atelier",
  };
}

function statsSection() {
  return {
    id: uniqueId("stats"),
    kind: "stats",
    title: "A faster first draft",
    subtitle: "Small, visible operations replace waiting on one giant generation.",
    variant: "atelier",
  };
}

function pricingSection() {
  return {
    id: uniqueId("pricing"),
    kind: "pricing",
    title: "Simple cups, clear plans",
    subtitle: "No app maze. Walk in, tap once, leave with a perfect cup.",
    variant: "atelier",
  };
}

function defaultTitle(kind) {
  return `${kind.slice(0, 1).toUpperCase()}${kind.slice(1)} study`;
}

function toTitle(value) {
  const cleaned = cleanText(value.replace(/make|change|to|:/gi, " "), 90).replace(/\s+/g, " ").trim();
  return cleaned.length > 0 ? cleaned : "A freshly painted section.";
}

function cleanText(value, maxLength) {
  if (typeof value !== "string") return "";
  return value.replace(/[<>`]/g, "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function cleanId(value) {
  if (typeof value !== "string") return "";
  return value.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80);
}

function cleanHref(value) {
  if (typeof value !== "string" || value.length > 240) return undefined;
  if (value.startsWith("#") || value.startsWith("/") || /^https?:\/\//i.test(value) || /^blob:/i.test(value)) {
    return value;
  }
  return undefined;
}

function cleanColor(value) {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value) ? value : undefined;
}

function arrayOf(value, max) {
  return Array.isArray(value) ? value.slice(0, max) : [];
}

function dropUndefined(value) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined && item !== ""));
}

function dropEmptyArrays(value) {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => !Array.isArray(item) || item.length > 0),
  );
}

function uniqueId(kind) {
  return `${kind}-${Math.random().toString(16).slice(2, 8)}`;
}

function httpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}
