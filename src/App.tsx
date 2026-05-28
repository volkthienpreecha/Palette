import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  Code2,
  FileArchive,
  Download,
  FolderDown,
  ImagePlus,
  Mic,
  Pause,
  Pin,
  PinOff,
  Play,
  Plus,
  Redo2,
  RotateCcw,
  Save,
  Scissors,
  Send,
  Trash2,
} from "lucide-react";
import {
  PaletteSectionView,
  type PaletteSectionModel,
} from "./sectionRenderers";
import {
  applyOperation,
  createBlankProject,
  redoProject,
  sectionStatus,
  undoProject,
  type PaletteOperation,
  type PaletteProject,
  type PaletteSwatch,
} from "./paletteModel";
import { requestCodexApply, type CodexApplyEvent } from "./codexApplyBridge";
import { requestProjectSave } from "./projectStoreBridge";
import {
  notesForBuild,
  requestBuildEngineStatus,
  requestDesignContext,
  requestInterviewNext,
  requestWorkspaceBundle,
  requestWorkspaceBuild,
  requestWorkspacePatch,
  requestWorkspacePolish,
  type InterviewQuestion,
  type PaletteBrief,
  type PaletteBuildEvent,
  type BuildEngineStatus,
} from "./skillBuildBridge";
import { requestVoiceTranscription } from "./voiceBridge";
import {
  createHandoffBundle,
  createPinnedNote,
  createSubmission,
  createSubmissionsCsv,
  createWorkspaceState,
  fileToPersistentSwatch,
  loadWorkspaceState,
  persistWorkspaceState,
  requestWorkspaceLoad,
  saveProjectToShelf,
  withWorkspaceContext,
  type PalettePinnedNote,
  type PaletteSubmission,
  type SavedPaletteProject,
} from "./workspaceBridge";

type Phase = "idle" | "interview" | "references" | "building" | "painting" | "paused" | "repainting" | "done";
type StudioProgressEvent = CodexApplyEvent | PaletteBuildEvent;
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
  interview: "A few studio questions before the first wash.",
  references: "Pin references, links, and notes before the first paint pass.",
  building: "Codex is painting the first real workspace files.",
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

const formIntentPattern = /\b(waitlist|form|email|signup|sign up|join|reserve|book|schedule|consult|contact|lead|request)\b/i;

function isInlineFormStroke(command: string) {
  return formIntentPattern.test(command);
}

function isHeroFormAction(label: string) {
  return formIntentPattern.test(label);
}

