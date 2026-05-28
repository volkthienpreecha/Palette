import type {
  PaletteSectionKind,
  PaletteSectionModel,
  PaletteSectionVariant,
} from "./sectionRenderers";

export type PaletteTheme = "atelier" | "premium";

export type PaletteSwatch = {
  id: string;
  title: string;
  note: string;
  url?: string;
  tone?: "paper" | "glass" | "ink";
  colors?: string[];
};

export type BrushLogEntry = {
  id: string;
  label: string;
  detail: string;
};

export type PaletteProject = {
  id: string;
  name: string;
  theme: PaletteTheme;
  swatchAccent?: string;
  swatchColors?: string[];
  sections: PaletteSectionModel[];
  swatches: PaletteSwatch[];
  brushLog: BrushLogEntry[];
  past: PaletteSnapshot[];
  future: PaletteSnapshot[];
  exportText?: string;
};

export type PaletteSnapshot = {
  theme: PaletteTheme;
  swatchAccent?: string;
  swatchColors?: string[];
  sections: PaletteSectionModel[];
  swatches: PaletteSwatch[];
  brushLog: BrushLogEntry[];
};

export type CommandContext = {
  selectedId: string | null;
  project: PaletteProject;
};

export type PaletteOperation =
  | { type: "start_project"; template: "robot-coffee" | "portfolio" | "studio-saas" }
  | { type: "set_theme"; theme: PaletteTheme }
  | { type: "add_section"; section: PaletteSectionModel; afterId?: string }
  | { type: "remove_section"; id: string }
  | { type: "move_section"; id: string; direction: -1 | 1 }
  | { type: "update_section"; id: string; patch: Partial<PaletteSectionModel> }
  | { type: "set_variant"; id: string; variant: PaletteSectionVariant }
  | { type: "add_waitlist"; id: string }
  | { type: "add_swatch"; swatch: PaletteSwatch }
  | { type: "export_project" };

export type IntentResult = {
  operations: PaletteOperation[];
  status: string;
  shouldPaint?: boolean;
};

export type OperationResult = {
  project: PaletteProject;
  status: string;
};

const robotCoffeeReference = "/robot-coffee-reference.png";

export const paintingStageLabels = [
  "Prime canvas",
  "Mix swatches",
  "Paint navigation",
  "Lay first wash",
  "Paint details",
  "Frame pricing",
  "Varnish",
  "Set paint",
];

export function createBlankProject(): PaletteProject {
  return {
    id: "palette-project",
    name: "Untitled canvas",
    theme: "atelier",
    sections: [],
    swatches: [],
    brushLog: [logEntry("Canvas primed", "A clean atelier canvas is ready.")],
    past: [],
    future: [],
  };
}

export function createProjectFromTemplate(
  template: "robot-coffee" | "portfolio" | "studio-saas",
): PaletteProject {
  const project = createBlankProject();
  project.name =
    template === "portfolio"
      ? "Portfolio study"
      : template === "studio-saas"
        ? "Studio software study"
        : "Rivet and Roast";
  project.sections = templateSections(template);
  project.brushLog = [
    logEntry("Canvas primed", "Palette chose a controlled section model."),
    logEntry("Swatches mixed", "Style, layout, and interaction rules are ready."),
  ];
  return project;
}

export function templateSections(template: "robot-coffee" | "portfolio" | "studio-saas") {
  if (template === "portfolio") {
    return [
      navSection(
        "Atelier Works",
        [{ label: "Work" }, { label: "Notes" }, { label: "Contact" }],
        "Contact",
      ),
      heroSection(
        "A portfolio that feels collected, not generated.",
        "Palette paints an editorial personal site with selected work, studio notes, and a quiet contact path.",
        "View work",
        "Selected work, studio notes, and a clear contact path",
      ),
      statsSection(),
      gallerySection(),
      testimonialsSection(),
      formSection("Request a studio note", "Ask for a project, collaboration, or critique."),
      footerSection("Atelier Works", "Built as a live Palette canvas."),
    ];
  }

  if (template === "studio-saas") {
    return [
      navSection(
        "Northline",
        [{ label: "Boards" }, { label: "Signals" }, { label: "Teams" }],
        "Open",
      ),
      heroSection(
        "A calmer command room for small teams.",
        "Palette paints a focused SaaS surface with live sections, compact forms, proof, and clear action paths.",
        "Start workspace",
        "Live sections, compact forms, and clear action paths",
      ),
      featuresSection("Operational rhythm", "The interface stays dense enough to work and warm enough to trust."),
      pricingSection(),
      testimonialsSection(),
      ctaSection("Shape the next release.", "Steer one section at a time and keep the canvas readable."),
      footerSection("Northline", "Painted live with Palette."),
    ];
  }

  return [
    navSection("Rivet & Roast", [
      { label: "Menu" },
      { label: "Robots" },
      { label: "Visit" },
    ]),
    heroSection(
      "Coffee pulled by robots, served with studio calm.",
      "A small autonomous cafe where every pour is measured, warm, and ready before the morning rush reaches the door.",
      "Join waitlist",
      "First tasting opens at 7:30 AM",
    ),
    featuresSection("Three strokes of service", "Fast enough for commuters, quiet enough for regulars."),
    pricingSection(),
    ctaSection(
      "Join the first morning tasting.",
      "Palette can still steer this surface while the canvas stays editable.",
    ),
    footerSection("Rivet & Roast", "Painted live with Palette."),
  ];
}

