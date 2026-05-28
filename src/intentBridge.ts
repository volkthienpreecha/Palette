import { parseIntent, type IntentResult, type PaletteProject } from "./paletteModel";

export type IntentSource = "provider" | "openai" | "local" | "fallback";

export type IntentBridgeResult = IntentResult & {
  source: IntentSource;
  provider?: string;
  detail?: string;
};

export async function requestIntent(
  command: string,
  context: { selectedId: string | null; project: PaletteProject },
): Promise<IntentBridgeResult> {
  if (!shouldUseRemoteIntent()) {
    return { ...parseIntent(command, context), source: "local" };
  }

  try {
    const response = await fetchPlanner(createPlannerPayload(command, context));

    if (!response.ok) {
      throw new Error(`Planner bridge returned ${response.status}`);
    }

    const result = (await response.json()) as IntentBridgeResult;
    if (Array.isArray(result.operations) && typeof result.status === "string" && result.source) {
      return result;
    }

    throw new Error("Planner bridge returned an invalid payload.");
  } catch {
    return { ...parseIntent(command, context), source: "local", provider: "local" };
  }
}

function createPlannerPayload(
  command: string,
  context: { selectedId: string | null; project: PaletteProject },
) {
  const selectedSection = context.selectedId
    ? context.project.sections.find((section) => section.id === context.selectedId)
    : undefined;
  const notes = context.project.sections
    .filter((section) => section.kind === "note")
    .map((section) => ({
      id: section.id,
      title: section.title,
      note: section.subtitle,
      pinnedTo: section.eyebrow,
    }));

  return {
    command,
    selectedId: context.selectedId,
    selectedSection,
    notes,
    references: context.project.swatches,
    project: context.project,
  };
}

async function fetchPlanner(payload: unknown) {
  const response = await fetch("/api/planner", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (response.status !== 404) return response;

  return fetch("/api/intent", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

function shouldUseRemoteIntent() {
  if (import.meta.env.VITE_PALETTE_PLANNER_API === "1") return true;
  if (import.meta.env.VITE_PALETTE_INTENT_API === "1") return true;

  try {
    return (
      window.localStorage.getItem("palette:planner-api") === "1" ||
      window.localStorage.getItem("palette:intent-api") === "1"
    );
  } catch {
    return false;
  }
}
