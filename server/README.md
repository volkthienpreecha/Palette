# Palette Planner Bridge

`POST /api/planner` accepts:

```json
{
  "command": "make the selected hero quieter",
  "selectedId": "hero",
  "selectedSection": {},
  "notes": [],
  "references": [],
  "project": {}
}
```

It returns:

```json
{
  "operations": [],
  "status": "Translated the stroke into safe Palette operations.",
  "source": "provider",
  "provider": "openai"
}
```

Run it with:

```powershell
$env:OPENAI_API_KEY="sk-..."
npm run api
```

`npm run api` also loads a local `.env` file from the project root, so you can keep `OPENAI_API_KEY`, `GROQ_API_KEY`, and local demo flags there.

Then start the Vite app:

```powershell
npm run dev
```

Without `OPENAI_API_KEY`, the endpoint uses the deterministic local parser and returns `source: "local"`.
With a key, the backend calls the configured planner provider, currently OpenAI by default, and then validates the model output against Palette's operation allowlist before the frontend can apply it. `POST /api/intent` remains as a compatibility alias for older clients.

The planner bridge is legacy. The normal Palette flow now uses the skill-backed workspace build endpoints below. If you need to force the old planner bridge off in a browser session, use:

```js
localStorage.setItem("palette:planner-api", "0");
location.reload();
```

## Skill-Backed Workspace Build

`POST /api/build/start`, `POST /api/build/patch`, and `POST /api/design/polish` create and update real workspaces under:

```text
.palette/workspaces/<project-id>/
```

Each workspace contains:

```text
PRODUCT.md
DESIGN.md
palette-brief.json
skill-context.md
references/
generated/palette-project.json
generated/PalettePage.tsx
```

`generated/PalettePage.tsx` is a standalone React renderer for the structured project, not a placeholder dump. It can be handed to another coding agent with `palette-project.json` as the starting frontend files.

The backend loads the real local Impeccable skill plus Taste Skill and Emil's skill before each build. Provider selection is controlled by `PALETTE_BUILD_PROVIDER`:

```powershell
$env:PALETTE_BUILD_PROVIDER="groq"
$env:PALETTE_BUILD_PROVIDER="openai"
$env:PALETTE_BUILD_PROVIDER="codex"
```

If no provider is set, Groq is used when `GROQ_API_KEY` exists, then OpenAI when `OPENAI_API_KEY` exists, then Codex CLI. `codex` requires an authenticated local Codex CLI. The generated workspace boundary is verified after every run.

For a repeatable local verification pass:

```powershell
npm run smoke:full-stack
```

The smoke gate exercises skill loading, interview, reference persistence, build, patch, polish, and generated TypeScript compilation.

`GET /api/build/status` returns the selected local build engine, model, and setup state. The frontend uses this for the `Live painter` card so users know whether Palette will paint through Groq, OpenAI, or Codex before starting a build.

`GET /api/workspaces/:projectId/bundle` returns a downloadable JSON bundle for the real generated workspace. It includes the product brief, design system, structured project JSON, standalone React page, and saved reference files. This is the code-agent handoff path for users who want to continue the generated frontend in Codex, Claude Code, Cursor, or another agent without using the repo apply button.

## Codex Repo Apply

`POST /api/codex/apply` accepts the current Palette project and runs the local Codex CLI in this workspace. It writes an agent-neutral handoff file under `.palette/`, then asks Codex to create or update:

```text
src/generated/palette-project.json
src/generated/PalettePage.tsx
```

Run the backend first:

```powershell
npm run api
```

The frontend calls this bridge by default. To force the button back to local-only mode while debugging:

```js
localStorage.setItem("palette:codex-apply", "0");
location.reload();
```

Or set it at dev-server startup:

```powershell
$env:VITE_PALETTE_CODEX_APPLY="0"
npm run dev
```

Safety boundary: this endpoint only runs on the local backend, validates the project payload, and prompts Codex to edit only `src/generated/palette-project.json` and `src/generated/PalettePage.tsx`. On Windows it prefers the Codex Desktop bundled CLI when available, then falls back to `codex.cmd`. It runs `codex exec --sandbox workspace-write` and verifies the expected files exist before reporting success. For a non-mutating server check, set:

```powershell
$env:PALETTE_CODEX_DRY_RUN="1"
npm run api
```

## Agent Handoff Bundle

`POST /api/handoff/bundle` prepares the same agent-neutral handoff JSON without running Codex. The bundle is written under `.palette/` and includes the normalized project, allowed output files, selected-section context, pinned notes, and reference swatches. It is intended to be readable by Codex, Claude Code, Cursor, or a generic coding agent.

## Folder Store

`POST /api/projects/save` saves the current canvas into a timestamped folder under:

```text
.palette/projects/
```

Each folder contains:

```text
project.json
codex-notes.md
```

The frontend calls this folder store by default. To force local-only mode while debugging:

```js
localStorage.setItem("palette:project-store", "0");
location.reload();
```

This is the MVP database. It is local, inspectable, and Codex-readable without auth or a hosted service.

## Persistent Project API

The shippable MVP store uses durable JSON under `.palette/store.json` and uploaded image files under `.palette/assets/`.

- `POST /api/projects` creates a reopenable project and returns `projectId` plus an `ownerToken`.
- `GET /api/projects/:projectId` and `PUT /api/projects/:projectId` require the owner token via `X-Owner-Token`, `Authorization: Bearer ...`, or `?ownerToken=...`.
- `GET/POST /api/projects/:projectId/notes` persists canvas notes with owner-token auth.
- `GET/POST /api/projects/:projectId/assets` stores PNG, JPEG, WebP, or GIF screenshots/reference images. JSON uploads accept `dataUrl` or `base64`.
- `GET/POST /api/projects/:projectId/components` persists live component metadata with owner-token auth.
- `POST /api/projects/:projectId/submissions` accepts public waitlist/contact/form submissions.
- `GET /api/projects/:projectId/submissions` and `GET /api/projects/:projectId/submissions.csv` require the owner token.
- `GET /api/projects/:projectId/handoff` returns a Codex-free handoff artifact with project JSON, notes, assets, components, and submissions CSV content.

`POST /api/projects/save` still writes the timestamped folder above, and now also returns `projectId`, `ownerToken`, `reopen`, and `handoff` so the same canvas can be reopened through the persistent API.

## Voice Strokes

`POST /api/voice/transcribe` accepts a browser-recorded audio blob and sends it to Groq's OpenAI-compatible transcription endpoint. Set the key only in your shell:

```powershell
$env:GROQ_API_KEY="..."
npm run api
```

The frontend calls the voice bridge by default. To force local-only mode while debugging:

```js
localStorage.setItem("palette:voice-api", "0");
location.reload();
```

The default model is `whisper-large-v3-turbo`. Override it with:

```powershell
$env:GROQ_TRANSCRIBE_MODEL="whisper-large-v3"
```
