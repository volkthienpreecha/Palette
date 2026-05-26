import { parseIntent, type IntentResult, type PaletteProject } from "./paletteModel";

export type IntentSource = "openai" | "local" | "fallback";

export type IntentBridgeResult = IntentResult & {
  source: IntentSource;
};

export async function requestIntent(
  command: string,
  context: { selectedId: string | null; project: PaletteProject },
): Promise<IntentBridgeResult> {
  if (!shouldUseRemoteIntent()) {
    return { ...parseIntent(command, context), source: "local" };
  }

  try {
    const response = await fetch("/api/intent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ command, selectedId: context.selectedId, project: context.project }),
    });

    if (!response.ok) {
      throw new Error(`Intent bridge returned ${response.status}`);
    }

    const result = (await response.json()) as IntentBridgeResult;
    if (Array.isArray(result.operations) && typeof result.status === "string" && result.source) {
      return result;
    }

    throw new Error("Intent bridge returned an invalid payload.");
  } catch {
    return { ...parseIntent(command, context), source: "local" };
  }
}

function shouldUseRemoteIntent() {
  if (import.meta.env.VITE_PALETTE_INTENT_API === "1") return true;

  try {
    return window.localStorage.getItem("palette:intent-api") === "1";
  } catch {
    return false;
  }
}
