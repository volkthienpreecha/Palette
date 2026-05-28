import http from "node:http";
import { resolveIntent, resolvePlanner } from "./paletteIntent.mjs";
import { applyProjectWithCodex, applyProjectWithCodexStream } from "./codexApply.mjs";
import { createHandoffBundleFile } from "./handoffBundle.mjs";
import { saveProjectFolder } from "./projectStore.mjs";
import { transcribeAudio } from "./groqVoice.mjs";
import { loadEnvFile } from "./env.mjs";
import { loadWorkspaceState, saveWorkspaceState } from "./workspaceState.mjs";
import { skillStatus } from "./skillRegistry.mjs";
import { nextInterviewQuestion } from "./designInterview.mjs";
import { saveDesignContext } from "./designWorkspace.mjs";
import { buildEngineStatus, patchWorkspaceBuild, polishWorkspaceBuild, startWorkspaceBuild } from "./workspaceBuild.mjs";
import { createWorkspaceBundle } from "./workspaceBundle.mjs";
import {
  addProjectAsset,
  addProjectNote,
  addProjectSubmission,
  assetInputFromJson,
  createProjectRecord,
  getAssetFile,
  handoffArtifact,
  listProjectAssets,
  listProjectComponents,
  listProjectNotes,
  listProjectSubmissions,
  listProjectSummaries,
  loadProjectRecord,
  submissionsCsv,
  updateProjectRecord,
  upsertProjectComponent,
} from "./persistentStore.mjs";

