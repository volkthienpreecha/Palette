import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { ArrowDown, ArrowUp, MessageSquarePlus, Trash2 } from "lucide-react";

export type PaletteSectionKind =
  | "nav"
  | "hero"
  | "features"
  | "pricing"
  | "cta"
  | "footer"
  | "testimonials"
  | "stats"
  | "form"
  | "gallery"
  | "note";

export type PaletteSectionVariant =
  | "atelier"
  | "premium"
  | "playful"
  | "minimal"
  | "glass"
  | "editorial";

export type PaletteAction = {
  label: string;
  href?: string;
  tone?: "primary" | "secondary";
};

export type PaletteNavLink = {
  label: string;
  href?: string;
};

export type PaletteFeatureItem = {
  title: string;
  copy: string;
  accent?: string;
};

export type PalettePricingPlan = {
  name: string;
  price: string;
  copy: string;
  featured?: boolean;
};

export type PaletteTestimonial = {
  quote: string;
  name: string;
  role?: string;
};

export type PaletteStat = {
  value: string;
  label: string;
};

export type PaletteFormField = {
  id: string;
  label: string;
  type?: "text" | "email" | "tel" | "url";
  placeholder?: string;
};

export type PaletteGalleryItem = {
  title: string;
  copy?: string;
  imageUrl?: string;
  imageAlt?: string;
};

export type PaletteSectionModel = {
  id: string;
  kind: PaletteSectionKind;
  title: string;
  subtitle?: string;
  eyebrow?: string;
  variant?: PaletteSectionVariant;
  titleSizeBoost?: number;
  imageUrl?: string;
  imageAlt?: string;
  hasWaitlist?: boolean;
  links?: PaletteNavLink[];
  actions?: PaletteAction[];
  features?: PaletteFeatureItem[];
  plans?: PalettePricingPlan[];
  testimonials?: PaletteTestimonial[];
  stats?: PaletteStat[];
  fields?: PaletteFormField[];
  gallery?: PaletteGalleryItem[];
  footerText?: string;
};

export type PaletteSectionHelpers = {
  selected?: boolean;
  onSelect?: (id: string) => void;
  onMove?: (id: string, direction: -1 | 1) => void;
  onRemove?: (id: string) => void;
  onNote?: (section: PaletteSectionModel) => void;
  onAction?: (section: PaletteSectionModel, action: PaletteAction) => void;
  onSubmitForm?: (section: PaletteSectionModel, values: Record<string, FormDataEntryValue>) => void;
};

export function renderPaletteSection(section: PaletteSectionModel, helpers: PaletteSectionHelpers = {}) {
  return <PaletteSectionView key={section.id} section={section} helpers={helpers} />;
}

export function PaletteSectionView({
  section,
  helpers = {},
}: {
  section: PaletteSectionModel;
  helpers?: PaletteSectionHelpers;
}) {
  const selected = Boolean(helpers.selected);

  return (
    <section
      className={`generated-section section-${section.kind} variant-${section.variant ?? "atelier"} ${
        selected ? "is-selected" : ""
      }`}
      style={section.titleSizeBoost ? ({ "--section-title-boost": `${section.titleSizeBoost}px` } as CSSProperties) : undefined}
      onClick={(event) => {
        event.stopPropagation();
        helpers.onSelect?.(section.id);
      }}
      data-section-id={section.id}
      data-section-kind={section.kind}
    >
      {selected ? <PaletteBrushToolbar section={section} helpers={helpers} /> : null}
      <PaletteSectionBody section={section} helpers={helpers} />
    </section>
  );
}

export function PaletteBrushToolbar({
  section,
  helpers,
}: {
  section: PaletteSectionModel;
  helpers: PaletteSectionHelpers;
}) {
  return (
    <div className="brush-toolbar" onClick={(event) => event.stopPropagation()}>
      <button
        type="button"
        title="Move up"
        aria-label={`Move ${section.kind} section up`}
        onClick={() => helpers.onMove?.(section.id, -1)}
      >
        <ArrowUp size={14} />
      </button>
      <button
        type="button"
        title="Move down"
        aria-label={`Move ${section.kind} section down`}
        onClick={() => helpers.onMove?.(section.id, 1)}
      >
        <ArrowDown size={14} />
      </button>
      <button
        type="button"
        title="Note"
        aria-label={`Add note to ${section.kind} section`}
        onClick={() => helpers.onNote?.(section)}
      >
        <MessageSquarePlus size={14} />
      </button>
      <button
        type="button"
        title="Remove"
        aria-label={`Remove ${section.kind} section`}
        onClick={() => helpers.onRemove?.(section.id)}
      >
        <Trash2 size={14} />
      </button>
    </div>
  );
}

