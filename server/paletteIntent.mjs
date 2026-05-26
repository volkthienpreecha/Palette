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
]);

const sectionVariants = new Set(["atelier", "premium", "playful", "minimal", "glass", "editorial"]);
const templates = new Set(["robot-coffee", "portfolio", "studio-saas"]);
const themes = new Set(["atelier", "premium"]);
const fieldTypes = new Set(["text", "email", "tel", "url"]);
const patchKeys = new Set([
  "title",
  "subtitle",
  "eyebrow",
  "variant",
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

export async function resolveIntent(payload, env = process.env) {
  const request = normalizeRequest(payload);
  const local = parseLocalIntent(request);

  if (!env.OPENAI_API_KEY) {
    return {
      operations: local.operations,
      status: `No OPENAI_API_KEY set. ${local.status}`,
      source: "local",
    };
  }

  try {
    const generated = await callOpenAI(request, env);
    const validated = validateIntentResult(generated, request);

    if (validated.operations.length === 0) {
      return {
        operations: local.operations,
        status: `OpenAI returned no valid Palette operations. ${local.status}`,
        source: "fallback",
      };
    }

    return {
      operations: validated.operations,
      status: validated.status || "Translated the stroke into safe Palette operations.",
      source: "openai",
    };
  } catch (error) {
    return {
      operations: local.operations,
      status: `OpenAI bridge unavailable. ${local.status}`,
      source: "fallback",
      detail: error instanceof Error ? error.message : "Unknown bridge error",
    };
  }
}

function normalizeRequest(payload) {
  if (!payload || typeof payload !== "object") {
    throw httpError(400, "Expected a JSON object.");
  }

  const command = typeof payload.command === "string" ? payload.command.trim() : "";
  const selectedId = typeof payload.selectedId === "string" ? payload.selectedId : null;
  const project = payload.project && typeof payload.project === "object" ? payload.project : {};

  return { command, selectedId, project };
}

function parseLocalIntent({ command, selectedId, project }) {
  const text = command.toLowerCase();
  const sections = Array.isArray(project.sections) ? project.sections : [];
  const selected = selectedId ? sections.find((section) => section.id === selectedId) : undefined;

  if (!text) {
    return { operations: [], status: "No brushstroke given." };
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

  const id = selectedId ?? firstSectionId(project, "hero");
  if (id && (text.includes("headline") || text.includes("title"))) {
    return {
      operations: [{ type: "update_section", id, patch: { title: toTitle(command.replace(/headline|title/gi, "")) } }],
      status: "Local parser repainted the headline.",
    };
  }

  return { operations: [], status: "Local parser saved the note. Select a section for a precise stroke." };
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
              "You translate Palette canvas steering commands into PaletteOperation JSON only. " +
              "Return safe operations from the allowlist. Do not return code, prose outside JSON, CSS, scripts, or arbitrary state.",
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
        name: "palette_intent_result",
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
      Authorization: `Bearer ${env.OPENAI_API_KEY}`,
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

function validateIntentResult(result, request) {
  if (!result || typeof result !== "object" || !Array.isArray(result.operations)) {
    return { operations: [], status: "OpenAI did not return an operation list." };
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

  if (text.includes("form") || text.includes("contact")) {
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

function testimonialsSection() {
  return {
    id: uniqueId("testimonials"),
    kind: "testimonials",
    title: "Studio notes",
    subtitle: "Generated notes that show how the canvas responds to steering.",
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
  if (value.startsWith("#") || value.startsWith("/") || /^https?:\/\//i.test(value)) return value;
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