loadEnvFile();
const port = Number(process.env.PORT || 8787);
const host = process.env.HOST || "127.0.0.1";

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", "http://127.0.0.1");

    if (!isAllowedOrigin(req)) {
      sendJson(req, res, 403, { error: "Origin not allowed." });
      return;
    }

    if (req.method === "OPTIONS") {
      sendJson(req, res, 204, null);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/planner") {
      requireJson(req);
      const payload = await readJson(req);
      const result = await resolvePlanner(payload);
      sendJson(req, res, 200, result);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/intent") {
      requireJson(req);
      const payload = await readJson(req);
      const result = await resolveIntent(payload);
      sendJson(req, res, 200, result);
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/skills/status") {
      const result = await skillStatus();
      sendJson(req, res, 200, result);
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/build/status") {
      const result = buildEngineStatus();
      sendJson(req, res, 200, result);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/interview/next") {
      requireJson(req);
      const payload = await readJson(req, 1_500_000);
      const result = await nextInterviewQuestion(payload);
      sendJson(req, res, 200, result);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/design/context") {
      requireJson(req);
      const payload = await readJson(req, 6_000_000);
      const result = await saveDesignContext(payload);
      sendJson(req, res, 200, result);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/build/start") {
      requireJson(req);
      const payload = await readJson(req, 8_000_000);
      const result = await startWorkspaceBuild(payload);
      sendJson(req, res, 200, result);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/build/start-stream") {
      requireJson(req);
      const payload = await readJson(req, 8_000_000);
      await sendWorkspaceBuildStream(req, res, payload, startWorkspaceBuild);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/build/patch") {
      requireJson(req);
      const payload = await readJson(req, 8_000_000);
      const result = await patchWorkspaceBuild(payload);
      sendJson(req, res, 200, result);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/build/patch-stream") {
      requireJson(req);
      const payload = await readJson(req, 8_000_000);
      await sendWorkspaceBuildStream(req, res, payload, patchWorkspaceBuild);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/design/polish") {
      requireJson(req);
      const payload = await readJson(req, 8_000_000);
      const result = await polishWorkspaceBuild(payload);
      sendJson(req, res, 200, result);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/design/polish-stream") {
      requireJson(req);
      const payload = await readJson(req, 8_000_000);
      await sendWorkspaceBuildStream(req, res, payload, polishWorkspaceBuild);
      return;
    }

    const workspaceBundleMatch = url.pathname.match(/^\/api\/workspaces\/([^/]+)\/bundle$/);
    if (req.method === "GET" && workspaceBundleMatch) {
      const result = await createWorkspaceBundle(decodeURIComponent(workspaceBundleMatch[1]));
      sendText(
        req,
        res,
        200,
        `${JSON.stringify(result, null, 2)}\n`,
        "application/json; charset=utf-8",
        `palette-workspace-${result.projectId}.json`,
      );
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/codex/apply") {
      requireJson(req);
      const payload = await readJson(req);
      const result = await applyProjectWithCodex(payload);
      sendJson(req, res, 200, result);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/codex/apply-stream") {
      requireJson(req);
      const payload = await readJson(req);
      await sendCodexApplyStream(req, res, payload);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/handoff/bundle") {
      requireJson(req);
      const payload = await readJson(req);
      const result = await createHandoffBundleFile(payload);
      sendJson(req, res, 200, result);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/projects/save") {
      requireJson(req);
      const payload = await readJson(req);
      const result = await saveProjectFolder(payload);
      sendJson(req, res, 200, result);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/voice/transcribe") {
      requireAudio(req);
      const audio = await readBody(req, 8_000_000);
      const result = await transcribeAudio({
        audio,
        contentType: contentType(req),
      });
      sendJson(req, res, 200, result);
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/workspace/state") {
      const result = await loadWorkspaceState(ownerToken(req, url));
      sendJson(req, res, 200, result);
      return;
    }

    if (req.method === "PUT" && url.pathname === "/api/workspace/state") {
      requireJson(req);
      const payload = await readJson(req, 14_000_000);
      const result = await saveWorkspaceState(payload, ownerToken(req, url));
      sendJson(req, res, 200, result);
      return;
    }

    if (await handlePersistentApi(req, res, url)) {
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

async function handlePersistentApi(req, res, url) {
  const segments = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);

  if (req.method === "POST" && url.pathname === "/api/projects") {
    requireJson(req);
    const payload = await readJson(req, 1_500_000);
    const result = await createProjectRecord(payload);
    sendJson(req, res, 201, result);
    return true;
  }

  if (req.method === "GET" && url.pathname === "/api/projects") {
    const result = await listProjectSummaries(ownerToken(req, url));
    sendJson(req, res, 200, result);
    return true;
  }

  if (segments[0] === "api" && segments[1] === "assets" && segments[2] && req.method === "GET") {
    const projectId = url.searchParams.get("projectId") || url.searchParams.get("project");
    const asset = await getAssetFile(projectId, segments[2]);
    sendBinary(req, res, 200, asset.buffer, asset.contentType, asset.fileName);
    return true;
  }

  if (segments[0] !== "api" || segments[1] !== "projects" || !segments[2]) {
    return false;
  }

  const projectId = segments[2];
  const token = ownerToken(req, url);
  const child = segments[3];
  const childId = segments[4];
  const grandchild = segments[5];

  if (!child && req.method === "GET") {
    const result = await loadProjectRecord(projectId, token);
    sendJson(req, res, 200, result);
    return true;
  }

  if (!child && (req.method === "PUT" || req.method === "PATCH")) {
    requireJson(req);
    const payload = await readJson(req, 1_500_000);
    const result = await updateProjectRecord(projectId, payload, token);
    sendJson(req, res, 200, result);
    return true;
  }

  if (child === "notes" && req.method === "GET") {
    const result = await listProjectNotes(projectId, token);
    sendJson(req, res, 200, result);
    return true;
  }

  if (child === "notes" && req.method === "POST") {
    requireJson(req);
    const payload = await readJson(req, 250_000);
    const result = await addProjectNote(projectId, payload, token);
    sendJson(req, res, 201, result);
    return true;
  }

  if (child === "assets" && !childId && req.method === "GET") {
    const result = await listProjectAssets(projectId, token);
    sendJson(req, res, 200, result);
    return true;
  }

  if (child === "assets" && childId && req.method === "GET") {
    const asset = await getAssetFile(projectId, childId);
    sendBinary(req, res, 200, asset.buffer, asset.contentType, asset.fileName);
    return true;
  }

  if (child === "assets" && !childId && req.method === "POST") {
    const input = await readAssetInput(req);
    const result = await addProjectAsset(projectId, input, token);
    sendJson(req, res, 201, result);
    return true;
  }

  if (child === "components" && !childId && req.method === "GET") {
    const result = await listProjectComponents(projectId, token);
    sendJson(req, res, 200, result);
    return true;
  }

  if (child === "components" && childId && grandchild === "submissions" && req.method === "POST") {
    requireJson(req);
    const payload = await readJson(req, 250_000);
    const result = await addProjectSubmission(projectId, { ...payload, componentId: childId, kind: "component" }, requestMeta(req));
    sendJson(req, res, 201, result);
    return true;
  }

  if (child === "components" && req.method === "POST") {
    requireJson(req);
    const payload = await readJson(req, 1_000_000);
    const result = await upsertProjectComponent(projectId, childId, payload, token);
    sendJson(req, res, childId ? 200 : 201, result);
    return true;
  }

  if (child === "components" && childId && (req.method === "PUT" || req.method === "PATCH")) {
    requireJson(req);
    const payload = await readJson(req, 1_000_000);
    const result = await upsertProjectComponent(projectId, childId, payload, token);
    sendJson(req, res, 200, result);
    return true;
  }

  if (child === "submissions" && !childId && req.method === "POST") {
    requireJson(req);
    const payload = await readJson(req, 250_000);
    const result = await addProjectSubmission(projectId, payload, requestMeta(req));
    sendJson(req, res, 201, result);
    return true;
  }

  if (child === "submissions" && !childId && req.method === "GET") {
    const result = await listProjectSubmissions(projectId, token);
    sendJson(req, res, 200, result);
    return true;
  }

  if (child === "submissions.csv" && req.method === "GET") {
    const csv = await submissionsCsv(projectId, token);
    sendText(req, res, 200, csv, "text/csv; charset=utf-8", `palette-${projectId}-submissions.csv`);
    return true;
  }

  if ((child === "handoff" || child === "handoff.json") && req.method === "GET") {
    const result = await handoffArtifact(projectId, token);
    sendJson(req, res, 200, result);
    return true;
  }

  return false;
}