export function PaletteSectionBody({
  section,
  helpers,
}: {
  section: PaletteSectionModel;
  helpers: PaletteSectionHelpers;
}) {
  switch (section.kind) {
    case "nav":
      return <PaletteNavSection section={section} helpers={helpers} />;
    case "hero":
      return <PaletteHeroSection section={section} helpers={helpers} />;
    case "features":
      return <PaletteFeaturesSection section={section} />;
    case "pricing":
      return <PalettePricingSection section={section} />;
    case "cta":
      return <PaletteCtaSection section={section} helpers={helpers} />;
    case "footer":
      return <PaletteFooterSection section={section} />;
    case "testimonials":
      return <PaletteTestimonialsSection section={section} />;
    case "stats":
      return <PaletteStatsSection section={section} />;
    case "form":
      return <PaletteFormSection section={section} helpers={helpers} />;
    case "gallery":
      return <PaletteGallerySection section={section} />;
    case "note":
      return <PaletteNoteSection section={section} />;
    default:
      return <PaletteUnknownSection section={section} />;
  }
}

export function PaletteNavSection({
  section,
  helpers,
}: {
  section: PaletteSectionModel;
  helpers: PaletteSectionHelpers;
}) {
  const links = section.links ?? [
    { label: "Menu" },
    { label: "Robots" },
    { label: "Visit" },
  ];
  const action = section.actions?.[0] ?? { label: "Reserve" };

  return (
    <nav className="demo-nav">
      <strong>{section.title}</strong>
      <div>
        {links.map((link) => (
          <a href={link.href ?? "#"} key={link.label}>
            {link.label}
          </a>
        ))}
      </div>
      <button type="button" onClick={() => helpers.onAction?.(section, action)}>
        {action.label}
      </button>
    </nav>
  );
}

export function PaletteHeroSection({
  section,
  helpers,
}: {
  section: PaletteSectionModel;
  helpers: PaletteSectionHelpers;
}) {
  const primary = section.actions?.[0] ?? { label: "Join waitlist" };
  const secondary = section.actions?.[1]?.label ?? "First tasting opens at 7:30 AM";
  const hasReferenceImage = Boolean(section.imageUrl);

  return (
    <div className="demo-hero">
      <div className="hero-copy">
        {section.eyebrow ? <span className="section-eyebrow">{section.eyebrow}</span> : null}
        <h2>{section.title}</h2>
        {section.subtitle ? <p>{section.subtitle}</p> : null}
        {!section.hasWaitlist ? (
          <div className="hero-actions">
            <button type="button" onClick={() => helpers.onAction?.(section, primary)}>
              {primary.label}
            </button>
            <span>{secondary}</span>
          </div>
        ) : null}
        {section.hasWaitlist ? <PaletteInlineWaitlist section={section} helpers={helpers} /> : null}
      </div>
      <div className={`coffee-study ${hasReferenceImage ? "has-reference-image" : ""}`} aria-hidden={!hasReferenceImage}>
        {section.imageUrl ? (
          <img className="coffee-reference-image" src={section.imageUrl} alt={section.imageAlt ?? ""} />
        ) : (
          <>
            <div className="robot-arm" />
            <div className="cup">
              <span />
            </div>
            <div className="steam steam-one" />
            <div className="steam steam-two" />
          </>
        )}
      </div>
    </div>
  );
}

export function PaletteInlineWaitlist({
  section,
  helpers,
}: {
  section: PaletteSectionModel;
  helpers: PaletteSectionHelpers;
}) {
  return (
    <form
      className="waitlist-form"
      onSubmit={(event) => {
        event.preventDefault();
        helpers.onSubmitForm?.(section, formValues(event.currentTarget));
      }}
    >
      <label htmlFor={`${section.id}-waitlist-email`}>Reserve a tasting</label>
      <div>
        <input id={`${section.id}-waitlist-email`} name="email" type="email" placeholder="name@studio.com" />
        <button type="submit">Set</button>
      </div>
    </form>
  );
}