export function parseIntent(command: string, context: CommandContext): IntentResult {
  const text = command.trim().toLowerCase();
  const selectedId = context.selectedId;
  const selected = selectedId ? context.project.sections.find((section) => section.id === selectedId) : undefined;

  if (!text) {
    return { operations: [], status: "No brushstroke given." };
  }

  const preciseOperations = preciseSectionOperationsFromText(command, text, context.project, selectedId, selected);
  if (preciseOperations.length > 0) {
    return {
      operations: preciseOperations,
      status: statusForPreciseOperations(preciseOperations),
    };
  }

  if (text.includes("portfolio") || looksLikeAtelierSite(text)) {
    return {
      operations: [{ type: "start_project", template: "portfolio" }],
      status: "Palette selected an editorial portfolio model.",
      shouldPaint: true,
    };
  }

  if (text.includes("saas") || text.includes("dashboard") || text.includes("team")) {
    return {
      operations: [{ type: "start_project", template: "studio-saas" }],
      status: "Palette selected a calm software workspace model.",
      shouldPaint: true,
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
      status: "Palette selected the robot coffee shop model.",
      shouldPaint: true,
    };
  }

  if (text.includes("build") || text.includes("landing page") || text.includes("website") || text.includes("site")) {
    return {
      operations: [{ type: "start_project", template: "studio-saas" }],
      status: "Palette selected a calm software workspace model.",
      shouldPaint: true,
    };
  }

  if (text.includes("darker") || text.includes("premium") || text.includes("apple")) {
    return {
      operations: [
        { type: "set_theme", theme: "premium" },
        ...context.project.sections.map((section) => ({
          type: "set_variant" as const,
          id: section.id,
          variant: (section.variant === "playful" ? "playful" : "premium") as PaletteSectionVariant,
        })),
      ],
      status: "Mixed a darker glaze and tightened the surface.",
    };
  }

  if (text.includes("lighter") || text.includes("atelier") || text.includes("classic")) {
    return {
      operations: [{ type: "set_theme", theme: "atelier" }],
      status: "Returned the canvas to the warm atelier wash.",
    };
  }

  const sectionOperations = sectionOperationsFromText(text, context.project, selectedId, selected);
  if (sectionOperations.length > 0) {
    return {
      operations: sectionOperations,
      status:
        sectionOperations.length === 1
          ? statusForSectionOperation(sectionOperations[0])
          : "Painted the requested canvas changes in one pass.",
    };
  }

  if (text.includes("playful")) {
    const id = selectedId ?? firstSectionId(context.project, "features") ?? firstSectionId(context.project, "hero");
    return id
      ? { operations: [{ type: "set_variant", id, variant: "playful" }], status: "Changed only the selected area." }
      : { operations: [], status: "Select a section before painting that style." };
  }

  if (text.includes("minimal") || text.includes("quieter")) {
    const id = selectedId ?? firstSectionId(context.project, "hero");
    return id
      ? { operations: [{ type: "set_variant", id, variant: "minimal" }], status: "Quieted the selected section." }
      : { operations: [], status: "Select a section before quieting it." };
  }

  if (text.includes("delete") || text.includes("remove")) {
    return selectedId
      ? { operations: [{ type: "remove_section", id: selectedId }], status: "Removed the selected section." }
      : { operations: [], status: "Select a section before removing it." };
  }

  if (text.includes("move up")) {
    return selectedId
      ? { operations: [{ type: "move_section", id: selectedId, direction: -1 }], status: "Moved the section upward." }
      : { operations: [], status: "Select a section before moving it." };
  }

  if (text.includes("move down")) {
    return selectedId
      ? { operations: [{ type: "move_section", id: selectedId, direction: 1 }], status: "Moved the section downward." }
      : { operations: [], status: "Select a section before moving it." };
  }

  if (text.includes("set paint") || text.includes("export")) {
    return { operations: [{ type: "export_project" }], status: "Downloaded palette-project.json." };
  }

  const id = selectedId ?? firstSectionId(context.project, "hero") ?? firstAnySectionId(context.project);
  if (id && (text.includes("headline") || text.includes("title"))) {
    return {
      operations: [{ type: "update_section", id, patch: { title: toTitle(command.replace(/headline|title/gi, "")) } }],
      status: "Repainted the section headline.",
    };
  }

  return { operations: [], status: "Palette saved that as a note. Select a section for a precise stroke." };
}

