import type { CSSProperties, FormEvent } from "react";
import project from "./palette-project.json";

type PaletteProject = {
  id: string;
  name: string;
  theme: string;
  swatchAccent?: string;
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
  actions?: PaletteAction[];
  features?: PaletteFeature[];
  plans?: PalettePlan[];
  footerText?: string;
};

type PaletteLink = {
  label: string;
  href?: string;
};

type PaletteAction = {
  label: string;
  href?: string;
};

type PaletteFeature = {
  title: string;
  copy: string;
  accent?: string;
};

type PalettePlan = {
  name: string;
  price: string;
  copy: string;
  featured?: boolean;
};

const paletteProject = project as PaletteProject;

const fallbackFeatures: PaletteFeature[] = [
  { title: "Clear first stroke", copy: "The opening section explains the product without making users decode it." },
  { title: "Human steering", copy: "Each area can be selected, revised, and polished without restarting." },
  { title: "Agent-ready files", copy: "The generated folder is structured so a coding agent can keep building." },
];

const fallbackPlans: PalettePlan[] = [
  { name: "Sketch", price: "1 screen", copy: "A first pass with editable sections." },
  { name: "Study", price: "Full page", copy: "A complete landing page with notes and references.", featured: true },
  { name: "Ship", price: "Code handoff", copy: "Generated files ready for your coding agent." },
];

export function PalettePage() {
  const style = paletteProject.swatchAccent
    ? ({ "--swatch-accent": paletteProject.swatchAccent } as CSSProperties)
    : undefined;

  return (
    <main
      className={`generated-page generated-${paletteProject.theme}`}
      data-palette-project={paletteProject.id}
      style={style}
    >
      {paletteProject.sections.map((section) => (
        <section
          className={`generated-section section-${section.kind} variant-${
            section.variant ?? paletteProject.theme
          }`}
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
    case "note":
      return <NoteSection section={section} />;
    case "features":
      return <FeaturesSection section={section} />;
    case "pricing":
      return <PricingSection section={section} />;
    case "cta":
      return <CtaSection section={section} />;
    case "footer":
      return <FooterSection section={section} />;
    default:
      return <Intro section={section} />;
  }
}

function NavSection({ section }: { section: PaletteSection }) {
  const links = section.links ?? [];
  const action = section.actions?.[0];

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
      {action ? (
        <button type="button" onClick={() => navigateTo(action.href)}>
          {action.label}
        </button>
      ) : null}
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
          <InlineWaitlist section={section} />
        ) : (
          <div className="hero-actions">
            {primary ? (
              <button type="button" onClick={() => navigateTo(primary.href)}>
                {primary.label}
              </button>
            ) : null}
            {secondary ? <span>{secondary.label}</span> : null}
          </div>
        )}
      </div>
      <div className="atelier-study" aria-hidden="true">
        <div className="painted-canvas-study" />
        <div className="palette-dish">
          <span />
          <span />
          <span />
        </div>
        <div className="brush-stroke brush-stroke-one" />
        <div className="brush-stroke brush-stroke-two" />
      </div>
    </div>
  );
}

function InlineWaitlist({ section }: { section: PaletteSection }) {
  return (
    <form className="waitlist-form" onSubmit={preventSubmit}>
      <label htmlFor={`${section.id}-waitlist-email`}>Join the list</label>
      <div>
        <input id={`${section.id}-waitlist-email`} name="email" type="email" placeholder="name@studio.com" />
        <button type="submit">Set</button>
      </div>
    </form>
  );
}

function NoteSection({ section }: { section: PaletteSection }) {
  return (
    <div className="demo-note">
      {section.eyebrow ? <span className="section-eyebrow">{section.eyebrow}</span> : null}
      <h2>{section.title}</h2>
      {section.subtitle ? <p>{section.subtitle}</p> : null}
    </div>
  );
}

function FeaturesSection({ section }: { section: PaletteSection }) {
  const features = section.features ?? fallbackFeatures;

  return (
    <div className="demo-features">
      <Intro section={section} />
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

function PricingSection({ section }: { section: PaletteSection }) {
  const plans = section.plans ?? fallbackPlans;

  return (
    <div className="demo-pricing">
      <Intro section={section} />
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

function CtaSection({ section }: { section: PaletteSection }) {
  const action = section.actions?.[0];

  return (
    <div className="demo-cta">
      <h2>{section.title}</h2>
      {section.subtitle ? <p>{section.subtitle}</p> : null}
      {action ? (
        <button type="button" onClick={() => navigateTo(action.href)}>
          {action.label}
        </button>
      ) : null}
    </div>
  );
}

function FooterSection({ section }: { section: PaletteSection }) {
  return (
    <footer className="demo-footer">
      <strong>{section.title}</strong>
      <span>{section.footerText ?? section.subtitle}</span>
    </footer>
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

function preventSubmit(event: FormEvent<HTMLFormElement>) {
  event.preventDefault();
}

function navigateTo(href?: string) {
  if (href) window.location.href = href;
}

export default PalettePage;