export function PaletteFeaturesSection({ section }: { section: PaletteSectionModel }) {
  const features = section.features ?? [
    { title: "Measured pour", copy: "Robotic arms tune grind, heat, and timing for each order." },
    { title: "Human calm", copy: "The room stays quiet, tactile, and easy to understand." },
    { title: "Morning memory", copy: "Regular orders reappear before the line reaches the counter." },
  ];

  return (
    <div className="demo-features">
      <PaletteSectionIntro section={section} />
      <div className="feature-list">
        {features.map((item) => (
          <article key={item.title}>
            <span style={item.accent ? { background: item.accent } : undefined} />
            <h3>{item.title}</h3>
            <p>{item.copy}</p>
          </article>
        ))}
      </div>
    </div>
  );
}

export function PalettePricingSection({ section }: { section: PaletteSectionModel }) {
  const plans = section.plans ?? [
    { name: "Morning", price: "$6", copy: "Single cup, timed pickup." },
    { name: "Studio", price: "$18", copy: "Three cups across a work block.", featured: true },
    { name: "Foundry", price: "$42", copy: "Team tasting tray and notes." },
  ];

  return (
    <div className="demo-pricing">
      <PaletteSectionIntro section={section} />
      <div className="pricing-list">
        {plans.map((plan) => (
          <article className={plan.featured ? "is-featured" : undefined} key={plan.name}>
            <h3>{plan.name}</h3>
            <strong>{plan.price}</strong>
            <p>{plan.copy}</p>
          </article>
        ))}
      </div>
    </div>
  );
}

export function PaletteCtaSection({
  section,
  helpers,
}: {
  section: PaletteSectionModel;
  helpers: PaletteSectionHelpers;
}) {
  const action = section.actions?.[0] ?? { label: "Set the paint" };

  return (
    <div className="demo-cta">
      <h2>{section.title}</h2>
      {section.subtitle ? <p>{section.subtitle}</p> : null}
      <button type="button" onClick={() => helpers.onAction?.(section, action)}>
        {action.label}
      </button>
    </div>
  );
}

export function PaletteFooterSection({ section }: { section: PaletteSectionModel }) {
  return (
    <footer className="demo-footer">
      <strong>{section.title}</strong>
      <span>{section.footerText ?? section.subtitle}</span>
    </footer>
  );
}

export function PaletteTestimonialsSection({ section }: { section: PaletteSectionModel }) {
  const testimonials = section.testimonials ?? [
    {
      quote: "Palette made the build feel like steering wet paint instead of waiting on a black box.",
      name: "Studio note",
      role: "Generated from the canvas state",
    },
    {
      quote: "A selected section can change without repainting the whole page.",
      name: "Interaction note",
      role: "Generated from the operation model",
    },
  ];

  return (
    <div className="demo-features demo-testimonials">
      <PaletteSectionIntro section={section} />
      <div className="feature-list testimonial-list">
        {testimonials.map((item) => (
          <article key={`${item.name}-${item.quote}`}>
            <span />
            <p>{item.quote}</p>
            <h3>{item.name}</h3>
            {item.role ? <p>{item.role}</p> : null}
          </article>
        ))}
      </div>
    </div>
  );
}

function CountUp({ value }: { value: string }) {
  const match = value.match(/(\d+)/);
  const num = match ? parseInt(match[1], 10) : NaN;
  const prefix = match ? value.slice(0, match.index) : "";
  const suffix = match ? value.slice((match.index ?? 0) + match[1].length) : "";
  const [displayed, setDisplayed] = useState(0);

  useEffect(() => {
    if (isNaN(num) || num === 0) return;
    const duration = Math.min(1100, 380 + num * 72);
    let rafId: number;
    const delayId = window.setTimeout(() => {
      const startTime = performance.now();
      const step = (now: number) => {
        const progress = Math.min((now - startTime) / duration, 1);
        const eased = 1 - Math.pow(1 - progress, 3);
        setDisplayed(Math.round(eased * num));
        if (progress < 1) rafId = requestAnimationFrame(step);
      };
      rafId = requestAnimationFrame(step);
    }, 300);
    return () => {
      window.clearTimeout(delayId);
      cancelAnimationFrame(rafId);
    };
  }, [num]);

  if (isNaN(num)) return <>{value}</>;
  return <>{prefix}{displayed}{suffix}</>;
}