export function applyOperation(project: PaletteProject, operation: PaletteOperation): OperationResult {
  const snapshot = takeSnapshot(project);
  const next = cloneProject(project);

  switch (operation.type) {
    case "start_project": {
      const created = createProjectFromTemplate(operation.template);
      created.swatches = project.swatches;
      created.swatchAccent = project.swatchAccent;
      created.swatchColors = project.swatchColors;
      created.sections = project.swatchColors?.length
        ? created.sections.map((section) => applySwatchToSection(section, project.swatches[0], project.swatchColors ?? []))
        : created.sections;
      return {
        project: {
          ...created,
          past: [...project.past, snapshot],
          future: [],
          brushLog: [...created.brushLog, logEntry("Project shaped", "A reusable template model is ready.")],
        },
        status: "Palette shaped a reusable project model.",
      };
    }
    case "set_theme":
      next.theme = operation.theme;
      return commit(next, snapshot, "Theme mixed", "The canvas theme changed.");
    case "add_section":
      next.sections = insertSection(
        next.sections,
        prepareSectionForProject(operation.section, next),
        operation.afterId,
      );
      return commit(next, snapshot, "Section painted", `${operation.section.kind} joined the canvas.`);
    case "remove_section":
      next.sections = next.sections.filter((section) => section.id !== operation.id);
      return commit(next, snapshot, "Section lifted", "The selected section was removed.");
    case "move_section":
      next.sections = moveSection(next.sections, operation.id, operation.direction);
      return commit(next, snapshot, "Section moved", "The selected section changed position.");
    case "update_section":
      next.sections = next.sections.map((section) =>
        section.id === operation.id ? { ...section, ...operation.patch } : section,
      );
      return commit(next, snapshot, "Section repainted", "The selected section changed.");
    case "set_variant":
      next.sections = next.sections.map((section) =>
        section.id === operation.id ? { ...section, variant: operation.variant } : section,
      );
      return commit(next, snapshot, "Variant mixed", "The selected style changed.");
    case "add_waitlist":
      next.sections = next.sections.map((section) =>
        section.id === operation.id ? { ...section, hasWaitlist: true } : section,
      );
      return commit(next, snapshot, "Waitlist painted", "A form was painted into the selected section.");
    case "add_swatch":
      next.swatches = [operation.swatch, ...next.swatches];
      mixSwatchIntoProject(next, operation.swatch);
      return commit(next, snapshot, "Swatch pinned", "A reference was mixed into the canvas.");
    case "export_project":
      next.exportText = createExportBundle(next);
      return commit(next, snapshot, "Paint set", "Downloaded palette-project.json.");
    default:
      return { project, status: "No operation was applied." };
  }
}

export function undoProject(project: PaletteProject): OperationResult {
  const previous = project.past[project.past.length - 1];
  if (!previous) return { project, status: "No earlier brushstroke to undo." };
  const current = takeSnapshot(project);
  return {
    project: {
      ...project,
      theme: previous.theme,
      swatchAccent: previous.swatchAccent,
      swatchColors: previous.swatchColors,
      sections: previous.sections,
      swatches: previous.swatches,
      brushLog: [...previous.brushLog, logEntry("Undo", "Returned to the previous brushstroke.")],
      past: project.past.slice(0, -1),
      future: [current, ...project.future],
    },
    status: "Returned to the previous brushstroke.",
  };
}

export function redoProject(project: PaletteProject): OperationResult {
  const nextSnapshot = project.future[0];
  if (!nextSnapshot) return { project, status: "No undone brushstroke to replay." };
  const current = takeSnapshot(project);
  return {
    project: {
      ...project,
      theme: nextSnapshot.theme,
      swatchAccent: nextSnapshot.swatchAccent,
      swatchColors: nextSnapshot.swatchColors,
      sections: nextSnapshot.sections,
      swatches: nextSnapshot.swatches,
      brushLog: [...nextSnapshot.brushLog, logEntry("Redo", "Replayed the next brushstroke.")],
      past: [...project.past, current],
      future: project.future.slice(1),
    },
    status: "Replayed the next brushstroke.",
  };
}

export function createExportBundle(project: PaletteProject): string {
  const projectModel = serializeProject(project);
  return JSON.stringify(
    {
      name: project.name,
      theme: project.theme,
      swatchAccent: project.swatchAccent,
      swatchColors: project.swatchColors,
      generatedAt: new Date().toISOString(),
      note: "Palette exports a structured project model plus generated React source.",
      files: [
        {
          path: "src/generated/palette-project.json",
          content: JSON.stringify(projectModel, null, 2),
        },
        {
          path: "src/generated/PalettePage.tsx",
          content: createPalettePageSource(project),
        },
        ...generatedSectionExportFiles(project),
      ],
    },
    null,
    2,
  );
}

