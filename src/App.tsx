import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  ArrowDown,
  ArrowUp,
  Brush,
  ImagePlus,
  Mic,
  Pause,
  Play,
  Scissors,
  Send,
  Trash2,
} from "lucide-react";

type Phase = "idle" | "interview" | "painting" | "paused" | "done";
type Theme = "atelier" | "premium";
type SectionKind = "nav" | "hero" | "features" | "pricing" | "cta" | "footer";

type CanvasSection = {
  id: string;
  kind: SectionKind;
  title: string;
  subtitle?: string;
  variant?: "atelier" | "premium" | "playful";
  hasWaitlist?: boolean;
};

type Swatch = {
  id: string;
  title: string;
  note: string;
  url?: string;
  tone?: "paper" | "glass" | "ink";
};

type PaintStep = {
  label: string;
  status: string;
  section?: CanvasSection;
};

const initialStroke = "Build a landing page for a robot coffee shop.";

const paintSteps: PaintStep[] = [
  {
    label: "Prime canvas",
    status: "Priming the canvas with a warm studio surface.",
  },
  {
    label: "Mix swatches",
    status: "Mixing glass, graphite, and a small cobalt accent.",
  },
  {
    label: "Paint navigation",
    status: "Painting the navigation as the first visible line.",
    section: {
      id: "nav",
      kind: "nav",
      title: "Rivet & Roast",
      subtitle: "Queue, menu, studio",
      variant: "atelier",
    },
  },
  {
    label: "Lay first wash",
    status: "Laying the hero section in one clean wash.",
    section: {
      id: "hero",
      kind: "hero",
      title: "Coffee pulled by robots, served with studio calm.",
      subtitle:
        "A small autonomous cafe where every pour is measured, warm, and ready before the morning rush reaches the door.",
      variant: "atelier",
    },
  },
  {
    label: "Paint details",
    status: "Adding the reasons this place feels worth visiting.",
    section: {
      id: "features",
      kind: "features",
      title: "Three strokes of service",
      subtitle: "Fast enough for commuters, quiet enough for regulars.",
      variant: "atelier",
    },
  },
  {
    label: "Frame pricing",
    status: "Framing the pricing table before the paint sets.",
    section: {
      id: "pricing",
      kind: "pricing",
      title: "Simple cups, clear plans",
      subtitle: "No app maze. Walk in, tap once, leave with a perfect cup.",
      variant: "atelier",
    },
  },
  {
    label: "Varnish",
    status: "Varnishing the final call to action and footer.",
    section: {
      id: "cta",
      kind: "cta",
      title: "Join the first morning tasting.",
      subtitle:
        "Palette can still steer this surface while Codex keeps the canvas alive.",
      variant: "atelier",
    },
  },
  {
    label: "Set paint",
    status: "Setting the canvas so every section can still be steered.",
    section: {
      id: "footer",
      kind: "footer",
      title: "Rivet & Roast",
      subtitle: "Painted live with Palette.",
      variant: "atelier",
    },
  },
];

const defaultSwatches: Swatch[] = [
  {
    id: "glass",
    title: "Liquid glass",
    note: "Approved button material for active controls.",
    tone: "glass",
  },
  {
    id: "paper",
    title: "Atelier paper",
    note: "Warm canvas, graphite ink, sparse pigment.",
    tone: "paper",
  },
];

const phaseCopy: Record<Phase, string> = {
  idle: "Canvas is clean. Press Ctrl K and speak the first brushstroke.",
  interview: "One studio question before the first wash.",
  painting: "Codex is painting in layers. Press Esc to interrupt.",
  paused: "Brush lifted. Steer the surface before it sets.",
  done: "Canvas set. Select any section to keep steering.",
};

