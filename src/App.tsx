import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  Code2,
  Download,
  FolderDown,
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
  redoProject,
  sectionStatus,
  undoProject,
  type PaletteOperation,
  type PaletteProject,
  type PaletteSwatch,
} from "./paletteModel";
import { requestCodexApply, type CodexApplyEvent } from "./codexApplyBridge";
import { requestIntent } from "./intentBridge";
import { requestProjectSave } from "./projectStoreBridge";
import { requestVoiceTranscription } from "./voiceBridge";

type Phase = "idle" | "interview" | "painting" | "paused" | "repainting" | "done";
type ProjectTemplate = "robot-coffee" | "portfolio" | "studio-saas";
type ProjectMood = "atelier" | "premium";
type SpeechRecognitionResultLike = ArrayLike<{ readonly isFinal: boolean; 0?: { transcript: string } }>;
type SpeechRecognitionLike = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: { results: SpeechRecognitionResultLike }) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  start: () => void;
  stop: () => void;
};
type SpeechRecognitionWindow = Window & {
  SpeechRecognition?: new () => SpeechRecognitionLike;
  webkitSpeechRecognition?: new () => SpeechRecognitionLike;
};

const phaseCopy: Record<Phase, string> = {
  idle: "Canvas is clean. Press Ctrl K and place the first brushstroke.",
  interview: "One studio question before the first wash.",
  painting: "Palette is painting in layers. Press Esc to interrupt.",
  paused: "Brush lifted. Steer the surface before it sets.",
  repainting: "Palette is repainting the selected surface.",
  done: "Canvas set. Select any section to keep steering.",
};

const paintPrepSteps = [
  { label: "Prime canvas", status: "Priming the glass surface." },
  { label: "Mix swatches", status: "Mixing the dark paint system." },
  { label: "Paint navigation", status: "Laying in the navigation frame." },
  { label: "Lay first wash", status: "Washing in the first viewport." },
  { label: "Paint details", status: "Detailing the section controls." },
];

const paintPrepDelayMs = 1050;
const paintSectionDelayMs = 1450;
const repaintDelayMs = 1250;

const demoEditCommands = [
  "Make the title bigger by 4pt.",
  "Change the picture to the pasted reference.",
  "Make the hero copy shorter and sharper.",
  "Make this section feel more premium.",
  "Add a note: Emphasize the morning rush use case.",
];

