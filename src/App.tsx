import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  Brush,
  Download,
  ImagePlus,
  Mic,
  Pause,
  Play,
  Redo2,
  RotateCcw,
  Scissors,
  Send,
} from "lucide-react";
import {
  PaletteSectionView,
  type PaletteSectionModel,
} from "./sectionRenderers";
import {
  applyOperation,
  createBlankProject,
  createProjectFromTemplate,
  parseIntent,
  paintingStageLabels,
  redoProject,
  sectionStatus,
  undoProject,
  type PaletteOperation,
  type PaletteProject,
  type PaletteSwatch,
} from "./paletteModel";

type Phase = "idle" | "interview" | "painting" | "paused" | "done";
type ProjectTemplate = "robot-coffee" | "portfolio" | "studio-saas";
type ProjectMood = "atelier" | "premium";

const initialStroke = "Build a landing page for a robot coffee shop.";

const phaseCopy: Record<Phase, string> = {
  idle: "Canvas is clean. Press Ctrl K and place the first brushstroke.",
  interview: "One studio question before the first wash.",
  painting: "Palette is painting in layers. Press Esc to interrupt.",
  paused: "Brush lifted. Steer the surface before it sets.",
  done: "Canvas set. Select any section to keep steering.",
};

function App() {
  const [project, setProject] = useState<PaletteProject>(() => createBlankProject());
  const [phase, setPhase] = useState<Phase>("idle");
  const [activeStep, setActiveStep] = useState(0);
  const [paintQueue, setPaintQueue] = useState<PaletteSectionModel[]>([]);
  const [pendingTemplate, setPendingTemplate] = useState<ProjectTemplate>("robot-coffee");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [capsuleOpen, setCapsuleOpen] = useState(false);
  const [draft, setDraft] = useState(initialStroke);
  const [listening, setListening] = useState(false);
  const [status, setStatus] = useState(phaseCopy.idle);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const selectedSection = project.sections.find((section) => section.id === selectedId);

  const openCommandCapsule = useCallback(() => {
    setCapsuleOpen(true);
  }, []);

  const replaceProjectForPainting = useCallback(
    (template: ProjectTemplate, mood: ProjectMood) => {
      const nextProject = createProjectFromTemplate(template);
      nextProject.swatches = project.swatches;
      nextProject.swatchAccent = project.swatchAccent;
      nextProject.swatchColors = project.swatchColors;
      nextProject.theme = mood;
      nextProject.sections = nextProject.sections.map((section) => ({
        ...section,
        variant: section.variant === "playful" ? "playful" : mood,
      }));
      setProject({ ...nextProject, sections: [] });
      setPaintQueue(nextProject.sections);
      setSelectedId(null);
      setActiveStep(0);
      setPhase("painting");
      setStatus("The first wash is starting.");
    },
    [project.swatches, project.swatchAccent, project.swatchColors],
  );

  const applyOneOperation = useCallback((operation: PaletteOperation) => {
    let exportText: string | undefined;
    setProject((current) => {
      const result = applyOperation(current, operation);
      exportText = result.project.exportText;
      setStatus(result.status);
      return result.project;
    });
    return exportText;
  }, []);

  const applyOperations = useCallback((operations: PaletteOperation[]) => {
    let next = project;
    let finalStatus = "";
    let exportText: string | undefined;

    for (const operation of operations) {
      const result = applyOperation(next, operation);
      next = result.project;
      finalStatus = result.status;
      exportText = result.project.exportText;
    }

    setProject(next);
    if (finalStatus) setStatus(finalStatus);
    if (exportText) downloadExport(exportText);
  }, [project]);

  const applyDirection = useCallback(
    (raw: string) => {
      const result = parseIntent(raw, { project, selectedId });
      const startProject = result.operations.find(
        (operation): operation is Extract<PaletteOperation, { type: "start_project" }> =>
          operation.type === "start_project",
      );

      if (startProject) {
        setPendingTemplate(startProject.template);
        setCapsuleOpen(false);
        setPhase("interview");
        setStatus(result.status);
        return;
      }

      if (result.operations.length > 0) {
        const premiumTheme = result.operations.some(
          (operation) => operation.type === "set_theme" && operation.theme === "premium",
        );
        const atelierTheme = result.operations.some(
          (operation) => operation.type === "set_theme" && operation.theme === "atelier",
        );

        if (premiumTheme || atelierTheme) {
          setPaintQueue((current) =>
            current.map((section) => ({
              ...section,
              variant:
                section.variant === "playful"
                  ? "playful"
                  : premiumTheme
                    ? "premium"
                    : "atelier",
            })),
          );
        }

        applyOperations(result.operations);
        if (phase === "paused") setPhase("painting");
      } else {
        setStatus(result.status);
      }
      setCapsuleOpen(false);
    },
    [applyOperations, phase, project, selectedId],
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
    applyOneOperation({ type: "remove_section", id: selectedId });
    setSelectedId(null);
  }, [applyOneOperation, selectedId]);

  const moveSelected = useCallback(
    (id: string, direction: -1 | 1) => {
      applyOneOperation({ type: "move_section", id, direction });
      setSelectedId(id);
    },
    [applyOneOperation],
  );

  const undo = useCallback(() => {
    setProject((current) => {
      const result = undoProject(current);
      setStatus(result.status);
      return result.project;
    });
  }, []);

  const redo = useCallback(() => {
    setProject((current) => {
      const result = redoProject(current);
      setStatus(result.status);
      return result.project;
    });
  }, []);

  const setPaint = useCallback(() => {
    const result = applyOperation(project, { type: "export_project" });
    setProject(result.project);
    setStatus(result.status);
    if (result.project.exportText) downloadExport(result.project.exportText);
  }, [project]);

  const addFiles = useCallback(
    (files: FileList | File[]) => {
      const imageFiles = Array.from(files).filter((file) => file.type.startsWith("image/"));
      if (imageFiles.length === 0) return;

      for (const file of imageFiles) {
        const url = URL.createObjectURL(file);
        extractColors(url).then((colors) => {
          const swatch: PaletteSwatch = {
            id: `${file.name}-${Date.now()}`,
            title: file.name.replace(/\.[^.]+$/, "") || "Reference",
            note: colors.length
              ? `Mixed ${colors.slice(0, 2).join(" and ")} from this reference.`
              : "Pinned visual reference.",
            url,
            colors,
          };
          applyOneOperation({ type: "add_swatch", swatch });
        });
      }
    },
    [applyOneOperation],
  );

  useEffect(() => {
    if (phase !== "painting") return;

    if (activeStep >= paintQueue.length + 2) {
      setPhase("done");
      setStatus("Canvas set. Keep selecting sections to steer.");
      return;
    }

    const timeout = window.setTimeout(() => {
      if (activeStep === 0) {
        setStatus("Priming the canvas with a warm studio surface.");
      } else if (activeStep === 1) {
        setStatus("Mixing swatches into a controlled component model.");
      } else {
        const sectionIndex = activeStep - 2;
        const section = paintQueue[sectionIndex];
        if (section) {
          setStatus(sectionStatus(section, sectionIndex));
          applyOneOperation({ type: "add_section", section });
        }
      }
      setActiveStep((current) => current + 1);
    }, activeStep < 2 ? 520 : 920);

    return () => window.clearTimeout(timeout);
  }, [activeStep, applyOneOperation, paintQueue, phase]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      if ((event.metaKey || event.ctrlKey) && key === "k") {
        event.preventDefault();
        openCommandCapsule();
        return;
      }

      if ((event.metaKey || event.ctrlKey) && key === "z") {
        event.preventDefault();
        undo();
        return;
      }

      if ((event.metaKey || event.ctrlKey) && (key === "y" || (event.shiftKey && key === "z"))) {
        event.preventDefault();
        redo();
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
  }, [capsuleOpen, interruptPainting, openCommandCapsule, phase, redo, removeSelected, selectedId, undo]);

  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      if (!event.clipboardData) return;
      const files = Array.from(event.clipboardData.files);
      if (files.length > 0) addFiles(files);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [addFiles]);

  const shellStyle = project.swatchAccent
    ? ({ "--swatch-accent": project.swatchAccent } as CSSProperties)
    : undefined;

  return (
    <main className={`app-shell theme-${project.theme}`} style={shellStyle}>
      <div className="atelier-wash" aria-hidden="true" />
      <header className="studio-header">
        <div>
          <p className="studio-mark">Palette</p>
          <h1>Paint software into code.</h1>
        </div>
        <div className="header-actions">
          <button className="glass-button muted" type="button" onClick={openCommandCapsule}>
            <Mic size={16} />
            <span>Steer</span>
          </button>
          <button className="glass-button" type="button" onClick={openCommandCapsule}>
            <Play size={16} />
            <span>Start stroke</span>
          </button>
        </div>
      </header>

      <section className="studio-grid">
        <ReferenceSwatches
          project={project}
          onFiles={addFiles}
          onPickFiles={() => fileInputRef.current?.click()}
          onUndo={undo}
          onRedo={redo}
          onSetPaint={setPaint}
        />

        <section className="canvas-zone" aria-label="Palette canvas">
          <CorgiGuide phase={phase} status={status} />
          <StatusRail activeStep={activeStep} totalSections={paintQueue.length} phase={phase} />

          <div
            className={`canvas-board ${phase === "painting" ? "is-painting" : ""}`}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              addFiles(event.dataTransfer.files);
            }}
          >
            <AnimatePresence mode="popLayout">
              {phase === "idle" && project.sections.length === 0 ? (
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
                    Press Ctrl K, place the first brushstroke, then interrupt while the canvas paints.
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
                    <button type="button" onClick={() => replaceProjectForPainting(pendingTemplate, "premium")}>
                      Premium, but still charming
                    </button>
                    <button type="button" onClick={() => replaceProjectForPainting(pendingTemplate, "atelier")}>
                      Quiet and editorial
                    </button>
                  </div>
                </motion.div>
              ) : null}
            </AnimatePresence>

            {project.sections.length > 0 ? (
              <GeneratedPage
                sections={project.sections}
                theme={project.theme}
                selectedId={selectedId}
                onSelect={setSelectedId}
                onMove={moveSelected}
                onRemove={(id) => {
                  applyOneOperation({ type: "remove_section", id });
                  setSelectedId(null);
                }}
                onSetPaint={setPaint}
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
  project,
  onFiles,
  onPickFiles,
  onUndo,
  onRedo,
  onSetPaint,
}: {
  project: PaletteProject;
  onFiles: (files: FileList | File[]) => void;
  onPickFiles: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onSetPaint: () => void;
}) {
  return (
    <aside className="swatch-panel">
      <div className="panel-heading">
        <span>Swatches</span>
        <button type="button" title="Add image swatch" onClick={onPickFiles}>
          <ImagePlus size={16} />
        </button>
      </div>
      <div className="studio-actions">
        <button type="button" onClick={onUndo} disabled={project.past.length === 0}>
          <RotateCcw size={14} />
          Undo
        </button>
        <button type="button" onClick={onRedo} disabled={project.future.length === 0}>
          <Redo2 size={14} />
          Redo
        </button>
        <button type="button" onClick={onSetPaint}>
          <Download size={14} />
          Set paint
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
        {project.swatches.map((swatch) => (
          <article className={`swatch-card tone-${swatch.tone ?? "paper"}`} key={swatch.id}>
            <div
              className="swatch-image"
              style={
                swatch.colors?.length
                  ? { background: `linear-gradient(135deg, ${swatch.colors.join(", ")})` }
                  : undefined
              }
            >
              {swatch.url ? <img src={swatch.url} alt="" /> : <span />}
            </div>
            <h3>{swatch.title}</h3>
            <p>{swatch.note}</p>
          </article>
        ))}
      </div>
      <BrushLog project={project} />
    </aside>
  );
}