function App() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [theme, setTheme] = useState<Theme>("atelier");
  const [sections, setSections] = useState<CanvasSection[]>([]);
  const [activeStep, setActiveStep] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [capsuleOpen, setCapsuleOpen] = useState(false);
  const [draft, setDraft] = useState(initialStroke);
  const [listening, setListening] = useState(false);
  const [status, setStatus] = useState(phaseCopy.idle);
  const [swatches, setSwatches] = useState<Swatch[]>(defaultSwatches);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const selectedSection = sections.find((section) => section.id === selectedId);

  const openCommandCapsule = useCallback(() => {
    setCapsuleOpen(true);
  }, []);

  const beginPainting = useCallback(() => {
    setSections([]);
    setSelectedId(null);
    setTheme("atelier");
    setActiveStep(0);
    setPhase("painting");
    setStatus("The first wash is starting.");
  }, []);

  const applyDirection = useCallback(
    (raw: string) => {
      const command = raw.trim().toLowerCase();
      if (!command) return;

      if (command.includes("robot coffee") || command.includes("landing page")) {
        setCapsuleOpen(false);
        setPhase("interview");
        setStatus("Palette needs one studio direction before painting.");
        return;
      }

      if (
        command.includes("darker") ||
        command.includes("premium") ||
        command.includes("apple")
      ) {
        setTheme("premium");
        setSections((current) =>
          current.map((section) => ({
            ...section,
            variant: section.variant === "playful" ? "playful" : "premium",
          })),
        );
        setPhase((current) => (current === "paused" ? "painting" : current));
        setStatus("Mixed a darker glaze and tightened the whole surface.");
        setCapsuleOpen(false);
        return;
      }

      if (command.includes("waitlist") || command.includes("form")) {
        setSections((current) =>
          current.map((section) =>
            section.id === (selectedId ?? "hero") || section.kind === "hero"
              ? { ...section, hasWaitlist: true, variant: theme === "premium" ? "premium" : section.variant }
              : section,
          ),
        );
        setSelectedId("hero");
        setStatus("Painted a waitlist form directly into the selected hero.");
        setCapsuleOpen(false);
        return;
      }

      if (command.includes("playful")) {
        const targetId = selectedId ?? "features";
        setSections((current) =>
          current.map((section) =>
            section.id === targetId ? { ...section, variant: "playful" } : section,
          ),
        );
        setStatus("Changed only the selected section, not the whole page.");
        setCapsuleOpen(false);
        return;
      }

      if (command.includes("delete") || command.includes("remove")) {
        if (selectedId) {
          setSections((current) => current.filter((section) => section.id !== selectedId));
          setStatus("Removed the selected section from the canvas.");
          setSelectedId(null);
        }
        setCapsuleOpen(false);
        return;
      }

      setStatus("Palette saved that as the next brush note for the selected area.");
      setCapsuleOpen(false);
    },
    [selectedId, theme],
  );

  const interruptPainting = useCallback(() => {
    if (phase !== "painting") return;
    setPhase("paused");
    setCapsuleOpen(true);
    setDraft("Make it darker and more premium.");
    setStatus("Brush lifted mid-stroke. Tell Palette what to change.");
  }, [phase]);

  const removeSelected = useCallback(() => {
    if (!selectedId) return;
    setSections((current) => current.filter((section) => section.id !== selectedId));
    setSelectedId(null);
    setStatus("Removed the selected section.");
  }, [selectedId]);

  const moveSelected = useCallback(
    (direction: -1 | 1) => {
      if (!selectedId) return;
      setSections((current) => {
        const index = current.findIndex((section) => section.id === selectedId);
        const nextIndex = index + direction;
        if (index < 0 || nextIndex < 0 || nextIndex >= current.length) return current;
        const copy = [...current];
        const [section] = copy.splice(index, 1);
        copy.splice(nextIndex, 0, section);
        return copy;
      });
      setStatus("Moved the selected section on the canvas.");
    },
    [selectedId],
  );

  const addFiles = useCallback((files: FileList | File[]) => {
    const imageFiles = Array.from(files).filter((file) => file.type.startsWith("image/"));
    if (imageFiles.length === 0) return;
    setSwatches((current) => [
      ...imageFiles.map((file, index) => ({
        id: `${file.name}-${Date.now()}-${index}`,
        title: file.name.replace(/\.[^.]+$/, "") || "Reference",
        note: "Pinned visual reference.",
        url: URL.createObjectURL(file),
      })),
      ...current,
    ]);
    setStatus("Pinned the image as a reference swatch.");
  }, []);

  useEffect(() => {
    if (phase !== "painting") return;

    if (activeStep >= paintSteps.length) {
      setPhase("done");
      setStatus("Canvas set. Keep selecting sections to steer.");
      return;
    }

    const timeout = window.setTimeout(() => {
      const step = paintSteps[activeStep];
      setStatus(step.status);
      if (step.section) {
        const stepSection = step.section;
        setSections((current) => {
          if (current.some((section) => section.id === stepSection.id)) return current;
          const section: CanvasSection = {
            ...stepSection,
            variant: theme === "premium" ? "premium" : stepSection.variant,
          };
          return [...current, section];
        });
      }
      setActiveStep((current) => current + 1);
    }, activeStep < 2 ? 520 : 980);

    return () => window.clearTimeout(timeout);
  }, [activeStep, phase, theme]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      if ((event.metaKey || event.ctrlKey) && key === "k") {
        event.preventDefault();
        openCommandCapsule();
        return;
      }
      if (event.key === "Escape") {
        if (phase === "painting") {
          event.preventDefault();
          interruptPainting();
        } else if (capsuleOpen) {
          setCapsuleOpen(false);
        }
        return;
      }
      if (event.key === "Delete") {
        const target = event.target;
        const isTextTarget =
          target instanceof HTMLInputElement ||
          target instanceof HTMLTextAreaElement ||
          (target instanceof HTMLElement && target.isContentEditable);
        if (selectedId && !capsuleOpen) {
          if (isTextTarget) return;
          event.preventDefault();
          removeSelected();
        }
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [capsuleOpen, interruptPainting, openCommandCapsule, phase, removeSelected, selectedId]);

  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      if (!event.clipboardData) return;
      const files = Array.from(event.clipboardData.files);
      if (files.length > 0) addFiles(files);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [addFiles]);

  return (
    <main className={`app-shell theme-${theme}`}>
      <div className="atelier-wash" aria-hidden="true" />
      <header className="studio-header">
        <div>
          <p className="studio-mark">Palette</p>
          <h1>Paint software with Codex.</h1>
        </div>
        <div className="header-actions">
          <button className="glass-button muted" type="button" onClick={openCommandCapsule}>
            <Mic size={16} />
            <span>Steer</span>
          </button>
          <button className="glass-button" type="button" onClick={openCommandCapsule}>
            <Play size={16} />
            <span>Start with voice</span>
          </button>
        </div>
      </header>

      <section className="studio-grid">
        <ReferenceSwatches
          swatches={swatches}
          onFiles={addFiles}
          onPickFiles={() => fileInputRef.current?.click()}
        />

        <section className="canvas-zone" aria-label="Palette canvas">
          <CorgiGuide phase={phase} status={status} />
          <StatusRail activeStep={activeStep} phase={phase} />

          <div
            className={`canvas-board ${phase === "painting" ? "is-painting" : ""}`}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              addFiles(event.dataTransfer.files);
            }}
          >
            <AnimatePresence mode="popLayout">
              {phase === "idle" && sections.length === 0 ? (
                <motion.div
                  className="blank-canvas"
                  key="blank"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                >
                  <div className="blank-ring">
                    <Brush size={30} />
                  </div>
                  <h2>A clean canvas.</h2>
                  <p>
                    Press Ctrl K, speak the first brushstroke, then interrupt while Codex paints.
                  </p>
                  <button className="primary-stroke" type="button" onClick={openCommandCapsule}>
                    Begin with a brushstroke
                  </button>
                </motion.div>
              ) : null}

              {phase === "interview" ? (
                <motion.div
                  className="interview-card"
                  key="interview"
                  initial={{ opacity: 0, scale: 0.96 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.96 }}
                >
                  <span>Prime the canvas</span>
                  <h2>Should this feel playful, premium, or cozy?</h2>
                  <div className="interview-options">
                    <button type="button" onClick={beginPainting}>
                      Premium, but still charming
                    </button>
                    <button type="button" onClick={beginPainting}>
                      Quiet and editorial
                    </button>
                  </div>
                </motion.div>
              ) : null}
            </AnimatePresence>

            {sections.length > 0 ? (
              <GeneratedPage
                sections={sections}
                theme={theme}
                selectedId={selectedId}
                onSelect={setSelectedId}
                onMove={moveSelected}
                onRemove={removeSelected}
              />
            ) : null}
          </div>
        </section>
      </section>

      <CommandCapsule
        phase={phase}
        open={capsuleOpen}
        draft={draft}
        listening={listening}
        selectedSection={selectedSection}
        onOpen={openCommandCapsule}
        onDraft={setDraft}
        onClose={() => setCapsuleOpen(false)}
        onSubmit={() => applyDirection(draft)}
        onInterrupt={interruptPainting}
        onListen={() => {
          setListening(true);
          const next =
            phase === "paused"
              ? "Make it darker and more premium."
              : selectedId
                ? "Add a waitlist form here."
                : initialStroke;
          window.setTimeout(() => {
            setDraft(next);
            setListening(false);
          }, 720);
        }}
      />

      <input
        ref={fileInputRef}
        className="hidden-input"
        type="file"
        accept="image/*"
        multiple
        onChange={(event) => {
          if (event.target.files) addFiles(event.target.files);
          event.currentTarget.value = "";
        }}
      />
    </main>
  );
}

