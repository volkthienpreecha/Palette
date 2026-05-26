export async function transcribeAudio({ audio, contentType }, env = process.env) {
  if (!env.GROQ_API_KEY) {
    return {
      source: "local",
      status: "Set GROQ_API_KEY before using voice transcription.",
      text: "",
    };
  }

  if (!audio || audio.byteLength < 1200) {
    return {
      source: "local",
      status: "Voice stroke was too short to transcribe.",
      text: "",
    };
  }

  const formData = new FormData();
  formData.append(
    "file",
    new Blob([audio], { type: contentType || "audio/webm" }),
    fileNameFor(contentType),
  );
  formData.append("model", env.GROQ_TRANSCRIBE_MODEL || "whisper-large-v3-turbo");
  formData.append("response_format", "json");

  const response = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.GROQ_API_KEY}`,
    },
    body: formData,
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = payload?.error?.message || payload?.message || `Groq returned ${response.status}`;
    return {
      source: "local",
      status: `Voice transcription unavailable. ${message}`,
      text: "",
    };
  }

  const text = typeof payload.text === "string" ? payload.text.trim() : "";
  if (!text) {
    return {
      source: "local",
      status: "Voice transcription returned no words.",
      text: "",
    };
  }

  return {
    source: "groq",
    status: "Voice stroke transcribed.",
    text,
  };
}

function fileNameFor(contentType = "") {
  if (contentType.includes("mp4")) return "palette-voice.mp4";
  if (contentType.includes("mpeg")) return "palette-voice.mp3";
  if (contentType.includes("wav")) return "palette-voice.wav";
  if (contentType.includes("ogg")) return "palette-voice.ogg";
  return "palette-voice.webm";
}

function httpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}