function BrushLog({ project }: { project: PaletteProject }) {
  return (
    <section className="brush-log" aria-label="Brush log">
      <h2>Brush log</h2>
      {project.brushLog.slice(0, 5).map((entry) => (
        <article key={entry.id}>
          <strong>{entry.label}</strong>
          <p>{entry.detail}</p>
        </article>
      ))}
    </section>
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

function StatusRail({
  activeStep,
  totalSections,
  phase,
}: {
  activeStep: number;
  totalSections: number;
  phase: Phase;
}) {
  const visibleLabels =
    totalSections > 0
      ? paintingStageLabels
      : ["Prime canvas", "Mix swatches", "Paint navigation", "Lay first wash", "Paint details"];

  return (
    <ol className="status-rail" aria-label="Painting progress">
      {visibleLabels.map((label, index) => {
        const state = phase === "done" || index < activeStep ? "done" : index === activeStep ? "active" : "";
        return (
          <li className={state} key={label}>
            <span />
            {label}
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
  onSetPaint,
}: {
  sections: PaletteSectionModel[];
  theme: string;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onMove: (id: string, direction: -1 | 1) => void;
  onRemove: (id: string) => void;
  onSetPaint: () => void;
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
          <motion.div
            className="section-motion-shell"
            key={section.id}
            layout
            initial={{ opacity: 0, filter: "blur(12px)", y: 22 }}
            animate={{ opacity: 1, filter: "blur(0px)", y: 0 }}
            exit={{ opacity: 0, filter: "blur(10px)", y: -16 }}
            transition={{ duration: 0.42, ease: [0.16, 1, 0.3, 1] }}
          >
            <PaletteSectionView
              section={section}
              helpers={{
                selected: selectedId === section.id,
                onSelect,
                onMove,
                onRemove,
                onAction: (_section, action) => {
                  if (action.label.toLowerCase().includes("set")) onSetPaint();
                },
              }}
            />
          </motion.div>
        ))}
      </AnimatePresence>
    </motion.div>
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
  selectedSection?: PaletteSectionModel;
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
              {listening ? "Filling" : "Demo stroke"}
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

function downloadExport(text: string) {
  const blob = new Blob([text], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "palette-project.json";
  anchor.click();
  URL.revokeObjectURL(url);
}

function extractColors(url: string): Promise<string[]> {
  return new Promise((resolve) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => {
      const canvas = document.createElement("canvas");
      const size = 24;
      canvas.width = size;
      canvas.height = size;
      const context = canvas.getContext("2d");
      if (!context) {
        resolve([]);
        return;
      }
      context.drawImage(image, 0, 0, size, size);
      const data = context.getImageData(0, 0, size, size).data;
      let r = 0;
      let g = 0;
      let b = 0;
      let count = 0;
      for (let index = 0; index < data.length; index += 16) {
        r += data[index];
        g += data[index + 1];
        b += data[index + 2];
        count += 1;
      }
      if (count === 0) {
        resolve([]);
        return;
      }
      const first = rgbToHex(Math.round(r / count), Math.round(g / count), Math.round(b / count));
      const second = rgbToHex(
        Math.max(24, Math.round(r / count) - 42),
        Math.max(24, Math.round(g / count) - 32),
        Math.max(24, Math.round(b / count) - 22),
      );
      resolve([first, second]);
    };
    image.onerror = () => resolve([]);
    image.src = url;
  });
}

function rgbToHex(r: number, g: number, b: number) {
  return `#${[r, g, b].map((value) => value.toString(16).padStart(2, "0")).join("")}`;
}

export default App;
