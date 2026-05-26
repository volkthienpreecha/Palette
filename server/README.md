# Palette Intent Bridge

`POST /api/intent` accepts:

```json
{
  "command": "make the selected hero quieter",
  "selectedId": "hero",
  "project": {}
}
```

It returns:

```json
{
  "operations": [],
  "status": "Translated the stroke into safe Palette operations.",
  "source": "openai"
}
```

Run it with:

```powershell
$env:OPENAI_API_KEY="sk-..."
npm run api
```

Then start the Vite app with the remote bridge enabled:

```powershell
$env:VITE_PALETTE_INTENT_API="1"
npm run dev
```

Without `OPENAI_API_KEY`, the endpoint uses the deterministic local parser and returns `source: "local"`.
With a key, the backend calls the OpenAI Responses API and then validates the model output against Palette's operation allowlist before the frontend can apply it.

By default, the frontend does not call `/api/intent`. This keeps the demo clean when the backend is not running. You can also enable the bridge in an existing browser session with:

```js
localStorage.setItem("palette:intent-api", "1");
location.reload();
```

## Codex Repo Apply

`POST /api/codex/apply` accepts the current Palette project and runs the local Codex CLI in this workspace. It writes a handoff file under `.palette/`, then asks Codex to create or update:

```text
src/generated/palette-project.json
src/generated/PalettePage.tsx
```

Run the backend first:

```powershell
npm run api
```

Then enable the frontend button:

```js
localStorage.setItem("palette:codex-apply", "1");
location.reload();
```

Or enable it at dev-server startup:

```powershell
$env:VITE_PALETTE_CODEX_APPLY="1"
npm run dev
```

Safety boundary: this endpoint only runs on the local backend, validates the project payload, and prompts Codex to edit only `src/generated/palette-project.json` and `src/generated/PalettePage.tsx`. On Windows it prefers the Codex Desktop bundled CLI when available, then falls back to `codex.cmd`. It runs `codex exec --sandbox workspace-write` and verifies the expected files exist before reporting success. For a non-mutating server check, set:

```powershell
$env:PALETTE_CODEX_DRY_RUN="1"
npm run api
```