function App() {
  const [initialWorkspace] = useState(() => loadWorkspaceState(createBlankProject()));
  const [project, setProject] = useState<PaletteProject>(() => initialWorkspace.project);
  const [phase, setPhase] = useState<Phase>(() =>
    initialWorkspace.project.sections.length > 0 ? "done" : "idle",
  );
  const [activeStep, setActiveStep] = useState(0);
  const [paintQueue, setPaintQueue] = useState<PaletteSectionModel[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(() => initialWorkspace.selectedId);
  const [workspaceNotes, setWorkspaceNotes] = useState<PalettePinnedNote[]>(() => initialWorkspace.notes);
  const [submissions, setSubmissions] = useState<PaletteSubmission[]>(() => initialWorkspace.submissions);
  const [savedProjects, setSavedProjects] = useState<SavedPaletteProject[]>(
    () => initialWorkspace.savedProjects,
  );
  const [noteDraft, setNoteDraft] = useState("");
  const [capsuleOpen, setCapsuleOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [listening, setListening] = useState(false);
  const [applying, setApplying] = useState(false);
  const [repoApplying, setRepoApplying] = useState(false);
  const [savingProject, setSavingProject] = useState(false);
  const [codexEvents, setCodexEvents] = useState<StudioProgressEvent[]>([]);
  const [engineStatus, setEngineStatus] = useState<BuildEngineStatus | null>(null);
  const [buildProjectId, setBuildProjectId] = useState<string | null>(() => initialWorkspace.buildProjectId);
  const [brief, setBrief] = useState<PaletteBrief>(() => initialWorkspace.brief);
  const [interviewQuestion, setInterviewQuestion] = useState<InterviewQuestion | null>(null);
  const [interviewAnswer, setInterviewAnswer] = useState("");
  const [interviewHistory, setInterviewHistory] = useState<Array<{ field?: string; question: string; answer: string }>>([]);
  const [referenceDraft, setReferenceDraft] = useState("");
  const [referenceNoteDraft, setReferenceNoteDraft] = useState("");
  const [status, setStatus] = useState(() =>
    initialWorkspace.project.sections.length > 0
      ? "Restored the latest canvas from the studio shelf."
      : phaseCopy.idle,
  );
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const projectRef = useRef<PaletteProject | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const speechRecognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const buildAbortRef = useRef<AbortController | null>(null);
  const liveTranscriptRef = useRef("");
  const liveTranscriptionTimerRef = useRef<number | null>(null);
  const liveTranscriptionInFlightRef = useRef(false);
  const audioChunksRef = useRef<Blob[]>([]);

  useEffect(() => {
    projectRef.current = project;
  }, [project]);

  const selectedSection = project.sections.find((section) => section.id === selectedId);
  const includedNoteCount = workspaceNotes.filter((note) => note.includeInContext).length;

  const addPinnedNote = useCallback(
    (text: string, target = selectedSection) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      setWorkspaceNotes((current) => [createPinnedNote(trimmed, target), ...current].slice(0, 12));
      setNoteDraft("");
      setStatus(target ? `Pinned a note to the ${target.kind} wash.` : "Pinned a note to the canvas.");
    },
    [selectedSection],
  );

  const toggleNoteContext = useCallback((id: string) => {
    setWorkspaceNotes((current) =>
      current.map((note) =>
        note.id === id
          ? {
              ...note,
              includeInContext: !note.includeInContext,
              updatedAt: new Date().toISOString(),
            }
          : note,
      ),
    );
  }, []);

  const removePinnedNote = useCallback((id: string) => {
    setWorkspaceNotes((current) => current.filter((note) => note.id !== id));
  }, []);

  const saveCurrentProject = useCallback(() => {
    const result = saveProjectToShelf(project, workspaceNotes, submissions, savedProjects);
    setProject(result.project);
    projectRef.current = result.project;
    setSavedProjects(result.savedProjects);
    setStatus("Saved this canvas to the studio shelf.");
  }, [project, savedProjects, submissions, workspaceNotes]);

  const loadSavedProject = useCallback((saved: SavedPaletteProject) => {
    setProject(saved.project);
    projectRef.current = saved.project;
    setWorkspaceNotes(saved.notes);
      setSubmissions(saved.submissions);
      setSelectedId(null);
      setPaintQueue([]);
      setActiveStep(0);
      setBuildProjectId(null);
      setBrief({});
      setPhase(saved.project.sections.length > 0 ? "done" : "idle");
      setStatus(`Loaded ${saved.name} from the studio shelf.`);
  }, []);

  const startNewCanvas = useCallback(() => {
    const blank = {
      ...createBlankProject(),
      id: `project-${Date.now()}`,
    };
    setProject(blank);
    projectRef.current = blank;
    setWorkspaceNotes([]);
    setSubmissions([]);
    setSelectedId(null);
    setPaintQueue([]);
    setActiveStep(0);
    setBuildProjectId(null);
    setBrief({});
    setInterviewQuestion(null);
    setInterviewAnswer("");
    setInterviewHistory([]);
    setReferenceDraft("");
    setReferenceNoteDraft("");
    setCodexEvents([]);
    setPhase("idle");
    setStatus("A clean canvas is ready.");
  }, []);

  const exportSubmissions = useCallback(() => {
    if (submissions.length === 0) {
      setStatus("No submissions to export yet.");
      return;
    }

    downloadText(createSubmissionsCsv(submissions), "palette-submissions.csv", "text/csv");
    setStatus("Downloaded the studio submissions.");
  }, [submissions]);

  const downloadHandoffBundle = useCallback(() => {
    if (project.sections.length === 0) {
      setStatus("Paint needs at least one section before handoff.");
      return;
    }

    downloadText(
      createHandoffBundle(project, workspaceNotes, submissions),
      "palette-handoff.json",
      "application/json",
    );
    setStatus("Downloaded a handoff bundle without calling Codex.");
  }, [project, submissions, workspaceNotes]);

  const downloadWorkspaceBundle = useCallback(async () => {
    if (!buildProjectId) {
      setStatus("Begin painting before downloading generated files.");
      return;
    }

    try {
      const bundle = await requestWorkspaceBundle(buildProjectId);
      downloadText(
        `${JSON.stringify(bundle, null, 2)}\n`,
        `palette-workspace-${bundle.projectId}.json`,
        "application/json",
      );
      setStatus("Downloaded the generated files for your code agent.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not download generated files.");
    }
  }, [buildProjectId]);

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
    if (phase === "building" || phase === "painting") {
      buildAbortRef.current?.abort();
      buildAbortRef.current = null;
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
    // projectRef is always current because useEffect keeps it synchronized.
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

  const currentBuildNotes = useCallback(() => notesForBuild(workspaceNotes), [workspaceNotes]);

  const recordBuildEvent = useCallback((event: PaletteBuildEvent) => {
    setCodexEvents((current) => (event.type === "output" ? current : [...current, event].slice(-10)));
    if (event.type === "section" && event.project) {
      setBuildProjectId(event.projectId || null);
      setPaintQueue([]);
      setPhase("painting");
      setProject(event.project);
      projectRef.current = event.project;
    }
    if (event.label) {
      setStatus(event.type === "output" ? event.label : event.detail ? `${event.label}. ${event.detail}` : event.label);
    }
  }, []);

  const ensureContext = useCallback(
    async (nextBrief = brief) => {
      const contextProject = withWorkspaceContext(projectRef.current!, workspaceNotes, submissions);
      const result = await requestDesignContext({
        projectId: buildProjectId,
        brief: nextBrief,
        references: contextProject.swatches,
        notes: currentBuildNotes(),
        project: contextProject,
      });
      setBuildProjectId(result.projectId);
      setBrief(result.brief);
      return result;
    },
    [brief, buildProjectId, currentBuildNotes, submissions, workspaceNotes],
  );

  const beginWorkspaceBuild = useCallback(
    async (nextBrief = brief) => {
      setApplying(true);
      setCapsuleOpen(false);
      setPhase("building");
      setSelectedId(null);
      setActiveStep(0);
      setPaintQueue([]);
      const originalProject = projectRef.current!;
      setProject((current) => {
        const next = { ...current, sections: [] };
        projectRef.current = next;
        return next;
      });
      setCodexEvents([{ type: "phase", label: "Preparing the canvas", detail: "Palette is saving the design brief." }]);
      const controller = new AbortController();
      buildAbortRef.current = controller;

      try {
        const context = await ensureContext(nextBrief);
        const result = await requestWorkspaceBuild(
          {
            projectId: context.projectId,
            command: nextBrief.product || "Paint the first version from this brief.",
            brief: context.brief,
            references: context.references,
            notes: context.notes,
            project: withWorkspaceContext(projectRef.current!, workspaceNotes, submissions),
          },
          recordBuildEvent,
          controller.signal,
        );

      if (!result.applied || result.project.sections.length === 0) {
          if (projectRef.current?.sections.length === 0) {
            setProject(originalProject);
            projectRef.current = originalProject;
          }
          setPhase("references");
          setStatus(result.status);
          return;
        }

        const nextProject = { ...result.project, swatches: result.project.swatches || context.references };
        setBuildProjectId(result.projectId || context.projectId);
        setProject(nextProject);
        projectRef.current = nextProject;
        setPaintQueue([]);
        setPhase("done");
        setStatus(result.status);
      } finally {
        if (buildAbortRef.current === controller) buildAbortRef.current = null;
        setApplying(false);
      }
    },
    [brief, ensureContext, recordBuildEvent, submissions, workspaceNotes],
  );

  const addReferenceLink = useCallback(() => {
    const value = referenceDraft.trim();
    const note = referenceNoteDraft.trim();
    if (!value && !note) {
      setStatus("Paste a link or describe the reference first.");
      return;
    }

    let url = "";
    if (value) {
      try {
        const withProtocol = /^https?:\/\//i.test(value) ? value : `https://${value}`;
        url = new URL(withProtocol).href;
      } catch {
        url = "";
      }
    }

    const title = url.includes("figma.com") ? "Figma reference" : url ? "Link reference" : "Style note";
    applyOneOperation({
      type: "add_swatch",
      swatch: {
        id: `ref-${Date.now()}`,
        title,
        note: note || value,
        url,
        tone: url.includes("figma.com") ? "glass" : "paper",
      },
    });
    setReferenceDraft("");
    setReferenceNoteDraft("");
    setStatus(url ? "Pinned that reference link to the canvas." : "Pinned that style note to the canvas.");
  }, [applyOneOperation, referenceDraft, referenceNoteDraft]);

  const applyDirection = useCallback(
    async (raw: string) => {
      if (applying) return;
      const command = raw.trim();
      const baseProject = projectRef.current!;
      const contextProject = withWorkspaceContext(projectForBuildContext(baseProject, paintQueue), workspaceNotes, submissions);
      if (!command && baseProject.sections.length === 0) {
        setStatus("No brushstroke given.");
        return;
      }

      if (selectedSection?.kind === "hero" && isInlineFormStroke(command)) {
        setCapsuleOpen(false);
        setListening(false);
        applyOneOperation({ type: "add_waitlist", id: selectedSection.id });
        setSelectedId(selectedSection.id);
        setStatus("Painted a form into the selected hero.");
        return;
      }

      setApplying(true);
      setStatus(
        includedNoteCount > 0
          ? `Mixing the brushstroke with ${includedNoteCount} pinned notes.`
          : "Mixing the brushstroke into the workspace.",
      );

      try {
        if (baseProject.sections.length === 0) {
          const seedBrief: PaletteBrief = {
            ...brief,
            product: brief.product || command,
            rawAnswers: [...(brief.rawAnswers || []), command].slice(0, 12),
          };
          const result = await requestInterviewNext({
            initialPrompt: command,
            brief: seedBrief,
            references: contextProject.swatches,
            notes: currentBuildNotes(),
            history: interviewHistory,
          });
          setBrief(result.brief || seedBrief);
          setInterviewQuestion(result);
          setInterviewAnswer("");
          setCapsuleOpen(false);
          setPhase(result.complete ? "references" : "interview");
          setStatus(result.status || "Palette is shaping the first brief.");
          return;
        }

        const context = await ensureContext(brief.product ? brief : { ...brief, product: contextProject.name });
        setCapsuleOpen(false);
        setListening(false);
        setPhase("repainting");
        setCodexEvents([{ type: "phase", label: "Preparing a focused edit", detail: "Palette is sending the selected area to the build runner." }]);
        const result = await requestWorkspacePatch(
          {
            projectId: context.projectId,
            command,
            selectedId,
            selectedSection,
            brief: context.brief,
            references: context.references,
            notes: context.notes,
            project: contextProject,
          },
          recordBuildEvent,
        );
        await wait(repaintDelayMs);
        if (!result.applied || result.project.sections.length === 0) {
          setPhase("done");
          setStatus(result.status);
          return;
        }
        setBuildProjectId(result.projectId || context.projectId);
        setProject(result.project);
        projectRef.current = result.project;
        setSelectedId(selectedId && result.project.sections.some((section) => section.id === selectedId) ? selectedId : null);
        setPhase("done");
        setStatus(result.status);
      } finally {
        setApplying(false);
      }
    },
    [
      applying,
      brief,
      currentBuildNotes,
      ensureContext,
      includedNoteCount,
      interviewHistory,
      paintQueue,
      recordBuildEvent,
      selectedId,
      selectedSection,
      submissions,
      workspaceNotes,
    ],
  );

  const answerInterview = useCallback(async () => {
    if (applying || !interviewQuestion) return;
    const answer = interviewAnswer.trim();
    if (!answer) {
      setStatus("Answer the studio question before moving on.");
      return;
    }

    setApplying(true);
    setStatus("Adding that answer to the design brief.");
    const nextHistory = [
      ...interviewHistory,
      { field: interviewQuestion.field, question: interviewQuestion.question, answer },
    ];

    try {
      const result = await requestInterviewNext({
        answer,
        question: interviewQuestion.question,
        lastQuestionKey: interviewQuestion.field,
        brief,
        references: projectRef.current?.swatches || [],
        notes: currentBuildNotes(),
        history: nextHistory,
      });
      setInterviewHistory(nextHistory);
      setBrief(result.brief || brief);
      setInterviewQuestion(result);
      setInterviewAnswer("");
      if (result.complete) {
        await ensureContext(result.brief || brief);
        setPhase("references");
        setStatus("Brief ready. Add references or begin painting.");
      } else {
        setStatus(result.status || "Palette has the next studio question.");
      }
    } finally {
      setApplying(false);
    }
  }, [
    applying,
    brief,
    currentBuildNotes,
    ensureContext,
    interviewAnswer,
    interviewHistory,
    interviewQuestion,
  ]);

  const moveToReferences = useCallback(async () => {
    setApplying(true);
    try {
      await ensureContext(brief.product ? brief : { ...brief, product: "New Palette canvas" });
      setPhase("references");
      setStatus("Add references, paste screenshots, or begin painting.");
    } finally {
      setApplying(false);
    }
  }, [brief, ensureContext]);

  const polishSelected = useCallback(async () => {
    if (!selectedSection) {
      setStatus("Select a section before asking Palette to finish it.");
      return;
    }

    setApplying(true);
    setPhase("repainting");
    setCodexEvents([{ type: "phase", label: "Loading finishing pass", detail: "Palette is reading the polish skill." }]);

    try {
      const context = await ensureContext(brief.product ? brief : { ...brief, product: projectRef.current?.name || "Palette canvas" });
      const result = await requestWorkspacePolish(
        {
          projectId: context.projectId,
          command: "Make this selected section feel finished.",
          selectedId,
          selectedSection,
          brief: context.brief,
          references: context.references,
          notes: context.notes,
          project: withWorkspaceContext(projectRef.current!, workspaceNotes, submissions),
        },
        recordBuildEvent,
      );
      if (!result.applied || result.project.sections.length === 0) {
        setPhase("done");
        setStatus(result.status);
        return;
      }
      setBuildProjectId(result.projectId || context.projectId);
      setProject(result.project);
      projectRef.current = result.project;
      setPhase("done");
      setStatus(result.status);
    } finally {
      setApplying(false);
    }
  }, [brief, ensureContext, recordBuildEvent, selectedId, selectedSection, submissions, workspaceNotes]);

  const interruptPainting = useCallback(() => {
    if (phase !== "painting" && phase !== "building") return;
    buildAbortRef.current?.abort();
    buildAbortRef.current = null;
    setPhase("paused");
    setCapsuleOpen(true);
    setDraft("");
    setApplying(false);
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

  const handleSectionAction = useCallback(
    (section: PaletteSectionModel, action: { label: string }) => {
      const label = action.label.toLowerCase();
      if (label.includes("set")) {
        setPaint();
        return;
      }

      if (section.kind === "hero" && isHeroFormAction(label)) {
        applyOneOperation({ type: "add_waitlist", id: section.id });
        setSelectedId(section.id);
        return;
      }

      setStatus(`Selected the ${section.kind} wash for the next stroke.`);
      setSelectedId(section.id);
    },
    [applyOneOperation, setPaint],
  );

  const applyToRepo = useCallback(async () => {
    if (project.sections.length === 0) {
      setStatus("Paint needs at least one section before Codex can apply it.");
      return;
    }

    setRepoApplying(true);
    setCodexEvents([{ type: "phase", label: "Preparing Codex handoff", detail: "The canvas is being packed." }]);
    setStatus("Handing the canvas to Codex for repo edits.");
    const result = await requestCodexApply(withWorkspaceContext(project, workspaceNotes, submissions), (event) => {
      setCodexEvents((current) => (event.type === "output" ? current : [...current, event].slice(-10)));
      if (event.label) {
        setStatus(event.type === "output" ? event.label : event.detail ? `${event.label}. ${event.detail}` : event.label);
      }
    });
    setRepoApplying(false);
    setStatus(result.status);
  }, [project, submissions, workspaceNotes]);

  const saveToFolder = useCallback(async () => {
    if (project.sections.length === 0) {
      setStatus("Paint needs at least one section before it can be saved.");
      return;
    }

    setSavingProject(true);
    setStatus("Saving the canvas as a Codex-readable folder.");
    const result = await requestProjectSave(withWorkspaceContext(project, workspaceNotes, submissions));
    setSavingProject(false);
    setStatus(result.folder ? `${result.status} ${result.folder}` : result.status);
  }, [project, submissions, workspaceNotes]);

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

  const recordSubmission = useCallback(
    (section: PaletteSectionModel, values: Record<string, FormDataEntryValue>) => {
      const submission = createSubmission(projectRef.current ?? project, section, values);
      setSubmissions((current) => [submission, ...current].slice(0, 40));
      setStatus(
        submission.kind === "waitlist"
          ? "Pinned the waitlist signup to submissions."
          : "Pinned the contact note to submissions.",
      );
    },
    [project],
  );

  const addFiles = useCallback(
    async (files: FileList | File[]) => {
      const imageFiles = Array.from(files).filter((file) => file.type.startsWith("image/"));
      if (imageFiles.length === 0) return;

      for (const file of imageFiles) {
        const swatch: PaletteSwatch = await fileToPersistentSwatch(file);
        applyOneOperation({ type: "add_swatch", swatch });

        extractColors(swatch.url ?? "").then((colors) => {
          if (colors.length === 0) return;
          const note = `Mixed ${colors.slice(0, 2).join(" and ")} from this reference.`;
          setProject((current) => {
            const next = {
              ...current,
              swatchAccent: current.swatches[0]?.id === swatch.id ? colors[0] : current.swatchAccent,
              swatchColors: current.swatches[0]?.id === swatch.id ? colors : current.swatchColors,
              swatches: current.swatches.map((item) =>
                item.id === swatch.id ? { ...item, note, colors } : item,
              ),
            };
            projectRef.current = next;
            return next;
          });
        });
      }
      setStatus(`${imageFiles.length} reference${imageFiles.length === 1 ? "" : "s"} pinned to the canvas.`);
    },
    [applyOneOperation],
  );

  useEffect(() => {
    if (phase !== "painting") return;
    if (paintQueue.length === 0) return;

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
        } else if (phase === "building" || phase === "painting") {
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

  useEffect(() => {
    let cancelled = false;
    void requestWorkspaceLoad().then((workspace) => {
      if (!workspace || cancelled) return;
      setProject(workspace.project);
      projectRef.current = workspace.project;
      setWorkspaceNotes(workspace.notes);
      setSubmissions(workspace.submissions);
      setSavedProjects(workspace.savedProjects);
      setSelectedId(workspace.selectedId);
      setBuildProjectId(workspace.buildProjectId);
      setBrief(workspace.brief);
      setPhase(workspace.project.sections.length > 0 ? "done" : "idle");
      setStatus("Restored the latest canvas from the workspace store.");
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void requestBuildEngineStatus()
      .then((result) => {
        if (!cancelled) setEngineStatus(result);
      })
      .catch((error) => {
        if (!cancelled) {
          setEngineStatus({
            ok: false,
            selectedProvider: "codex",
            configuredProvider: "unknown",
            label: "Painter offline",
            ready: false,
            model: "",
            detail: error instanceof Error ? error.message : "Start the Palette backend to check the live painting engine.",
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    persistWorkspaceState(
      createWorkspaceState({
        project,
        selectedId,
        buildProjectId,
        brief,
        notes: workspaceNotes,
        submissions,
        savedProjects,
      }),
    );
  }, [brief, buildProjectId, project, savedProjects, selectedId, submissions, workspaceNotes]);

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
          notes={workspaceNotes}
          noteDraft={noteDraft}
          submissions={submissions}
          savedProjects={savedProjects}
          selectedSection={selectedSection}
          onFiles={addFiles}
          onPickFiles={() => fileInputRef.current?.click()}
          onNoteDraft={setNoteDraft}
          onAddNote={() => addPinnedNote(noteDraft)}
          onToggleNoteContext={toggleNoteContext}
          onRemoveNote={removePinnedNote}
          onSaveProject={saveCurrentProject}
          onLoadProject={loadSavedProject}
          onNewCanvas={startNewCanvas}
          onExportSubmissions={exportSubmissions}
          onDownloadHandoff={downloadHandoffBundle}
          onDownloadWorkspace={downloadWorkspaceBundle}
          canDownloadWorkspace={Boolean(buildProjectId)}
          onUndo={undo}
          onRedo={redo}
          onSetPaint={setPaint}
          onSaveFolder={saveToFolder}
          onApplyToRepo={applyToRepo}
          onPolish={polishSelected}
          savingProject={savingProject}
          repoApplying={repoApplying}
          engineStatus={engineStatus}
          codexEvents={codexEvents}
        />

        <section className="canvas-zone" aria-label="Palette canvas">
          <p className="sr-status" aria-live="polite">{status}</p>

          <div
            className={`canvas-board ${phase === "painting" || phase === "building" || phase === "repainting" ? "is-painting" : ""} ${
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
                  <h2>{interviewQuestion?.question || "What are we making?"}</h2>
                  {interviewQuestion?.helper ? <p>{interviewQuestion.helper}</p> : null}
                  <textarea
                    value={interviewAnswer}
                    onChange={(event) => setInterviewAnswer(event.target.value)}
                    placeholder="Answer like you are talking to a collaborator"
                    aria-label="Design interview answer"
                  />
                  <div className="interview-options">
                    <button type="button" onClick={answerInterview} disabled={applying || !interviewAnswer.trim()}>
                      Answer
                    </button>
                    <button type="button" onClick={moveToReferences} disabled={applying}>
                      Add references
                    </button>
                  </div>
                </motion.div>
              ) : null}

              {phase === "references" ? (
                <motion.div
                  className="interview-card reference-board-card"
                  key="references"
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -12 }}
                  transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
                >
                  <span>Gather references</span>
                  <h2>Pin the images, links, or notes Palette should study.</h2>
                  <p>Paste screenshots anywhere, drop images here, or add a website or Figma link.</p>
                  <div className="reference-inputs">
                    <input
                      value={referenceDraft}
                      onChange={(event) => setReferenceDraft(event.target.value)}
                      placeholder="Paste a website or Figma link"
                      aria-label="Reference link"
                    />
                    <textarea
                      value={referenceNoteDraft}
                      onChange={(event) => setReferenceNoteDraft(event.target.value)}
                      placeholder="What should Palette notice about it?"
                      aria-label="Reference note"
                    />
                  </div>
                  <div className="interview-options">
                    <button type="button" onClick={addReferenceLink}>
                      Pin reference
                    </button>
                    <button type="button" onClick={() => void beginWorkspaceBuild(brief)} disabled={applying}>
                      Begin painting
                    </button>
                  </div>
                </motion.div>
              ) : null}

              {phase === "building" ? (
                <motion.div
                  className="interview-card reference-board-card"
                  key="building"
                  initial={{ opacity: 0, scale: 0.98 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.98 }}
                  transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
                >
                  <span>Painting with Codex</span>
                  <h2>The first real workspace is being written.</h2>
                  <p>{status}</p>
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
                onAction={handleSectionAction}
                onSubmitForm={recordSubmission}
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
  notes,
  noteDraft,
  submissions,
  savedProjects,
  selectedSection,
  onFiles,
  onPickFiles,
  onNoteDraft,
  onAddNote,
  onToggleNoteContext,
  onRemoveNote,
  onSaveProject,
  onLoadProject,
  onNewCanvas,
  onExportSubmissions,
  onDownloadHandoff,
  onDownloadWorkspace,
  canDownloadWorkspace,
  onUndo,
  onRedo,
  onSetPaint,
  onSaveFolder,
  onApplyToRepo,
  onPolish,
  savingProject,
  repoApplying,
  engineStatus,
  codexEvents,
}: {
  project: PaletteProject;
  notes: PalettePinnedNote[];
  noteDraft: string;
  submissions: PaletteSubmission[];
  savedProjects: SavedPaletteProject[];
  selectedSection?: PaletteSectionModel;
  onFiles: (files: FileList | File[]) => void;
  onPickFiles: () => void;
  onNoteDraft: (value: string) => void;
  onAddNote: () => void;
  onToggleNoteContext: (id: string) => void;
  onRemoveNote: (id: string) => void;
  onSaveProject: () => void;
  onLoadProject: (project: SavedPaletteProject) => void;
  onNewCanvas: () => void;
  onExportSubmissions: () => void;
  onDownloadHandoff: () => void;
  onDownloadWorkspace: () => void;
  canDownloadWorkspace: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onSetPaint: () => void;
  onSaveFolder: () => void;
  onApplyToRepo: () => void;
  onPolish: () => void;
  savingProject: boolean;
  repoApplying: boolean;
  engineStatus: BuildEngineStatus | null;
  codexEvents: StudioProgressEvent[];
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
        <button type="button" onClick={onDownloadHandoff} disabled={project.sections.length === 0}>
          <FileArchive size={14} />
          Handoff
        </button>
        <button type="button" onClick={onDownloadWorkspace} disabled={!canDownloadWorkspace}>
          <FolderDown size={14} />
          Download files
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
      <BuildEngineCard status={engineStatus} />
      <WorkspacePanel
        project={project}
        notes={notes}
        noteDraft={noteDraft}
        submissions={submissions}
        savedProjects={savedProjects}
        selectedSection={selectedSection}
        onNoteDraft={onNoteDraft}
        onAddNote={onAddNote}
        onToggleNoteContext={onToggleNoteContext}
        onRemoveNote={onRemoveNote}
        onSaveProject={onSaveProject}
        onLoadProject={onLoadProject}
        onNewCanvas={onNewCanvas}
        onExportSubmissions={onExportSubmissions}
        onPolish={onPolish}
      />
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
        {project.swatches.map((swatch, index) => (
          <article className={`swatch-card tone-${swatch.tone ?? "paper"}`} key={swatch.id || `${swatch.title}-${index}`}>
            <div
              className="swatch-image"
              style={
                swatch.colors?.length
                  ? { background: `linear-gradient(135deg, ${swatch.colors.join(", ")})` }
                  : undefined
              }
            >
              {isImageReferenceUrl(swatch.url) ? <img src={swatch.url} alt="" /> : <span />}
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

function BuildEngineCard({ status }: { status: BuildEngineStatus | null }) {
  const label = status?.label || "Checking painter";
  const detail = status?.detail || "Palette is checking which live engine will paint the next workspace.";
  const model = status?.model;

  return (
    <section className={`engine-card ${status?.ready ? "is-ready" : "needs-setup"}`} aria-label="Live painting engine">
      <div>
        <span>Live painter</span>
        <strong>{label}</strong>
      </div>
      <p>{detail}</p>
      {model ? <small>{model}</small> : null}
    </section>
  );
}

function WorkspacePanel({
  project,
  notes,
  noteDraft,
  submissions,
  savedProjects,
  selectedSection,
  onNoteDraft,
  onAddNote,
  onToggleNoteContext,
  onRemoveNote,
  onSaveProject,
  onLoadProject,
  onNewCanvas,
  onExportSubmissions,
  onPolish,
}: {
  project: PaletteProject;
  notes: PalettePinnedNote[];
  noteDraft: string;
  submissions: PaletteSubmission[];
  savedProjects: SavedPaletteProject[];
  selectedSection?: PaletteSectionModel;
  onNoteDraft: (value: string) => void;
  onAddNote: () => void;
  onToggleNoteContext: (id: string) => void;
  onRemoveNote: (id: string) => void;
  onSaveProject: () => void;
  onLoadProject: (project: SavedPaletteProject) => void;
  onNewCanvas: () => void;
  onExportSubmissions: () => void;
  onPolish: () => void;
}) {
  const includedCount = notes.filter((note) => note.includeInContext).length;

  return (
    <section className="workspace-panel" aria-label="Workspace">
      <div className="workspace-block">
        <div className="workspace-heading">
          <span>Studio shelf</span>
          <small>{project.name}</small>
        </div>
        <div className="workspace-actions">
          <button type="button" onClick={onSaveProject}>
            <Save size={14} />
            Save project
          </button>
          <button type="button" onClick={onNewCanvas}>
            <Plus size={14} />
            New canvas
          </button>
        </div>
        {savedProjects.length > 0 ? (
          <div className="project-shelf">
            {savedProjects.slice(0, 4).map((saved) => (
              <button type="button" key={saved.id} onClick={() => onLoadProject(saved)}>
                <strong>{saved.name}</strong>
                <span>{saved.project.sections.length} sections</span>
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <div className="workspace-block">
        <div className="workspace-heading">
          <span>Pinned notes</span>
          <small>{includedCount} in context</small>
        </div>
        <div className="note-composer">
          <textarea
            value={noteDraft}
            onChange={(event) => onNoteDraft(event.target.value)}
            placeholder="Pin a note for the next stroke"
            aria-label="Pinned note"
          />
          <button type="button" onClick={onAddNote} disabled={!noteDraft.trim()}>
            <Pin size={14} />
            Pin note
          </button>
          <button type="button" onClick={onPolish} disabled={!selectedSection}>
            <Scissors size={14} />
            Make this feel finished
          </button>
        </div>
        <div className="note-list">
          {notes.slice(0, 5).map((note) => (
            <article key={note.id}>
              <p>{note.text}</p>
              <div>
                <button
                  type="button"
                  aria-pressed={note.includeInContext}
                  onClick={() => onToggleNoteContext(note.id)}
                >
                  {note.includeInContext ? <Pin size={13} /> : <PinOff size={13} />}
                  {note.includeInContext ? "Context" : "Held"}
                </button>
                <button type="button" onClick={() => onRemoveNote(note.id)} aria-label="Remove pinned note">
                  <Trash2 size={13} />
                </button>
              </div>
            </article>
          ))}
        </div>
      </div>

      <div className="workspace-block">
        <div className="workspace-heading">
          <span>Submissions</span>
          <small>{submissions.length}</small>
        </div>
        <div className="submission-list">
          {submissions.slice(0, 4).map((submission) => (
            <article key={submission.id}>
              <strong>{submission.kind}</strong>
              <p>{submission.values.email || submission.values.name || submission.sectionTitle}</p>
            </article>
          ))}
        </div>
        <button
          className="export-submissions"
          type="button"
          onClick={onExportSubmissions}
          disabled={submissions.length === 0}
        >
          <Download size={14} />
          Export submissions
        </button>
      </div>
    </section>
  );
}

function CodexProgress({ events, active }: { events: StudioProgressEvent[]; active: boolean }) {
  if (events.length === 0) return null;

  return (
    <section className={`codex-progress ${active ? "is-active" : ""}`} aria-label="Codex progress">
      <h2>Build progress</h2>
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
  onAction,
  onSubmitForm,
}: {
  sections: PaletteSectionModel[];
  theme: string;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onMove: (id: string, direction: -1 | 1) => void;
  onRemove: (id: string) => void;
  onNote: (section: PaletteSectionModel) => void;
  onSetPaint: () => void;
  onAction: (section: PaletteSectionModel, action: { label: string }) => void;
  onSubmitForm: (section: PaletteSectionModel, values: Record<string, FormDataEntryValue>) => void;
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
                  else onAction(_section, action);
                },
                onSubmitForm,
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
            {phase === "building" || phase === "painting" ? (
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
  downloadText(text, "palette-project.json", "application/json");
}

function downloadText(text: string, filename: string, type: string) {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
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

function projectForBuildContext(project: PaletteProject, queuedSections: PaletteSectionModel[]) {
  if (queuedSections.length === 0) return project;
  const seen = new Set(project.sections.map((section) => section.id));
  const remaining = queuedSections.filter((section) => !seen.has(section.id));
  return remaining.length > 0
    ? { ...project, sections: [...project.sections, ...remaining] }
    : project;
}

function isImageReferenceUrl(url?: string) {
  if (!url) return false;
  return url.startsWith("data:image/") || /\.(png|jpe?g|webp|gif|avif)(\?|#|$)/i.test(url);
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