function ReferenceSwatches({
  swatches,
  onFiles,
  onPickFiles,
}: {
  swatches: Swatch[];
  onFiles: (files: FileList | File[]) => void;
  onPickFiles: () => void;
}) {
  return (
    <aside className="swatch-panel">
      <div className="panel-heading">
        <span>Swatches</span>
        <button type="button" title="Add image swatch" onClick={onPickFiles}>
          <ImagePlus size={16} />
        </button>
      </div>
      <div
        className="drop-target"
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          onFiles(event.dataTransfer.files);
        }}
      >
        Drop or paste references
      </div>
      <div className="swatch-list">
        {swatches.map((swatch) => (
          <article className={`swatch-card tone-${swatch.tone ?? "paper"}`} key={swatch.id}>
            <div className="swatch-image">
              {swatch.url ? <img src={swatch.url} alt="" /> : <span />}
            </div>
            <h3>{swatch.title}</h3>
            <p>{swatch.note}</p>
          </article>
        ))}
      </div>
    </aside>
  );
}

function CorgiGuide({ phase, status }: { phase: Phase; status: string }) {
  return (
    <aside className={`corgi-guide corgi-${phase}`} aria-live="polite">
      <div className="corgi-sprite" aria-hidden="true" />
      <div>
        <span>Studio guide</span>
        <p>{status}</p>
      </div>
    </aside>
  );
}

