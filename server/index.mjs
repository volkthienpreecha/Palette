import http from "node:http";
import { resolveIntent } from "./paletteIntent.mjs";
import { applyProjectWithCodex } from "./codexApply.mjs";

const port = Number(process.env.PORT || 8787);

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === "OPTIONS") {
      sendJson(req, res, 204, null);
      return;
    }

    if (req.method === "POST" && req.url === "/api/intent") {
      const payload = await readJson(req);
      const result = await resolveIntent(payload);
      sendJson(req, res, 200, result);
      return;
    }

    if (req.method === "POST" && req.url === "/api/codex/apply") {
      const payload = await readJson(req);
      const result = await applyProjectWithCodex(payload);
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

server.listen(port, () => {
  console.log(`Palette intent bridge listening on http://localhost:${port}`);
});

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = "";

    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
        reject(withStatus(new Error("Request body too large."), 413));
        req.destroy();
      }
    });

    req.on("end", () => {
      if (!body) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(body));
      } catch {
        reject(withStatus(new Error("Invalid JSON body."), 400));
      }
    });

    req.on("error", reject);
  });
}

function sendJson(req, res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader("Access-Control-Allow-Origin", allowedOrigin(req));
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

function allowedOrigin(req) {
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

function withStatus(error, statusCode) {
  error.statusCode = statusCode;
  return error;
}
