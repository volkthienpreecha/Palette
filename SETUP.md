# Palette

Palette is a local demo app for painting a frontend into code. You start with a blank canvas, describe what you want, steer selected sections, add notes, use voice strokes, and ask Codex to write the generated React files.

The project has two parts:

- The frontend: the app you open in the browser.
- The backend: local API routes for skill-backed building, steering, voice transcription, saving folders, and Codex repo apply.

## What You Need

Install these first:

- Node.js 20 or newer.
- npm, which comes with Node.
- A Groq API key if you want real AI painting now and voice transcription.
- Codex Desktop or Codex CLI if you want to force the Codex build provider or use the `Codex apply` button.
- An OpenAI API key if you want OpenAI/Codex-provider builds. Without a valid OpenAI key, Palette can still build through Groq.

## First Setup

Open PowerShell in the project folder:

```powershell
cd C:\Users\volko\Downloads\Palette
```

Install the project packages:

```powershell
npm install
```

Create your local environment file:

```powershell
Copy-Item .env.example .env
```

Open `.env` and fill in the keys you have:

```env
OPENAI_API_KEY=
CODEX_API_KEY=
GROQ_API_KEY=
```

Keep `.env` private. It is already ignored by git.

## Run The App

You need two PowerShell windows.

In the first window, start the backend:

```powershell
cd C:\Users\volko\Downloads\Palette
npm run api
```

Leave that window open.

In the second window, start the frontend:

```powershell
cd C:\Users\volko\Downloads\Palette
npm run dev
```

Open the URL Vite prints. It is usually:

```text
http://127.0.0.1:5173/
```

## First Run Flow

Use this path to verify the real build loop:

1. Open the app.
2. Click `Begin with a brushstroke`.
3. Describe the frontend you want:

```text
Build a landing page for a ceramic dental studio.
```

4. Answer the design questions in plain language.
5. Add a reference link, screenshot, or note if you have one.
6. Click `Begin painting`.
7. Watch the page paint in sections.
8. Click the hero section.
9. Click `Start stroke`.
10. Try:

```text
make this calmer and more premium
```

11. Try:

```text
add a waitlist form here
```

12. Try:

```text
make this feel finished
```

13. Click `Download files` to hand the generated workspace to a code agent.
14. Click `Codex apply` only when you want Codex CLI to write `src/generated` repo files.

## What The Buttons Do

`Start stroke` opens the command box.

`Command` also opens the command box.

`Voice stroke` records audio and sends it to Groq, then places the transcription in the command box.

`Begin painting` creates a workspace under:

```text
.palette/workspaces/<project-id>/
```

The generated folder contains both structured canvas data and a usable React component:

```text
generated/palette-project.json
generated/PalettePage.tsx
```

By default, Palette uses Groq for the real build path when `GROQ_API_KEY` is set. To force a provider:

```powershell
$env:PALETTE_BUILD_PROVIDER="groq"   # default when GROQ_API_KEY exists
$env:PALETTE_BUILD_PROVIDER="openai" # needs a valid OPENAI_API_KEY
$env:PALETTE_BUILD_PROVIDER="codex"  # needs authenticated Codex CLI
```

The sidebar shows `Live painter` so a beginner can see which local engine Palette will use before pressing `Begin painting`.

`Save folder` saves the current canvas under:

```text
.palette/projects/
```

`Codex apply` asks Codex to write:

```text
src/generated/palette-project.json
src/generated/PalettePage.tsx
```

`Set paint` downloads a JSON export of the current canvas.

`Download files` downloads a code-agent bundle after `Begin painting` succeeds. The bundle includes:

```text
PRODUCT.md
DESIGN.md
palette-brief.json
generated/palette-project.json
generated/PalettePage.tsx
references/
```

Give that JSON bundle to Codex, Claude Code, Cursor, or another coding agent when you want the generated frontend connected to a real app.

## Useful Shortcuts

```text
Ctrl K        Open the command box
Ctrl Shift K  Start voice input
Esc           Interrupt painting or stop recording
Delete        Remove the selected section
Ctrl Z        Undo
Ctrl Y        Redo
```

## Smoke Test

Run the full-stack smoke gate after backend or build-runner changes:

```powershell
npm run smoke:full-stack
```

It checks skill loading, the Impeccable interview, reference persistence, real build, steering, polish, and direct TypeScript compilation of the generated `PalettePage.tsx`.

## Environment Flags

These flags are already included in `.env.example`:

```env
VITE_PALETTE_INTENT_API=1
VITE_PALETTE_CODEX_APPLY=1
VITE_PALETTE_PROJECT_STORE=1
VITE_PALETTE_HANDOFF_API=1
VITE_PALETTE_WORKSPACE_STORE=1
VITE_PALETTE_VOICE_API=1
```

The shippable bridges are on by default. Set a matching Vite flag or localStorage value to `0` only when you deliberately want to force local-only behavior while debugging.

If a feature button says the backend is offline, make sure `npm run api` is running.

If voice does not transcribe, make sure `GROQ_API_KEY` is set.

If the live painter is not ready, open the `Live painter` card and check whether Groq, OpenAI, or Codex CLI is selected and authenticated.

If Codex apply fails, make sure Codex Desktop or Codex CLI is installed and available on this machine.

## Check The Project

Run the backend syntax check:

```powershell
npm run check:server
```

Run the full build:

```powershell
npm run build
```

## Common Fixes

If port `5173` is busy, Vite will print another local URL. Use the URL it gives you.

If port `8787` is busy, stop the old backend process and run `npm run api` again.

If the frontend loads but AI features do nothing, the backend is probably not running.

If Codex apply takes a while, wait for the progress panel. A real Codex run can take more than a minute.
