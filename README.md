# Palette

Palette is a local demo app for painting a frontend into code. You start with a blank canvas, describe what you want, steer selected sections, add notes, use voice strokes, and ask Codex to write the generated React files.

The project has two parts:

- The frontend: the app you open in the browser.
- The backend: local API routes for AI intent, voice transcription, saving folders, and Codex repo apply.

## What You Need

Install these first:

- Node.js 20 or newer.
- npm, which comes with Node.
- Codex Desktop or Codex CLI if you want the real `Codex apply` button.
- A Groq API key if you want voice transcription.
- An OpenAI API key if you want the remote intent bridge. Without this, Palette still works with its local demo parser.

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

## Demo Flow

Use this path for the hackathon demo:

1. Open the app.
2. Click `Begin with a brushstroke`.
3. Use the default prompt, or type:

```text
Build a landing page for a robot coffee shop.
```

4. Pick one of the style answers.
5. Watch the page paint in sections.
6. Click the hero section.
7. Click `Start stroke`.
8. Try:

```text
headline: A live painted coffee bar
```

9. Try:

```text
add note: Give this hero more wet paint texture
```

10. Try:

```text
make this playful
```

11. Click `Codex apply` to stream real Codex progress and write generated files.

## What The Buttons Do

`Start stroke` opens the command box.

`Command` also opens the command box.

`Voice stroke` records audio and sends it to Groq, then places the transcription in the command box.

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

## Useful Shortcuts

```text
Ctrl K        Open the command box
Ctrl Shift K  Start voice input
Esc           Interrupt painting or stop recording
Delete        Remove the selected section
Ctrl Z        Undo
Ctrl Y        Redo
```

## Environment Flags

These flags are already included in `.env.example`:

```env
VITE_PALETTE_INTENT_API=1
VITE_PALETTE_CODEX_APPLY=1
VITE_PALETTE_PROJECT_STORE=1
VITE_PALETTE_VOICE_API=1
```

If a feature button says the backend is offline, make sure `npm run api` is running.

If voice does not transcribe, make sure `GROQ_API_KEY` is set.

If remote steering falls back to local mode, make sure `OPENAI_API_KEY` or `CODEX_API_KEY` is set.

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