function readJson(req, maxBytes = 1_000_000) {
  return readBody(req, maxBytes).then((body) => {
    if (body.length === 0) return {};

    try {
      return JSON.parse(body.toString("utf8"));
    } catch {
      throw withStatus(new Error("Invalid JSON body."), 400);
    }
  });
}

async function readAssetInput(req) {
  const type = contentType(req);
  if (type.toLowerCase().startsWith("application/json")) {
    const payload = await readJson(req, 12_500_000);
    return assetInputFromJson(payload);
  }

  if (type.toLowerCase().startsWith("image/")) {
    return {
      buffer: await readBody(req, 12_000_000),
      contentType: type,
      fileName: headerValue(req, "x-file-name"),
      title: headerValue(req, "x-asset-title"),
      kind: headerValue(req, "x-asset-kind"),
    };
  }

  throw withStatus(new Error("Expected application/json or an image content type."), 415);
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
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Owner-Token, Authorization, X-File-Name, X-Asset-Title, X-Asset-Kind");
  res.setHeader("Vary", "Origin");

  if (statusCode === 204) {
    res.end();
    return;
  }

  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(payload));
}

function sendText(req, res, statusCode, text, contentTypeValue, fileName) {
  res.statusCode = statusCode;
  res.setHeader("Access-Control-Allow-Origin", corsOrigin(req));
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Owner-Token, Authorization");
  res.setHeader("Vary", "Origin");
  res.setHeader("Content-Type", contentTypeValue);
  if (fileName) res.setHeader("Content-Disposition", `attachment; filename="${fileName.replace(/"/g, "")}"`);
  res.end(text);
}

function sendBinary(req, res, statusCode, body, contentTypeValue, fileName) {
  res.statusCode = statusCode;
  res.setHeader("Access-Control-Allow-Origin", corsOrigin(req));
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Owner-Token, Authorization");
  res.setHeader("Vary", "Origin");
  res.setHeader("Content-Type", contentTypeValue || "application/octet-stream");
  res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
  if (fileName) res.setHeader("Content-Disposition", `inline; filename="${fileName.replace(/"/g, "")}"`);
  res.end(body);
}

async function sendCodexApplyStream(req, res, payload) {
  res.statusCode = 200;
  res.setHeader("Access-Control-Allow-Origin", corsOrigin(req));
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Owner-Token, Authorization");
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

async function sendWorkspaceBuildStream(req, res, payload, runner) {
  res.statusCode = 200;
  res.setHeader("Access-Control-Allow-Origin", corsOrigin(req));
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Owner-Token, Authorization");
  res.setHeader("Vary", "Origin");
  res.setHeader("Content-Type", "application/x-ndjson");
  res.setHeader("Cache-Control", "no-store");

  const write = (event) => {
    res.write(`${JSON.stringify(event)}\n`);
  };

  try {
    const result = await runner(payload, write);
    write({ type: "result", label: result.status, result });
  } catch (error) {
    write({
      type: "error",
      label: "Palette build failed",
      detail: error instanceof Error ? error.message : "Unexpected Palette build error.",
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

function headerValue(req, name) {
  const value = req.headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value || "";
}

function ownerToken(req, url) {
  const direct = headerValue(req, "x-owner-token") || url.searchParams.get("ownerToken") || url.searchParams.get("token") || "";
  if (direct) return direct;

  const authorization = headerValue(req, "authorization");
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match?.[1] || "";
}

function requestMeta(req) {
  return {
    userAgent: headerValue(req, "user-agent"),
    origin: headerValue(req, "origin"),
    ip: headerValue(req, "x-forwarded-for") || req.socket.remoteAddress || "",
  };
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