function StatusRail({ activeStep, phase }: { activeStep: number; phase: Phase }) {
  return (
    <ol className="status-rail" aria-label="Painting progress">
      {paintSteps.map((step, index) => {
        const state = phase === "done" || index < activeStep ? "done" : index === activeStep ? "active" : "";
        return (
          <li className={state} key={step.label}>
            <span />
            {step.label}
          </li>
        );
      })}
    </ol>
  );
}

function GeneratedPage({
  sections,
  theme,
  selectedId,
  onSelect,
  onMove,
  onRemove,
}: {
  sections: CanvasSection[];
  theme: Theme;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onMove: (direction: -1 | 1) => void;
  onRemove: () => void;
}) {
  return (
    <motion.div
      className={`generated-page generated-${theme}`}
      layout
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
    >
      <AnimatePresence initial={false}>
        {sections.map((section) => (
          <SelectableSection
            key={section.id}
            section={section}
            selected={selectedId === section.id}
            onSelect={() => onSelect(section.id)}
            onMove={onMove}
            onRemove={onRemove}
          />
        ))}
      </AnimatePresence>
    </motion.div>
  );
}

function SelectableSection({
  section,
  selected,
  onSelect,
  onMove,
  onRemove,
}: {
  section: CanvasSection;
  selected: boolean;
  onSelect: () => void;
  onMove: (direction: -1 | 1) => void;
  onRemove: () => void;
}) {
  return (
    <motion.section
      layout
      className={`generated-section section-${section.kind} variant-${section.variant ?? "atelier"} ${
        selected ? "is-selected" : ""
      }`}
      onClick={(event) => {
        event.stopPropagation();
        onSelect();
      }}
      initial={{ opacity: 0, filter: "blur(12px)", y: 22 }}
      animate={{ opacity: 1, filter: "blur(0px)", y: 0 }}
      exit={{ opacity: 0, filter: "blur(10px)", y: -16 }}
      transition={{ duration: 0.42, ease: [0.16, 1, 0.3, 1] }}
    >
      {selected ? (
        <div className="brush-toolbar" onClick={(event) => event.stopPropagation()}>
          <button type="button" title="Move up" onClick={() => onMove(-1)}>
            <ArrowUp size={14} />
          </button>
          <button type="button" title="Move down" onClick={() => onMove(1)}>
            <ArrowDown size={14} />
          </button>
          <button type="button" title="Remove" onClick={onRemove}>
            <Trash2 size={14} />
          </button>
        </div>
      ) : null}
      <SectionBody section={section} />
    </motion.section>
  );
}