function generatedSectionExportFiles(project: PaletteProject): Array<{ path: string; content: string }> {
  const files: Array<{ path: string; content: string }> = [];
  const manifest: Array<{ id: string; kind: string; componentName: string; files: string[] }> = [];

  for (const section of project.sections) {
    const generated = section.generated;
    if (!generated?.componentName) continue;
    const componentName = generated.componentName.replace(/[^a-zA-Z0-9]/g, "");
    if (!componentName) continue;
    const sectionFiles: string[] = [];
    if (generated.tsx) {
      const filePath = `src/generated/sections/${componentName}.tsx`;
      files.push({ path: filePath, content: generated.tsx });
      sectionFiles.push(filePath);
    }
    if (generated.css) {
      const filePath = `src/generated/sections/${componentName}.css`;
      files.push({ path: filePath, content: generated.css });
      sectionFiles.push(filePath);
    }
    if (sectionFiles.length > 0) {
      manifest.push({ id: section.id, kind: section.kind, componentName, files: sectionFiles });
    }
  }

  if (manifest.length > 0) {
    files.push({
      path: "src/generated/sections/manifest.json",
      content: JSON.stringify(manifest, null, 2),
    });
  }

  return files;
}

export function sectionStatus(section: PaletteSectionModel, index: number): string {
  if (section.kind === "nav") return "Painting the navigation as the first visible line.";
  if (section.kind === "hero") return "Laying the hero section in one clean wash.";
  if (section.kind === "features") return "Adding the reasons this surface matters.";
  if (section.kind === "pricing") return "Framing the offer before the paint sets.";
  if (section.kind === "testimonials") return "Pinning studio notes to the canvas.";
  if (section.kind === "gallery") return "Painting a gallery from the reference swatches.";
  if (section.kind === "form") return "Adding a form path for the next action.";
  if (section.kind === "note") return "Pinning a hand-written note beside the selected section.";
  if (section.kind === "cta") return "Varnishing the final call to action.";
  if (section.kind === "footer") return "Setting the final studio mark.";
  return `Painting section ${index + 1}.`;
}

function mixSwatchIntoProject(project: PaletteProject, swatch: PaletteSwatch): void {
  const colors = normalizedColors(swatch.colors);
  const accent = colors[0];
  if (!accent) return;

  project.swatchAccent = accent;
  project.swatchColors = colors;
  project.sections = project.sections.map((section) => applySwatchToSection(section, swatch, colors));
}

function prepareSectionForProject(section: PaletteSectionModel, project: PaletteProject): PaletteSectionModel {
  const themedSection =
    project.theme === "premium" && (!section.variant || section.variant === "atelier")
      ? { ...section, variant: "premium" as const }
      : section;

  return project.swatchColors?.length
    ? applySwatchToSection(themedSection, project.swatches[0], project.swatchColors)
    : themedSection;
}

function applySwatchToSection(
  section: PaletteSectionModel,
  swatch: PaletteSwatch,
  colors: string[],
): PaletteSectionModel {
  if (section.kind === "features") {
    const fallbackFeatures = [
      { title: "Clear first stroke", copy: "The opening section explains the product without making users decode it." },
      { title: "Human steering", copy: "Each area can be selected, revised, and polished without restarting." },
      { title: "Agent-ready files", copy: "The generated folder is structured so a coding agent can keep building." },
    ];
    const features = section.features ?? fallbackFeatures;
    return {
      ...section,
      features: features.map((feature, index) => ({
        ...feature,
        accent: colors[index % colors.length],
      })),
    };
  }

  if (section.kind === "gallery") {
    const fallbackGallery: NonNullable<PaletteSectionModel["gallery"]> = [
      { title: "First wash", copy: "A broad visual direction before details are set." },
      { title: "Selected surface", copy: "A single section ready for direct steering." },
      { title: "Finished pass", copy: "A polished canvas with files ready to hand off." },
    ];
    const gallery = section.gallery ?? fallbackGallery;
    return {
      ...section,
      gallery: gallery.map((item, index) =>
        index === 0
          ? {
              ...item,
              title: swatch.title || item.title,
              copy: swatch.note || item.copy,
              imageUrl: swatch.url,
              imageAlt: swatch.title || item.imageAlt || item.title,
            }
          : item,
      ),
    };
  }

  if (section.kind === "hero" || section.kind === "cta") {
    return {
      ...section,
      eyebrow: section.eyebrow ?? "Reference mixed",
    };
  }

  return section;
}

