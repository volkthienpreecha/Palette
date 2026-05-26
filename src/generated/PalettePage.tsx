import type { CSSProperties, FormEvent } from "react";
import project from "./palette-project.json";

type PaletteProject = {
  id: string;
  name: string;
  theme: string;
  swatchAccent?: string;
  swatchColors?: string[];
  sections: PaletteSection[];
};

type PaletteSection = {
  id: string;
  kind: string;
  title: string;
  subtitle?: string;
  eyebrow?: string;
  variant?: string;
  hasWaitlist?: boolean;
  links?: PaletteLink[];
  actions?: PaletteLink[];
  features?: PaletteFeature[];
  fields?: PaletteField[];
};

type PaletteLink = {
  label: string;
  href?: string;
};

type PaletteFeature = {
  title: string;
  copy?: string;
  accent?: string;
};

type PaletteField = {
  id?: string;
  label: string;
  type?: string;
  placeholder?: string;
};

const paletteProject = project as PaletteProject;

export function PalettePage() {
  const style = {
    "--swatch-accent": paletteProject.swatchAccent,
  } as CSSProperties;

  return (
    <main
      className={`generated-page generated-${paletteProject.theme}`}
      data-palette-project={paletteProject.id}
      style={style}
    >
      {paletteProject.sections.map((section) => (
        <section
          className={`generated-section section-${section.kind} variant-${section.variant ?? paletteProject.theme}`}
          data-section-id={section.id}
          data-section-kind={section.kind}
          key={section.id}
        >
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
    case "form":
      return <FormSection section={section} />;
    default:
      return <Intro section={section} />;
  }
}

function NavSection({ section }: { section: PaletteSection }) {
  return (
    <nav className="demo-nav" aria-label={section.title}>
      <strong>{section.title}</strong>
      <div>
        {(section.links ?? []).map((link) => (
          <a href={link.href ?? "#"} key={link.label}>
            {link.label}
          </a>
        ))}
      </div>
    </nav>
  );
}

function HeroSection({ section }: { section: PaletteSection }) {
  const primary = section.actions?.[0];
  const secondary = section.actions?.[1];

  return (
    <div className="demo-hero">
      <div className="hero-copy">
        {section.eyebrow ? <span className="section-eyebrow">{section.eyebrow}</span> : null}
        <h2>{section.title}</h2>
        {section.subtitle ? <p>{section.subtitle}</p> : null}
        {section.hasWaitlist ? (
          <InlineWaitlist section={section} action={primary} />
        ) : (
          <div className="hero-actions">
            {primary ? <button type="button">{primary.label}</button> : null}
            {secondary ? <span>{secondary.label}</span> : null}
          </div>
        )}
      </div>
      <div className="coffee-study" aria-hidden="true">
        <div className="robot-arm" />
        <div className="cup">
          <span />
        </div>
        <div className="steam steam-one" />
        <div className="steam steam-two" />
      </div>
    </div>
  );
}

function InlineWaitlist({
  section,
  action,
}: {
  section: PaletteSection;
  action?: PaletteLink;
}) {
  return (
    <form className="waitlist-form" onSubmit={preventSubmit}>
      <label htmlFor={`${section.id}-waitlist-email`}>Reserve a tasting</label>
      <div>
        <input
          id={`${section.id}-waitlist-email`}
          name="email"
          type="email"
          placeholder="name@studio.com"
        />
        <button type="submit">{action?.label ?? "Set"}</button>
      </div>
    </form>
  );
}

function FeaturesSection({ section }: { section: PaletteSection }) {
  const colors = paletteProject.swatchColors ?? [];

  return (
    <div className="demo-features">
      <Intro section={section} />
      <div className="feature-list">
        {(section.features ?? []).map((feature, index) => (
          <article key={feature.title}>
            <span style={{ background: feature.accent ?? colors[index % colors.length] }} />
            <h3>{feature.title}</h3>
            {feature.copy ? <p>{feature.copy}</p> : null}
          </article>
        ))}
      </div>
    </div>
  );
}

function FormSection({ section }: { section: PaletteSection }) {
  return (
    <div className="demo-pricing demo-form">
      <Intro section={section} />
      <form className="waitlist-form section-form" onSubmit={preventSubmit}>
        {(section.fields ?? []).map((field) => {
          const id = field.id ?? field.label.toLowerCase().replace(/\s+/g, "-");
          return (
            <label htmlFor={`${section.id}-${id}`} key={id}>
              {field.label}
              <input
                id={`${section.id}-${id}`}
                name={id}
                type={field.type ?? fieldType(field.label)}
                placeholder={field.placeholder ?? field.label}
              />
            </label>
          );
        })}
        <button type="submit">{section.actions?.[0]?.label ?? "Submit"}</button>
      </form>
    </div>
  );
}

function Intro({ section }: { section: PaletteSection }) {
  return (
    <div>
      {section.eyebrow ? <span className="section-eyebrow">{section.eyebrow}</span> : null}
      <h2>{section.title}</h2>
      {section.subtitle ? <p>{section.subtitle}</p> : null}
    </div>
  );
}

function fieldType(label: string) {
  return label.toLowerCase().includes("email") ? "email" : "text";
}

function preventSubmit(event: FormEvent<HTMLFormElement>) {
  event.preventDefault();
}

export default PalettePage;