function SectionBody({ section }: { section: CanvasSection }) {
  if (section.kind === "nav") {
    return (
      <nav className="demo-nav">
        <strong>{section.title}</strong>
        <div>
          <a>Menu</a>
          <a>Robots</a>
          <a>Visit</a>
        </div>
        <button type="button">Reserve</button>
      </nav>
    );
  }

  if (section.kind === "hero") {
    return (
      <div className="demo-hero">
        <div className="hero-copy">
          <h2>{section.title}</h2>
          <p>{section.subtitle}</p>
          {!section.hasWaitlist ? (
            <div className="hero-actions">
              <button type="button">Join waitlist</button>
              <span>First tasting opens at 7:30 AM</span>
            </div>
          ) : null}
          {section.hasWaitlist ? (
            <form className="waitlist-form">
              <label htmlFor="waitlist-email">Reserve a tasting</label>
              <div>
                <input id="waitlist-email" type="email" placeholder="name@studio.com" />
                <button type="button">Set</button>
              </div>
            </form>
          ) : null}
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

  if (section.kind === "features") {
    const items = [
      ["Measured pour", "Robotic arms tune grind, heat, and timing for each order."],
      ["Human calm", "The room stays quiet, tactile, and easy to understand."],
      ["Morning memory", "Regular orders reappear before the line reaches the counter."],
    ];
    return (
      <div className="demo-features">
        <div>
          <h2>{section.title}</h2>
          <p>{section.subtitle}</p>
        </div>
        <div className="feature-list">
          {items.map(([title, copy]) => (
            <article key={title}>
              <span />
              <h3>{title}</h3>
              <p>{copy}</p>
            </article>
          ))}
        </div>
      </div>
    );
  }

  if (section.kind === "pricing") {
    const plans = [
      ["Morning", "$6", "Single cup, timed pickup."],
      ["Studio", "$18", "Three cups across a work block."],
      ["Foundry", "$42", "Team tasting tray and notes."],
    ];
    return (
      <div className="demo-pricing">
        <div>
          <h2>{section.title}</h2>
          <p>{section.subtitle}</p>
        </div>
        <div className="pricing-list">
          {plans.map(([name, price, copy]) => (
            <article key={name}>
              <h3>{name}</h3>
              <strong>{price}</strong>
              <p>{copy}</p>
            </article>
          ))}
        </div>
      </div>
    );
  }

  if (section.kind === "cta") {
    return (
      <div className="demo-cta">
        <h2>{section.title}</h2>
        <p>{section.subtitle}</p>
        <button type="button">Set the paint</button>
      </div>
    );
  }

  return (
    <footer className="demo-footer">
      <strong>{section.title}</strong>
      <span>{section.subtitle}</span>
    </footer>
  );
}

function CommandCapsule({
  phase,
  open,
  draft,
  listening,
  selectedSection,
  onDraft,
  onOpen,
  onClose,
  onSubmit,
  onInterrupt,
  onListen,
}: {
  phase: Phase;
  open: boolean;
  draft: string;
  listening: boolean;
  selectedSection?: CanvasSection;
  onOpen: () => void;
  onDraft: (value: string) => void;
  onClose: () => void;
  onSubmit: () => void;
  onInterrupt: () => void;
  onListen: () => void;
}) {
  return (
    <div className={`command-dock ${open ? "is-open" : ""}`}>
      {open ? (
        <motion.div
          className="command-expanded"
          initial={{ opacity: 0, y: 20, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 18, scale: 0.98 }}
        >
          <div className="command-topline">
            <span>{selectedSection ? `Steering ${selectedSection.kind}` : "Steer the canvas"}</span>
            <button type="button" onClick={onClose}>
              <Scissors size={14} />
              Close
            </button>
          </div>
          <textarea
            value={draft}
            onChange={(event) => onDraft(event.target.value)}
            aria-label="Brushstroke instruction"
            placeholder="Say what should change"
          />
          <div className="command-actions">
            <button className={listening ? "is-listening" : ""} type="button" onClick={onListen}>
              <Mic size={16} />
              {listening ? "Listening" : "Speak"}
            </button>
            {phase === "painting" ? (
              <button type="button" onClick={onInterrupt}>
                <Pause size={16} />
                Interrupt
              </button>
            ) : null}
            <button className="send-stroke" type="button" onClick={onSubmit}>
              <Send size={16} />
              Apply stroke
            </button>
          </div>
        </motion.div>
      ) : (
        <button className="command-compact" type="button" onClick={onOpen}>
          <Mic size={18} />
          <span>Ctrl K to steer</span>
          <Brush size={16} />
        </button>
      )}
    </div>
  );
}

export default App;