function normalizedColors(colors: string[] | undefined): string[] {
  return (colors ?? []).filter((color) => /^#[0-9a-f]{6}$/i.test(color)).slice(0, 5);
}

function serializeProject(project: PaletteProject): Omit<PaletteProject, "exportText"> {
  const { exportText: _exportText, ...model } = project;
  return clone(model);
}

function createPalettePageSource(project: PaletteProject): string {
  const sectionsSource = JSON.stringify(project.sections, null, 2);
  const themeSource = JSON.stringify(project.theme);
  const accentSource = JSON.stringify(project.swatchAccent ?? null);
  const colorsSource = JSON.stringify(project.swatchColors ?? []);

  return `import type { FormEvent } from "react";

type SectionAction = {
  label: string;
  href?: string;
};

type PaletteSection = {
  id: string;
  kind: string;
  title: string;
  subtitle?: string;
  eyebrow?: string;
  variant?: string;
  titleSizeBoost?: number;
  imageUrl?: string;
  imageAlt?: string;
  hasWaitlist?: boolean;
  links?: SectionAction[];
  actions?: SectionAction[];
  features?: { title: string; copy: string; accent?: string }[];
  plans?: { name: string; price: string; copy: string; featured?: boolean }[];
  testimonials?: { quote: string; name: string; role?: string }[];
  stats?: { value: string; label: string }[];
  fields?: { id: string; label: string; type?: string; placeholder?: string }[];
  gallery?: { title: string; copy?: string; imageUrl?: string; imageAlt?: string }[];
  footerText?: string;
};

const sections: PaletteSection[] = ${sectionsSource};
const theme = ${themeSource};
const swatchAccent: string | null = ${accentSource};
const swatchColors: string[] = ${colorsSource};

export default function PalettePage() {
  return (
    <main className={\`generated-page generated-\${theme}\`}>
      {sections.map((section) => (
        <section className={\`generated-section section-\${section.kind} variant-\${section.variant ?? "atelier"}\`} key={section.id}>
          <SectionView section={section} />
        </section>
      ))}
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
    case "note":
      return <NoteSection section={section} />;
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
    <nav className="demo-nav">
      <strong>{section.title}</strong>
      <div>{(section.links ?? []).map((link) => <a href={link.href ?? "#"} key={link.label}>{link.label}</a>)}</div>
      {section.actions?.[0] ? <a href={section.actions[0].href ?? "#"}>{section.actions[0].label}</a> : null}
    </nav>
  );
}

function HeroSection({ section }: { section: PaletteSection }) {
  const primary = section.actions?.[0];
  const secondary = section.actions?.[1]?.label;
  return (
    <div className="demo-hero" style={accentStyle()}>
      <div className="hero-copy">
        {section.eyebrow ? <span className="section-eyebrow">{section.eyebrow}</span> : null}
        <h1 style={titleBoostStyle(section)}>{section.title}</h1>
        {section.subtitle ? <p>{section.subtitle}</p> : null}
        {section.hasWaitlist ? <InlineWaitlist section={section} /> : <div className="hero-actions">{primary ? <a href={primary.href ?? "#"}>{primary.label}</a> : null}{secondary ? <span>{secondary}</span> : null}</div>}
      </div>
      <div className={\`atelier-study \${section.imageUrl ? "has-reference-image" : ""}\`} aria-hidden={!section.imageUrl}>
        {section.imageUrl ? (
          <img className="atelier-reference-image" src={section.imageUrl} alt={section.imageAlt ?? ""} />
        ) : (
          <>
            <div className="painted-canvas-study" />
            <div className="palette-dish"><span /><span /><span /></div>
            <div className="brush-stroke brush-stroke-one" />
            <div className="brush-stroke brush-stroke-two" />
          </>
        )}
      </div>
    </div>
  );
}

function InlineWaitlist({ section }: { section: PaletteSection }) {
  return (
    <form className="waitlist-form" onSubmit={preventSubmit}>
      <label htmlFor={\`\${section.id}-email\`}>Join the list</label>
      <div><input id={\`\${section.id}-email\`} name="email" type="email" placeholder="name@studio.com" /><button type="submit">Set</button></div>
    </form>
  );
}

function FeaturesSection({ section }: { section: PaletteSection }) {
  const features = section.features ?? [];
  return (
    <div className="demo-features">
      <Intro section={section} />
      <div className="feature-list">{features.map((item, index) => <article key={item.title}><span style={{ background: item.accent ?? swatchColors[index % Math.max(swatchColors.length, 1)] ?? undefined }} /><h3>{item.title}</h3><p>{item.copy}</p></article>)}</div>
    </div>
  );
}

function PricingSection({ section }: { section: PaletteSection }) {
  return (
    <div className="demo-pricing">
      <Intro section={section} />
      <div className="pricing-list">{(section.plans ?? []).map((plan) => <article className={plan.featured ? "is-featured" : undefined} key={plan.name}><h3>{plan.name}</h3><strong>{plan.price}</strong><p>{plan.copy}</p></article>)}</div>
    </div>
  );
}

function TestimonialsSection({ section }: { section: PaletteSection }) {
  return (
    <div className="demo-features demo-testimonials">
      <Intro section={section} />
      <div className="feature-list testimonial-list">{(section.testimonials ?? []).map((item) => <article key={item.name}><span /><p>{item.quote}</p><h3>{item.name}</h3>{item.role ? <p>{item.role}</p> : null}</article>)}</div>
    </div>
  );
}

function StatsSection({ section }: { section: PaletteSection }) {
  return (
    <div className="demo-features demo-stats">
      <Intro section={section} />
      <div className="feature-list stat-list">{(section.stats ?? []).map((item) => <article key={item.label}><span /><strong>{item.value}</strong><p>{item.label}</p></article>)}</div>
    </div>
  );
}

function FormSection({ section }: { section: PaletteSection }) {
  return (
    <div className="demo-pricing demo-form">
      <Intro section={section} />
      <form className="waitlist-form section-form" onSubmit={preventSubmit}>
        {(section.fields ?? []).map((field) => <label htmlFor={\`\${section.id}-\${field.id}\`} key={field.id}>{field.label}<input id={\`\${section.id}-\${field.id}\`} name={field.id} type={field.type ?? "text"} placeholder={field.placeholder} /></label>)}
        <button type="submit">{section.actions?.[0]?.label ?? "Submit"}</button>
      </form>
    </div>
  );
}

function GallerySection({ section }: { section: PaletteSection }) {
  return (
    <div className="demo-features demo-gallery">
      <Intro section={section} />
      <div className="feature-list gallery-list">{(section.gallery ?? []).map((item) => <article key={item.title}><div className="swatch-image">{item.imageUrl ? <img src={item.imageUrl} alt={item.imageAlt ?? item.title} /> : <span />}</div><h3>{item.title}</h3>{item.copy ? <p>{item.copy}</p> : null}</article>)}</div>
    </div>
  );
}

function NoteSection({ section }: { section: PaletteSection }) {
  return <div className="demo-note">{section.eyebrow ? <span className="section-eyebrow">{section.eyebrow}</span> : null}<h2>{section.title}</h2>{section.subtitle ? <p>{section.subtitle}</p> : null}</div>;
}

function CtaSection({ section }: { section: PaletteSection }) {
  const action = section.actions?.[0];
  return <div className="demo-cta" style={accentStyle()}><h2>{section.title}</h2>{section.subtitle ? <p>{section.subtitle}</p> : null}{action ? <a href={action.href ?? "#"}>{action.label}</a> : null}</div>;
}

function FooterSection({ section }: { section: PaletteSection }) {
  return <footer className="demo-footer"><strong>{section.title}</strong><span>{section.footerText ?? section.subtitle}</span></footer>;
}

function Intro({ section }: { section: PaletteSection }) {
  return <div>{section.eyebrow ? <span className="section-eyebrow">{section.eyebrow}</span> : null}<h2 style={titleBoostStyle(section)}>{section.title}</h2>{section.subtitle ? <p>{section.subtitle}</p> : null}</div>;
}

function accentStyle() {
  return swatchAccent ? { borderColor: swatchAccent } : undefined;
}

function titleBoostStyle(section: PaletteSection) {
  return section.titleSizeBoost ? { fontSize: \`calc(100% + \${section.titleSizeBoost}px)\` } : undefined;
}

function preventSubmit(event: FormEvent<HTMLFormElement>) {
  event.preventDefault();
}
`;
}

function navSection(title: string, links: { label: string }[], actionLabel = "Reserve"): PaletteSectionModel {
  return {
    id: uniqueId("nav"),
    kind: "nav",
    title,
    links,
    actions: [{ label: actionLabel }],
    variant: "atelier",
  };
}

function heroSection(
  title: string,
  subtitle: string,
  actionLabel: string,
  secondaryLabel: string,
): PaletteSectionModel {
  return {
    id: "hero",
    kind: "hero",
    title,
    subtitle,
    actions: [{ label: actionLabel }, { label: secondaryLabel }],
    variant: "atelier",
  };
}

function featuresSection(title: string, subtitle: string): PaletteSectionModel {
  return {
    id: uniqueId("features"),
    kind: "features",
    title,
    subtitle,
    variant: "atelier",
  };
}

function pricingSection(): PaletteSectionModel {
  return {
    id: uniqueId("pricing"),
    kind: "pricing",
    title: "Simple cups, clear plans",
    subtitle: "No app maze. Walk in, tap once, leave with a perfect cup.",
    variant: "atelier",
  };
}

function testimonialsSection(): PaletteSectionModel {
  return {
    id: uniqueId("testimonials"),
    kind: "testimonials",
    title: "Studio notes",
    subtitle: "Generated notes that show how the canvas responds to steering.",
    variant: "atelier",
  };
}

function statsSection(): PaletteSectionModel {
  return {
    id: uniqueId("stats"),
    kind: "stats",
    title: "A faster first draft",
    subtitle: "Small, visible operations replace waiting on one giant generation.",
    variant: "atelier",
  };
}

function gallerySection(): PaletteSectionModel {
  return {
    id: uniqueId("gallery"),
    kind: "gallery",
    title: "Reference studies",
    subtitle: "Pinned swatches become visual direction on the canvas.",
    variant: "atelier",
  };
}

function formSection(title = "Reserve a tasting", subtitle = "Leave a note and Palette keeps the flow in place."): PaletteSectionModel {
  return {
    id: uniqueId("form"),
    kind: "form",
    title,
    subtitle,
    actions: [{ label: "Send note" }],
    variant: "atelier",
  };
}

function contactSection(): PaletteSectionModel {
  return formSection("Contact the studio", "Send a note, collaboration idea, or request for the next study.");
}

function noteSection(note: string, target?: PaletteSectionModel): PaletteSectionModel {
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

function ctaSection(title: string, subtitle: string): PaletteSectionModel {
  return {
    id: uniqueId("cta"),
    kind: "cta",
    title,
    subtitle,
    actions: [{ label: "Set the paint" }],
    variant: "atelier",
  };
}

function footerSection(title: string, footerText: string): PaletteSectionModel {
  return {
    id: uniqueId("footer"),
    kind: "footer",
    title,
    footerText,
    variant: "atelier",
  };
}

function firstSectionId(project: PaletteProject, kind: PaletteSectionKind): string | undefined {
  return project.sections.find((section) => section.kind === kind)?.id;
}

function firstAnySectionId(project: PaletteProject): string | undefined {
  return project.sections[0]?.id;
}

function looksLikeAtelierSite(text: string) {
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

function preciseSectionOperationsFromText(
  command: string,
  text: string,
  project: PaletteProject,
  selectedId: string | null,
  selected?: PaletteSectionModel,
): PaletteOperation[] {
  const operations: PaletteOperation[] = [];
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

function extractNoteText(command: string): string {
  return extractRewriteText(command, [
    /\b(?:add|pin|write|leave)\s+(?:a\s+)?note(?:\s+(?:that|says|about))?\s*:?\s*(.+)$/i,
    /^note\s*:?\s*(.+)$/i,
  ]);
}

function extractRewriteText(command: string, patterns: RegExp[]): string {
  for (const pattern of patterns) {
    const match = command.match(pattern);
    if (match?.[1]) return cleanFreeform(match[1]);
  }
  return "";
}

function cleanFreeform(value: string): string {
  return value
    .replace(/^[\s"']+|[\s"']+$/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);
}

function variantFromText(text: string): PaletteSectionVariant | undefined {
  if (text.includes("playful") || text.includes("fun")) return "playful";
  if (text.includes("minimal") || text.includes("quieter") || text.includes("simple")) return "minimal";
  if (text.includes("glass") || text.includes("glassy") || text.includes("liquid")) return "glass";
  if (text.includes("editorial") || text.includes("atelier") || text.includes("classic")) return "editorial";
  if (text.includes("darker") || text.includes("premium") || text.includes("apple") || text.includes("luxury")) {
    return "glass";
  }
  return undefined;
}

function statusForPreciseOperations(operations: PaletteOperation[]) {
  if (
    operations.some(
      (operation) =>
        operation.type === "update_section" && operation.patch.eyebrow === "Morning rush pass",
    )
  ) {
    return "Emphasized the morning rush use case.";
  }

  if (
    operations.some(
      (operation) =>
        operation.type === "update_section" &&
        ("titleSizeBoost" in operation.patch || "imageUrl" in operation.patch || "gallery" in operation.patch),
    )
  ) {
    return "Repainted the selected section from the note.";
  }
  if (
    operations.some(
      (operation) => operation.type === "update_section" && "features" in operation.patch,
    )
  ) {
    return "Emphasized the morning rush use case.";
  }
  if (operations.some((operation) => operation.type === "add_section" && operation.section.kind === "note")) {
    return "Pinned a note beside the selected section.";
  }
  if (operations.some((operation) => operation.type === "update_section")) {
    if (
      operations.some(
        (operation) =>
          operation.type === "update_section" &&
          ("variant" in operation.patch || "eyebrow" in operation.patch),
      )
    ) {
      return "Repainted the selected section finish.";
    }
    return "Repainted the selected wording.";
  }
  if (operations.some((operation) => operation.type === "set_variant")) {
    return "Changed only the selected section.";
  }
  return "Painted the selected canvas change.";
}

function wantsLargerTitle(text: string): boolean {
  return (
    (text.includes("bigger") || text.includes("larger") || text.includes("increase")) &&
    (text.includes("title") || text.includes("headline") || text.includes("heading") || text.includes("text"))
  );
}

function nextTitleBoost(selected?: PaletteSectionModel): number {
  return Math.min(18, (selected?.titleSizeBoost ?? 0) + 6);
}

function wantsBetterImage(text: string): boolean {
  return (
    (text.includes("picture") || text.includes("image") || text.includes("photo") || text.includes("visual")) &&
    (text.includes("better") || text.includes("change") || text.includes("replace") || text.includes("swap"))
  );
}

function wantsShorterSharperCopy(text: string): boolean {
  return (
    (text.includes("copy") || text.includes("subtitle") || text.includes("description") || text.includes("body")) &&
    (text.includes("shorter") || text.includes("sharper") || text.includes("tighter"))
  );
}

function wantsPremiumSection(text: string): boolean {
  return text.includes("premium") && (text.includes("section") || text.includes("feel") || text.includes("this"));
}

function wantsMorningRushUseCase(text: string): boolean {
  return text.includes("morning") && (text.includes("rush") || text.includes("commuter") || text.includes("use case"));
}

function morningRushTargetSection(project: PaletteProject, selectedId: string | null) {
  const sections = project.sections;
  const selected = selectedId ? sections.find((section) => section.id === selectedId) : undefined;
  return (
    selected ??
    sections.find((section) => section.kind === "features") ??
    sections.find((section) => section.kind === "hero") ??
    sections[0]
  );
}

function morningRushPatchForSection(section: PaletteSectionModel): Partial<PaletteSectionModel> {
  if (section.kind === "features") {
    const features = section.features?.length
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

function imageTargetSection(project: PaletteProject, selectedId: string | null): PaletteSectionModel | undefined {
  const selected = selectedId ? project.sections.find((section) => section.id === selectedId) : undefined;
  if (selected?.kind === "hero" || selected?.kind === "gallery") return selected;
  return (
    project.sections.find((section) => section.kind === "hero") ??
    project.sections.find((section) => section.kind === "gallery")
  );
}

function imagePatchForSection(section: PaletteSectionModel, project: PaletteProject): Partial<PaletteSectionModel> {
  const reference = latestImageReference(project);
  if (section.kind === "gallery") {
    const gallery = section.gallery?.length
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

function latestImageReference(project: PaletteProject) {
  const swatch = project.swatches.find((item) => item.url);
  return {
    url: swatch?.url ?? robotCoffeeReference,
    alt: swatch?.title || "Robot assistant beside an espresso machine",
    title: swatch?.title || "Robot coffee study",
  };
}

function sectionOperationsFromText(
  text: string,
  project: PaletteProject,
  selectedId: string | null,
  selected?: PaletteSectionModel,
): PaletteOperation[] {
  const operations: PaletteOperation[] = [];
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

function statusForSectionOperation(operation: PaletteOperation) {
  if (operation.type === "add_waitlist") return "Painted a waitlist form into the hero.";
  if (operation.type !== "add_section") return "Painted the selected canvas change.";
  if (operation.section.kind === "testimonials") return "Pinned studio notes onto the canvas.";
  if (operation.section.kind === "gallery") return "Painted a gallery strip from the reference language.";
  if (operation.section.kind === "stats") return "Added a small structure strip to the canvas.";
  if (operation.section.kind === "form") return "Painted a form section.";
  if (operation.section.kind === "note") return "Pinned a note beside the selected section.";
  if (operation.section.kind === "pricing") return "Framed a pricing section.";
  return "Painted a new section.";
}

function insertSection(sections: PaletteSectionModel[], section: PaletteSectionModel, afterId?: string) {
  const copy = [...sections];
  const index = afterId ? copy.findIndex((item) => item.id === afterId) : -1;
  if (index === -1) return [...copy, ensureUniqueSection(section, copy)];
  copy.splice(index + 1, 0, ensureUniqueSection(section, copy));
  return copy;
}

function ensureUniqueSection(section: PaletteSectionModel, sections: PaletteSectionModel[]) {
  if (!sections.some((item) => item.id === section.id)) return section;
  return { ...section, id: uniqueId(section.kind) };
}

function moveSection(sections: PaletteSectionModel[], id: string, direction: -1 | 1) {
  const index = sections.findIndex((section) => section.id === id);
  const nextIndex = index + direction;
  if (index < 0 || nextIndex < 0 || nextIndex >= sections.length) return sections;
  const copy = [...sections];
  const [section] = copy.splice(index, 1);
  copy.splice(nextIndex, 0, section);
  return copy;
}

function commit(
  project: PaletteProject,
  snapshot: PaletteSnapshot,
  label: string,
  detail: string,
): OperationResult {
  return {
    project: {
      ...project,
      brushLog: [logEntry(label, detail), ...project.brushLog].slice(0, 8),
      past: [...project.past, snapshot],
      future: [],
    },
    status: detail,
  };
}

function takeSnapshot(project: PaletteProject): PaletteSnapshot {
  return {
    theme: project.theme,
    sections: clone(project.sections),
    swatches: clone(project.swatches),
    brushLog: clone(project.brushLog),
  };
}

function cloneProject(project: PaletteProject): PaletteProject {
  return {
    ...project,
    sections: clone(project.sections),
    swatches: clone(project.swatches),
    brushLog: clone(project.brushLog),
    past: [...project.past],
    future: [...project.future],
  };
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function logEntry(label: string, detail: string): BrushLogEntry {
  return { id: `${Date.now()}-${Math.random().toString(16).slice(2)}`, label, detail };
}

function uniqueId(kind: string): string {
  return `${kind}-${Math.random().toString(16).slice(2, 8)}`;
}

function toTitle(value: string): string {
  const cleaned = value.replace(/make|change|to|:/gi, " ").replace(/\s+/g, " ").trim();
  return cleaned.length > 0 ? cleaned : "A freshly painted section.";
}