export function PaletteStatsSection({ section }: { section: PaletteSectionModel }) {
  const stats = section.stats ?? [
    { value: "1", label: "canvas model" },
    { value: "5", label: "painted sections" },
    { value: "3", label: "steering moves" },
  ];

  return (
    <div className="demo-features demo-stats">
      <PaletteSectionIntro section={section} />
      <div className="feature-list stat-list">
        {stats.map((item) => (
          <article key={`${item.value}-${item.label}`}>
            <span />
            <strong><CountUp value={item.value} /></strong>
            <p>{item.label}</p>
          </article>
        ))}
      </div>
    </div>
  );
}

export function PaletteFormSection({
  section,
  helpers,
}: {
  section: PaletteSectionModel;
  helpers: PaletteSectionHelpers;
}) {
  const fields = section.fields ?? [
    { id: "name", label: "Name", type: "text", placeholder: "Your name" },
    { id: "email", label: "Email", type: "email", placeholder: "name@studio.com" },
  ];

  return (
    <div className="demo-pricing demo-form">
      <PaletteSectionIntro section={section} />
      <form
        className="waitlist-form section-form"
        onSubmit={(event) => {
          event.preventDefault();
          helpers.onSubmitForm?.(section, formValues(event.currentTarget));
        }}
      >
        {fields.map((field) => (
          <label key={field.id} htmlFor={`${section.id}-${field.id}`}>
            {field.label}
            <input
              id={`${section.id}-${field.id}`}
              name={field.id}
              type={field.type ?? "text"}
              placeholder={field.placeholder}
            />
          </label>
        ))}
        <button type="submit">{section.actions?.[0]?.label ?? "Submit"}</button>
      </form>
    </div>
  );
}

export function PaletteGallerySection({ section }: { section: PaletteSectionModel }) {
  const gallery = section.gallery ?? [
    { title: "Morning bar", copy: "A calm counter with precise service." },
    { title: "Robot pour", copy: "Mechanical movement made visible and warm." },
    { title: "Studio table", copy: "A place for tasting notes and quiet work." },
  ];

  return (
    <div className="demo-features demo-gallery">
      <PaletteSectionIntro section={section} />
      <div className="feature-list gallery-list">
        {gallery.map((item) => (
          <article key={item.title}>
            <div className="swatch-image">
              {item.imageUrl ? <img src={item.imageUrl} alt={item.imageAlt ?? item.title} /> : <span />}
            </div>
            <h3>{item.title}</h3>
            {item.copy ? <p>{item.copy}</p> : null}
          </article>
        ))}
      </div>
    </div>
  );
}

export function PaletteNoteSection({ section }: { section: PaletteSectionModel }) {
  return (
    <div className="demo-note">
      <span className="section-eyebrow">{section.eyebrow ?? "Canvas note"}</span>
      <h2>{section.title}</h2>
      {section.subtitle ? <p>{section.subtitle}</p> : null}
    </div>
  );
}

export function PaletteSectionIntro({ section }: { section: PaletteSectionModel }) {
  return (
    <div>
      {section.eyebrow ? <span className="section-eyebrow">{section.eyebrow}</span> : null}
      <h2>{section.title}</h2>
      {section.subtitle ? <p>{section.subtitle}</p> : null}
    </div>
  );
}

export function PaletteUnknownSection({ section }: { section: PaletteSectionModel }) {
  return (
    <div className="demo-cta">
      <h2>{section.title}</h2>
      <p>{section.subtitle ?? "This section is ready for a renderer."}</p>
    </div>
  );
}

function formValues(form: HTMLFormElement): Record<string, FormDataEntryValue> {
  const data = new FormData(form);
  return Object.fromEntries(data.entries());
}

export function renderPaletteSections(
  sections: PaletteSectionModel[],
  helpersForSection: (section: PaletteSectionModel) => PaletteSectionHelpers = () => ({}),
): ReactNode {
  return sections.map((section) => renderPaletteSection(section, helpersForSection(section)));
}
