import http from "node:http";
import { resolveIntent } from "./paletteIntent.mjs";
import { applyProjectWithCodex, applyProjectWithCodexStream } from "./codexApply.mjs";
import { saveProjectFolder } from "./projectStore.mjs";
import { transcribeAudio } from "./groqVoice.mjs";
import { loadEnvFile } from "./env.mjs";

loadEnvFile();
const port = Number(process.env.PORT || 8787);
const host = process.env.HOST || "127.0.0.1";

const server = http.createServer(async (req, res) => {
  try {
    if (!isAllowedOrigin(req)) {
      sendJson(req, res, 403, { error: "Origin not allowed." });
      return;
    }

    if (req.method === "OPTIONS") {
      sendJson(req, res, 204, null);
      return;
    }

    if (req.method === "POST" && req.url === "/api/intent") {
      requireJson(req);
      const payload = await readJson(req);
      const result = await resolveIntent(payload);
      sendJson(req, res, 200, result);
      return;
    }

    if (req.method === "POST" && req.url === "/api/codex/apply") {
      requireJson(req);
      const payload = await readJson(req);
      const result = await applyProjectWithCodex(payload);
      sendJson(req, res, 200, result);
      return;
    }

    if (req.method === "POST" && req.url === "/api/codex/apply-stream") {
      requireJson(req);
      const payload = await readJson(req);
      await sendCodexApplyStream(req, res, payload);
      return;
    }

    if (req.method === "POST" && req.url === "/api/projects/save") {
      requireJson(req);
      const payload = await readJson(req);
      const result = await saveProjectFolder(payload);
      sendJson(req, res, 200, result);
      return;
    }

    if (req.method === "POST" && req.url === "/api/voice/transcribe") {
      requireAudio(req);
      const audio = await readBody(req, 8_000_000);
      const result = await transcribeAudio({
        audio,
        contentType: contentType(req),
      });
      sendJson(req, res, 200, result);
      return;
    }

    sendJson(req, res, 404, { error: "Not found" });
  } catch (error) {
    const statusCode = Number(error?.statusCode || 500);
    sendJson(req, res, statusCode, {
      error: error instanceof Error ? error.message : "Unexpected server error",
    });
  }
});

server.listen(port, host, () => {
  console.log(`Palette backend listening on http://${host}:${port}`);
});

function readJson(req) {
  return readBody(req, 1_000_000).then((body) => {
    if (body.length === 0) return {};

    try {
      return JSON.parse(body.toString("utf8"));
    } catch {
      throw withStatus(new Error("Invalid JSON body."), 400);
    }
  });
}

function readBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let length = 0;

    req.on("data", (chunk) => {
      length += chunk.length;
      if (length > maxBytes) {
        reject(withStatus(new Error("Request body too large."), 413));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on("end", () => {
      resolve(Buffer.concat(chunks));
    });

    req.on("error", reject);
  });
}

function sendJson(req, res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader("Access-Control-Allow-Origin", corsOrigin(req));
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Vary", "Origin");

  if (statusCode === 204) {
    res.end();
    return;
  }

  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(payload));
}

async function sendCodexApplyStream(req, res, payload) {
  res.statusCode = 200;
  res.setHeader("Access-Control-Allow-Origin", corsOrigin(req));
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Vary", "Origin");
  res.setHeader("Content-Type", "application/x-ndjson");
  res.setHeader("Cache-Control", "no-store");

  const write = (event) => {
    res.write(`${JSON.stringify(event)}\n`);
  };

  try {
    const result = await applyProjectWithCodexStream(payload, write);
    write({ type: "result", label: result.status, result });
  } catch (error) {
    write({
      type: "error",
      label: "Codex apply failed",
      detail: error instanceof Error ? error.message : "Unexpected Codex apply error.",
    });
  } finally {
    res.end();
  }
}

function allowedOrigins() {
  return new Set(
    [
      process.env.PALETTE_ORIGIN,
      "http://localhost:5173",
      "http://127.0.0.1:5173",
    ].filter(Boolean),
  );
}

function isAllowedOrigin(req) {
  const origin = req.headers.origin;
  return !origin || allowedOrigins().has(origin);
}

function corsOrigin(req) {
  const allowed = new Set(
    [
      process.env.PALETTE_ORIGIN,
      "http://localhost:5173",
      "http://127.0.0.1:5173",
    ].filter(Boolean),
  );
  const origin = req.headers.origin;
  return origin && allowed.has(origin) ? origin : "http://127.0.0.1:5173";
}

function contentType(req) {
  const value = req.headers["content-type"];
  return Array.isArray(value) ? value[0] : value || "";
}

function requireJson(req) {
  if (!contentType(req).toLowerCase().startsWith("application/json")) {
    throw withStatus(new Error("Expected application/json."), 415);
  }
}

function requireAudio(req) {
  if (!contentType(req).toLowerCase().startsWith("audio/")) {
    throw withStatus(new Error("Expected an audio content type."), 415);
  }
}

function withStatus(error, statusCode) {
  error.statusCode = statusCode;
  return error;
}