function App() {
  const [project, setProject] = useState<PaletteProject>(() => createBlankProject());
  const [phase, setPhase] = useState<Phase>("idle");
  const [activeStep, setActiveStep] = useState(0);
  const [paintQueue, setPaintQueue] = useState<PaletteSectionModel[]>([]);
  const [pendingTemplate, setPendingTemplate] = useState<ProjectTemplate>("robot-coffee");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [capsuleOpen, setCapsuleOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [listening, setListening] = useState(false);
  const [applying, setApplying] = useState(false);
  const [repoApplying, setRepoApplying] = useState(false);
  const [savingProject, setSavingProject] = useState(false);
  const [codexEvents, setCodexEvents] = useState<CodexApplyEvent[]>([]);
  const [status, setStatus] = useState(phaseCopy.idle);
  const [demoEditStep, setDemoEditStep] = useState(0);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const projectRef = useRef<PaletteProject | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const speechRecognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const liveTranscriptRef = useRef("");
  const liveTranscriptionTimerRef = useRef<number | null>(null);
  const liveTranscriptionInFlightRef = useRef(false);
  const audioChunksRef = useRef<Blob[]>([]);

  useEffect(() => {
    projectRef.current = project;
  }, [project]);

  const selectedSection = project.sections.find((section) => section.id === selectedId);

  const stopLiveSpeechRecognition = useCallback(() => {
    const recognition = speechRecognitionRef.current;
    if (!recognition) return;
    speechRecognitionRef.current = null;
    recognition.onresult = null;
    recognition.onend = null;
    recognition.onerror = null;
    try {
      recognition.stop();
    } catch {
      // The browser may already have ended recognition when recording stops.
    }
  }, []);

  const startLiveSpeechRecognition = useCallback(() => {
    const SpeechRecognition =
      (window as SpeechRecognitionWindow).SpeechRecognition ??
      (window as SpeechRecognitionWindow).webkitSpeechRecognition;
    if (!SpeechRecognition) return false;

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";
    recognition.onresult = (event) => {
      const transcript = Array.from(event.results)
        .map((result) => result[0]?.transcript ?? "")
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();

      if (!transcript) return;
      liveTranscriptRef.current = transcript;
      setDraft(transcript);
    };
    recognition.onerror = () => undefined;
    recognition.onend = () => {
      if (speechRecognitionRef.current === recognition) speechRecognitionRef.current = null;
    };

    try {
      recognition.start();
      speechRecognitionRef.current = recognition;
      return true;
    } catch {
      return false;
    }
  }, []);

  const stopLiveTranscriptionPolling = useCallback(() => {
    if (liveTranscriptionTimerRef.current !== null) {
      window.clearInterval(liveTranscriptionTimerRef.current);
      liveTranscriptionTimerRef.current = null;
    }
    liveTranscriptionInFlightRef.current = false;
  }, []);

  const transcribeLiveAudio = useCallback(async (recorder: MediaRecorder) => {
    if (
      liveTranscriptionInFlightRef.current ||
      recorder.state === "inactive" ||
      audioChunksRef.current.length === 0
    ) {
      return;
    }

    liveTranscriptionInFlightRef.current = true;
    const audio = new Blob(audioChunksRef.current, {
      type: recorder.mimeType || "audio/webm",
    });
    const result = await requestVoiceTranscription(audio);
    const text = result.text.trim();
    const activeRecorder = mediaRecorderRef.current;

    if (text && activeRecorder === recorder && activeRecorder.state !== "inactive") {
      liveTranscriptRef.current = text;
      setDraft(text);
    }

    liveTranscriptionInFlightRef.current = false;
  }, []);

  const openCommandCapsule = useCallback((nextDraft?: string) => {
    if (phase === "painting") {
      setPhase("paused");
      setStatus("Brush lifted mid-stroke. Steer the canvas before it keeps painting.");
    }

    if (nextDraft !== undefined) {
      setDraft(nextDraft);
    } else {
      setDraft("");
    }

    setCapsuleOpen(true);
  }, [phase]);

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
      projectRef.current = result.project;
      setStatus(result.status);
      return result.project;
    });
    return exportText;
  }, []);

  const applyOperations = useCallback((operations: PaletteOperation[]) => {
    // projectRef is always current — set synchronously in the useEffect above
    let next = projectRef.current!;
    let finalStatus = "";
    let exportText: string | undefined;

    for (const operation of operations) {
      const result = applyOperation(next, operation);
      next = result.project;
      finalStatus = result.status;
      exportText = result.project.exportText;
    }

    setProject(next);
    projectRef.current = next;
    if (finalStatus) setStatus(finalStatus);
    if (exportText) downloadExport(exportText);
  }, []);

  const applyDirection = useCallback(
    async (raw: string) => {
      if (applying) return;
      const command = raw.trim();
      const contextProject = projectRef.current!;
      if (!command && contextProject.sections.length === 0) {
        setStatus("No brushstroke given.");
        return;
      }
      const resolvedCommand = resolveDemoEditCommand(command, demoEditStep, contextProject.sections.length > 0);

      setApplying(true);
      setStatus("Mixing the brushstroke into safe canvas operations.");

      try {
        const resumePainting = phase === "paused" && activeStep < paintQueue.length + paintPrepSteps.length;
        const result = await requestIntent(resolvedCommand, { project: contextProject, selectedId });
        const startProject = result.operations.find(
          (operation): operation is Extract<PaletteOperation, { type: "start_project" }> =>
            operation.type === "start_project",
        );

        if (startProject) {
          setPendingTemplate(startProject.template);
          setDemoEditStep(0);
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

          setCapsuleOpen(false);
          setListening(false);
          setPhase("repainting");
          setStatus("Repainting the selected surface from your stroke.");
          await wait(repaintDelayMs);
          applyOperations(result.operations);
          setDemoEditStep((current) => nextDemoEditStep(resolvedCommand, current));
          setPhase(resumePainting ? "painting" : "done");
        } else {
          setStatus(result.status);
        }
      } finally {
        setApplying(false);
      }
    },
    [activeStep, applying, applyOperations, demoEditStep, paintQueue.length, phase, selectedId],
  );

  const interruptPainting = useCallback(() => {
    if (phase !== "painting") return;
    setPhase("paused");
    setCapsuleOpen(true);
    setDraft("");
    setStatus("Brush lifted mid-stroke. Tell Palette what to change.");
  }, [phase]);

  const removeSelected = useCallback(() => {
    if (!selectedId) return;
    if (phase === "painting") setPhase("paused");
    applyOneOperation({ type: "remove_section", id: selectedId });
    setSelectedId(null);
  }, [applyOneOperation, phase, selectedId]);

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
    if (project.sections.length === 0) {
      setStatus("Paint needs at least one section before it can be set.");
      return;
    }

    const result = applyOperation(project, { type: "export_project" });
    setProject(result.project);
    setStatus(result.status);
    if (result.project.exportText) downloadExport(result.project.exportText);
  }, [project]);

  const applyToRepo = useCallback(async () => {
    if (project.sections.length === 0) {
      setStatus("Paint needs at least one section before Codex can apply it.");
      return;
    }

    setRepoApplying(true);
    setCodexEvents([{ type: "phase", label: "Preparing Codex handoff", detail: "The canvas is being packed." }]);
    setStatus("Handing the canvas to Codex for repo edits.");
    const result = await requestCodexApply(project, (event) => {
      setCodexEvents((current) => (event.type === "output" ? current : [...current, event].slice(-10)));
      if (event.label) {
        setStatus(event.type === "output" ? event.label : event.detail ? `${event.label}. ${event.detail}` : event.label);
      }
    });
    setRepoApplying(false);
    setStatus(result.status);
  }, [project]);

  const saveToFolder = useCallback(async () => {
    if (project.sections.length === 0) {
      setStatus("Paint needs at least one section before it can be saved.");
      return;
    }

    setSavingProject(true);
    setStatus("Saving the canvas as a Codex-readable folder.");
    const result = await requestProjectSave(project);
    setSavingProject(false);
    setStatus(result.folder ? `${result.status} ${result.folder}` : result.status);
  }, [project]);

  const finishVoiceRecording = useCallback(
    async (audio: Blob) => {
      stopLiveTranscriptionPolling();
      stopLiveSpeechRecognition();
      setListening(false);
      setStatus("Transcribing the spoken brushstroke.");
      const result = await requestVoiceTranscription(audio);
      const spokenText = result.text.trim() || liveTranscriptRef.current.trim();

      if (spokenText) {
        setDraft(spokenText);
        setStatus(result.text.trim() ? result.status : "Using the live mic text.");
        void applyDirection(spokenText);
        return;
      }

      setStatus(result.status || "I did not catch a brushstroke. Speak the edit again.");
    },
    [applyDirection, stopLiveSpeechRecognition, stopLiveTranscriptionPolling],
  );

  const toggleVoiceInput = useCallback(async () => {
    const currentRecorder = mediaRecorderRef.current;
    if (currentRecorder && currentRecorder.state !== "inactive") {
      stopLiveTranscriptionPolling();
      stopLiveSpeechRecognition();
      currentRecorder.stop();
      return;
    }

    setCapsuleOpen(true);
    liveTranscriptRef.current = "";
    setDraft("");

    if (
      !navigator.mediaDevices?.getUserMedia ||
      typeof MediaRecorder === "undefined"
    ) {
      setListening(false);
      setStatus("This browser cannot record voice. Enable microphone support or type the stroke.");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;
      audioChunksRef.current = [];

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) audioChunksRef.current.push(event.data);
      };

      recorder.onstop = () => {
        stopLiveTranscriptionPolling();
        stream.getTracks().forEach((track) => track.stop());
        const audio = new Blob(audioChunksRef.current, {
          type: recorder.mimeType || "audio/webm",
        });
        void finishVoiceRecording(audio);
      };

      recorder.start(700);
      const hasLiveTranscript = startLiveSpeechRecognition();
      liveTranscriptionTimerRef.current = window.setInterval(() => {
        void transcribeLiveAudio(recorder);
      }, 1600);
      setListening(true);
      setStatus(
        hasLiveTranscript
          ? "Listening. The spoken brushstroke will appear as you talk."
          : "Listening. The spoken brushstroke will appear as it is transcribed.",
      );
    } catch {
      stopLiveTranscriptionPolling();
      stopLiveSpeechRecognition();
      setListening(false);
      setStatus("Microphone access was not available. Enable it and speak the edit again.");
    }
  }, [
    finishVoiceRecording,
    startLiveSpeechRecognition,
    stopLiveSpeechRecognition,
    stopLiveTranscriptionPolling,
    transcribeLiveAudio,
  ]);

  const removeSection = useCallback(
    (id: string) => {
      if (phase === "painting") setPhase("paused");
      applyOneOperation({ type: "remove_section", id });
      setSelectedId(null);
    },
    [applyOneOperation, phase],
  );

  const noteSection = useCallback(
    (section: PaletteSectionModel) => {
      setSelectedId(section.id);
      if (phase === "painting") {
        setPhase("paused");
        setStatus(`Brush lifted on the ${section.kind}. Speak or type the note.`);
      } else {
        setStatus(`Steering the ${section.kind}. Speak or type the note.`);
      }
      openCommandCapsule("");
    },
    [openCommandCapsule, phase],
  );

  const addFiles = useCallback(
    (files: FileList | File[]) => {
      const imageFiles = Array.from(files).filter((file) => file.type.startsWith("image/"));
      if (imageFiles.length === 0) return;

      for (const file of imageFiles) {
        const url = URL.createObjectURL(file);
        const id = `${file.name || "clipboard-reference"}-${Date.now()}`;
        const title = file.name?.replace(/\.[^.]+$/, "") || "Clipboard reference";
        const swatch: PaletteSwatch = {
          id,
          title,
          note: "Pinned visual reference.",
          url,
          colors: [],
        };
        applyOneOperation({ type: "add_swatch", swatch });

        extractColors(url).then((colors) => {
          if (colors.length === 0) return;
          const note = `Mixed ${colors.slice(0, 2).join(" and ")} from this reference.`;
          setProject((current) => {
            const next = {
              ...current,
              swatchAccent: current.swatches[0]?.id === id ? colors[0] : current.swatchAccent,
              swatchColors: current.swatches[0]?.id === id ? colors : current.swatchColors,
              swatches: current.swatches.map((item) =>
                item.id === id ? { ...item, note, colors } : item,
              ),
            };
            projectRef.current = next;
            return next;
          });
        });
      }
    },
    [applyOneOperation],
  );

  useEffect(() => {
    if (phase !== "painting") return;

    if (activeStep >= paintQueue.length + paintPrepSteps.length) {
      setPhase("done");
      setStatus("Canvas set. Keep selecting sections to steer.");
      return;
    }

    const timeout = window.setTimeout(() => {
      const prepStep = paintPrepSteps[activeStep];
      if (prepStep) {
        setStatus(prepStep.status);
      } else {
        const sectionIndex = activeStep - paintPrepSteps.length;
        const section = paintQueue[sectionIndex];
        if (section) {
          setStatus(sectionStatus(section, sectionIndex));
          applyOneOperation({ type: "add_section", section });
        }
      }
      setActiveStep((current) => current + 1);
    }, activeStep < paintPrepSteps.length ? paintPrepDelayMs : paintSectionDelayMs);

    return () => window.clearTimeout(timeout);
  }, [activeStep, applyOneOperation, paintQueue, phase]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      if ((event.metaKey || event.ctrlKey) && event.shiftKey && key === "k") {
        event.preventDefault();
        openCommandCapsule("");
        void toggleVoiceInput();
        return;
      }

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
        const currentRecorder = mediaRecorderRef.current;
        if (currentRecorder && currentRecorder.state !== "inactive") {
          event.preventDefault();
          currentRecorder.stop();
        } else if (phase === "painting") {
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
  }, [
    capsuleOpen,
    interruptPainting,
    openCommandCapsule,
    phase,
    redo,
    removeSelected,
    selectedId,
    toggleVoiceInput,
    undo,
  ]);

  useEffect(() => {
    return () => {
      stopLiveTranscriptionPolling();
      stopLiveSpeechRecognition();
      const currentRecorder = mediaRecorderRef.current;
      if (currentRecorder && currentRecorder.state !== "inactive") currentRecorder.stop();
    };
  }, [stopLiveSpeechRecognition, stopLiveTranscriptionPolling]);

  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      if (event.defaultPrevented || !event.clipboardData) return;
      if (event.target instanceof Element && event.target.closest(".command-dock")) return;
      const files = imageFilesFromClipboard(event.clipboardData);
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
          <p className="studio-mark">Introducing Codex Palette</p>
          <h1>Paint software into code.</h1>
        </div>
        <div className="header-actions">
          <button className="glass-button muted" type="button" onClick={() => openCommandCapsule("")}>
            <Mic size={16} />
            <span>Command</span>
          </button>
          <button className="glass-button" type="button" onClick={() => openCommandCapsule("")}>
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
          onSaveFolder={saveToFolder}
          onApplyToRepo={applyToRepo}
          savingProject={savingProject}
          repoApplying={repoApplying}
          codexEvents={codexEvents}
        />

        <section className="canvas-zone" aria-label="Palette canvas">
          <p className="sr-status" aria-live="polite">{status}</p>

          <div
            className={`canvas-board ${phase === "painting" || phase === "repainting" ? "is-painting" : ""} ${
              phase === "repainting" ? "is-repainting" : ""
            }`}
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
                  <h2>A clean canvas.</h2>
                  <p>
                    Press Ctrl K, place the first brushstroke, then interrupt while the canvas paints.
                  </p>
                  <button className="primary-stroke" type="button" onClick={() => openCommandCapsule("")}>
                    Begin with a brushstroke
                  </button>
                </motion.div>
              ) : null}

              {phase === "interview" ? (
                <motion.div
                  className="interview-card"
                  key="interview"
                  initial={{ clipPath: "circle(0% at 50% 50%)", opacity: 0 }}
                  animate={{ clipPath: "circle(80% at 50% 50%)", opacity: 1 }}
                  exit={{ clipPath: "circle(0% at 50% 50%)", opacity: 0 }}
                  transition={{ duration: 0.46, ease: [0.16, 1, 0.3, 1] }}
                >
                  <span>Prime the canvas</span>
                  <h2>Should this first wash feel premium or editorial?</h2>
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
                onRemove={removeSection}
                onNote={noteSection}
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
        applying={applying}
        selectedSection={selectedSection}
        onOpen={() => openCommandCapsule()}
        onDraft={setDraft}
        onClose={() => setCapsuleOpen(false)}
        onSubmit={(value) => applyDirection(value ?? draft)}
        onInterrupt={interruptPainting}
        onListen={toggleVoiceInput}
        onFiles={addFiles}
      />

      <input
        ref={fileInputRef}
        className="hidden-input"
        type="file"
        aria-label="Reference image swatches"
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
  onSaveFolder,
  onApplyToRepo,
  savingProject,
  repoApplying,
  codexEvents,
}: {
  project: PaletteProject;
  onFiles: (files: FileList | File[]) => void;
  onPickFiles: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onSetPaint: () => void;
  onSaveFolder: () => void;
  onApplyToRepo: () => void;
  savingProject: boolean;
  repoApplying: boolean;
  codexEvents: CodexApplyEvent[];
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
        <button type="button" onClick={onSetPaint} disabled={project.sections.length === 0}>
          <Download size={14} />
          Set paint
        </button>
        <button
          className="folder-action"
          type="button"
          onClick={onSaveFolder}
          disabled={project.sections.length === 0 || savingProject}
        >
          <FolderDown size={14} />
          {savingProject ? "Saving" : "Save folder"}
        </button>
        <button
          className="codex-action"
          type="button"
          onClick={onApplyToRepo}
          disabled={project.sections.length === 0 || repoApplying}
        >
          <Code2 size={14} />
          {repoApplying ? "Applying" : "Codex apply"}
        </button>
      </div>
      <CodexProgress events={codexEvents} active={repoApplying} />
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

function CodexProgress({ events, active }: { events: CodexApplyEvent[]; active: boolean }) {
  if (events.length === 0) return null;

  return (
    <section className={`codex-progress ${active ? "is-active" : ""}`} aria-label="Codex progress">
      <h2>Codex progress</h2>
      {events.slice(-7).map((event, index) => (
        <article key={`${event.at ?? index}-${event.label}`}>
          <strong>{event.label}</strong>
          {event.detail ? <p>{event.detail}</p> : null}
        </article>
      ))}
    </section>
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

function GeneratedPage({
  sections,
  theme,
  selectedId,
  onSelect,
  onMove,
  onRemove,
  onNote,
  onSetPaint,
}: {
  sections: PaletteSectionModel[];
  theme: string;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onMove: (id: string, direction: -1 | 1) => void;
  onRemove: (id: string) => void;
  onNote: (section: PaletteSectionModel) => void;
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
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -14 }}
            transition={{ duration: 0.38, ease: [0.16, 1, 0.3, 1] }}
          >
            <PaletteSectionView
              section={section}
              helpers={{
                selected: selectedId === section.id,
                onSelect,
                onMove,
                onRemove,
                onNote,
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
  applying,
  selectedSection,
  onDraft,
  onOpen,
  onClose,
  onSubmit,
  onInterrupt,
  onListen,
  onFiles,
}: {
  phase: Phase;
  open: boolean;
  draft: string;
  listening: boolean;
  applying: boolean;
  selectedSection?: PaletteSectionModel;
  onOpen: () => void;
  onDraft: (value: string) => void;
  onClose: () => void;
  onSubmit: (value?: string) => void;
  onInterrupt: () => void;
  onListen: () => void | Promise<void>;
  onFiles: (files: FileList | File[]) => void;
}) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (!open) return;
    window.setTimeout(() => textareaRef.current?.focus(), 0);
  }, [open]);

  return (
    <div className={`command-dock ${open ? "is-open" : ""}`}>
      <AnimatePresence mode="wait">
      {open ? (
        <motion.div
          key="expanded"
          className={`command-expanded ${listening ? "is-listening" : ""}`}
          initial={{ opacity: 0, y: 20, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 18, scale: 0.98 }}
          transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
        >
          <div className="command-topline">
            <span>{selectedSection ? `Steering ${selectedSection.kind}` : "Steer the canvas"}</span>
            <button type="button" onClick={onClose}>
              <Scissors size={14} />
              Close
            </button>
          </div>
          <textarea
            ref={textareaRef}
            autoFocus
            value={draft}
            onChange={(event) => onDraft(event.target.value)}
            onPaste={(event) => {
              const files = imageFilesFromClipboard(event.clipboardData);
              if (files.length === 0) return;
              event.preventDefault();
              event.stopPropagation();
              onFiles(files);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey && !applying) {
                event.preventDefault();
                onSubmit(textareaRef.current?.value ?? draft);
              }
            }}
            aria-label="Brushstroke instruction"
            placeholder="Say what should change"
          />
          {listening ? (
            <div className="voice-meter" aria-hidden="true">
              <span />
              <span />
              <span />
              <span />
            </div>
          ) : null}
          <div className="command-actions">
            <button
              className={listening ? "is-listening" : ""}
              type="button"
              aria-pressed={listening}
              onClick={onListen}
            >
              <Mic size={16} />
              {listening ? "Set voice" : "Voice stroke"}
            </button>
            {phase === "painting" ? (
              <button type="button" onClick={onInterrupt}>
                <Pause size={16} />
                Interrupt
              </button>
            ) : null}
            <button
              className="send-stroke"
              type="button"
              onClick={() => onSubmit(textareaRef.current?.value ?? draft)}
              disabled={applying}
            >
              <Send size={16} />
              {applying ? "Mixing" : "Apply stroke"}
            </button>
          </div>
        </motion.div>
      ) : (
        <motion.button
          key="compact"
          className="command-compact"
          type="button"
          onClick={onOpen}
          initial={{ opacity: 0, y: 10, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 8, scale: 0.97 }}
          transition={{ duration: 0.15, ease: [0.16, 1, 0.3, 1] }}
        >
          <Mic size={18} />
          <span>Ctrl K steer</span>
        </motion.button>
      )}
      </AnimatePresence>
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
      let data: Uint8ClampedArray;
      try {
        data = context.getImageData(0, 0, size, size).data;
      } catch {
        resolve([]);
        return;
      }
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

function wait(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function resolveDemoEditCommand(command: string, currentStep: number, hasCanvas: boolean) {
  const explicitStep = demoStepIndexFromCommand(command);
  if (explicitStep !== null) return demoEditCommands[explicitStep];

  const text = normalizeDemoCommand(command);
  if (["next", "next edit", "continue", "do the next one", "run the next one"].includes(text)) {
    return demoEditCommands[currentStep] ?? command;
  }

  const inferredStep = inferDemoEditStep(command);
  if (inferredStep !== null) return demoEditCommands[inferredStep];

  if (hasCanvas && currentStep < demoEditCommands.length) {
    return demoEditCommands[currentStep];
  }

  return command;
}

function nextDemoEditStep(command: string, currentStep: number) {
  const explicitStep = demoEditCommands.findIndex(
    (demoCommand) => normalizeDemoCommand(demoCommand) === normalizeDemoCommand(command),
  );
  if (explicitStep >= 0) return Math.min(demoEditCommands.length, Math.max(currentStep, explicitStep + 1));

  const inferredStep = inferDemoEditStep(command);
  if (inferredStep !== null) return Math.min(demoEditCommands.length, Math.max(currentStep, inferredStep + 1));

  return currentStep;
}

function demoStepIndexFromCommand(command: string) {
  const text = normalizeDemoCommand(command);
  const aliases = [
    ["1", "one", "first", "step 1", "step one", "edit 1", "edit one"],
    ["2", "two", "second", "step 2", "step two", "edit 2", "edit two"],
    ["3", "three", "third", "step 3", "step three", "edit 3", "edit three"],
    ["4", "four", "fourth", "step 4", "step four", "edit 4", "edit four"],
    ["5", "five", "fifth", "step 5", "step five", "edit 5", "edit five"],
  ];
  const index = aliases.findIndex((group) => group.includes(text));
  return index >= 0 ? index : null;
}

function inferDemoEditStep(command: string) {
  const text = normalizeDemoCommand(command);
  if (text.includes("title") && (text.includes("bigger") || text.includes("larger"))) return 0;
  if ((text.includes("image") || text.includes("picture") || text.includes("photo")) && text.includes("change")) return 1;
  if (text.includes("copy") && (text.includes("shorter") || text.includes("sharper"))) return 2;
  if (text.includes("premium")) return 3;
  if (text.includes("note")) return 4;
  return null;
}

function normalizeDemoCommand(command: string) {
  return command
    .trim()
    .toLowerCase()
    .replace(/[^\w\s]/g, "")
    .replace(/\s+/g, " ");
}

function imageFilesFromClipboard(data: DataTransfer) {
  const byKey = new Map<string, File>();
  const add = (file: File | null) => {
    if (!file || !file.type.startsWith("image/")) return;
    const key = `${file.name}-${file.size}-${file.type}-${file.lastModified}`;
    byKey.set(key, file);
  };

  Array.from(data.files).forEach(add);
  Array.from(data.items).forEach((item) => {
    if (item.kind === "file") add(item.getAsFile());
  });

  return Array.from(byKey.values());
}

export default App;
