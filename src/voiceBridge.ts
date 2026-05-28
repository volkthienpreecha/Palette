export type VoiceTranscriptionResult = {
  source: "groq" | "local";
  status: string;
  text: string;
};

export async function requestVoiceTranscription(audio: Blob): Promise<VoiceTranscriptionResult> {
  if (!shouldUseVoiceBridge()) {
    return {
      source: "local",
      status: "Voice is disabled for local-only mode.",
      text: "",
    };
  }

  try {
    const response = await fetch("/api/voice/transcribe", {
      method: "POST",
      headers: {
        "Content-Type": audio.type || "audio/webm",
      },
      body: audio,
    });

    const payload = await readJson(response);
    if (!response.ok) {
      throw new Error(payload.error || `Voice transcription returned ${response.status}`);
    }

    if (typeof payload.text === "string" && typeof payload.status === "string") {
      return {
        source: payload.source === "groq" ? "groq" : "local",
        status: payload.status,
        text: payload.text,
      };
    }

    throw new Error("Voice transcription returned an invalid payload.");
  } catch (error) {
    return {
      source: "local",
      status: friendlyError(error, "Voice bridge offline. Start npm run api before using voice."),
      text: "",
    };
  }
}

async function readJson(response: Response) {
  try {
    return (await response.json()) as Partial<VoiceTranscriptionResult> & { error?: string };
  } catch {
    throw new Error("Palette backend returned no voice response.");
  }
}

function friendlyError(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : "";
  if (
    !message ||
    message.includes("Failed to fetch") ||
    message.includes("Unexpected end of JSON") ||
    message.includes("returned no voice response")
  ) {
    return fallback;
  }
  return message;
}

function shouldUseVoiceBridge() {
  if (import.meta.env.VITE_PALETTE_VOICE_API === "0") return false;

  try {
    return window.localStorage.getItem("palette:voice-api") !== "0";
  } catch {
    return true;
  }
}
