# Palette

**A canvas where Codex becomes a live paintbrush.**

---

## The Problem

Every AI coding tool gives you the same experience: write a prompt, wait, get back a wall of code you didn't watch happen. If the result is wrong, start over.

Codex is the most capable coding agent available. It still feels like a black box. You can't see what it's building. You can't change direction mid-generation. You just wait and hope.

---

## The Solution

Palette is a visual workspace for Codex.

Instead of a chat box, you get a canvas. Instead of waiting, you watch Codex paint your frontend in real time — section by section. And instead of restarting when something looks wrong, you interrupt, point at the section, give a new direction, and Codex steers from exactly where it stopped.

When it looks right, one button hands the canvas to Codex and it writes the real React files to disk.

---

## How It Works

```
Prime  →  Paint  →  Steer  →  Set the paint
```

**1. Prime** — A short design interview before painting. Answer in plain language. Add reference images, links, or Figma files. Palette mixes them into context before the first brushstroke.

**2. Paint** — Type one sentence. Palette sends it to the build engine, which forms a frontend on the canvas in visible strokes — nav, hero, features, pricing, testimonials — each section appearing as it's built.

**3. Steer** — Press Escape mid-paint to pause. Click any section, type a direction in the command capsule or speak it, and Codex incorporates it without restarting. The canvas steers from exactly where it stopped.

**4. Set the paint** — When the canvas looks right, click Codex Apply. Real React component files are written to disk. Not a screenshot — working code.

---

## What Makes It Different

| Other tools | Palette |
|---|---|
| Show you the finished result | Shows Codex building in real time |
| Chat-first interaction | Canvas-first interaction |
| Restart to change direction | Interrupt and steer mid-stroke |
| Output is code you have to read | Output is a visual canvas you can point at |
| Requires terminal familiarity | No terminal, no file tree, no prompt syntax |

---

## The Interface

The studio shell is warm ivory — like a physical painter's workspace. The canvas inside it is near-black — where the work appears. Generated sections emerge on it as luminous panels, like paintings forming on a dark surface.

- **Blank canvas** — open space, one obvious way to begin
- **Design interview** — plain language questions before the first wash
- **Reference board** — pin images, links, or notes; Palette extracts colors and mixes them into the build context
- **Painting stage** — sections appear with a brushstroke reveal, left to right, as each one forms
- **Canvas status** — floating pill at the top of the canvas shows the current painting phase in real time
- **Brush toolbar** — click any section to move it, remove it, steer it, or polish it
- **Command capsule** — fixed at the bottom; opens for text or voice steering at any moment; context-aware label shows what it will do
- **Varnish moment** — when Codex apply completes, a single gold-verdigris ripple radiates across the canvas

---

## Themes and Variants

Every generated section supports six visual variants:

- **Atelier** — warm canvas surface, editorial type, soft paper texture
- **Premium** — deep dark surface, verdigris accents, refined spacing
- **Playful** — rounded corners, warmer palette, more expressive
- **Minimal** — flat white, type-only, hairline borders
- **Glass** — frosted surface, intentional blur, tinted edges
- **Editorial** — dark ink panel, reversed type, high contrast

---

## Technical Details

- **Frontend** — React 19, TypeScript, Vite, Framer Motion
- **Backend** — Node.js HTTP server (no framework), streams build and apply progress via NDJSON
- **AI** — OpenAI Responses API for intent resolution, skill-backed workspace builder with Codex/Claude/OpenAI provider selection, Codex CLI for repo apply, Groq Whisper for voice
- **Canvas model** — fully typed operation model with undo/redo history, brush log, pinned notes, submission tracking, export, and Codex-readable folder save
- **Design** — Cormorant Garamond display type, JetBrains Mono UI labels, OKLCH color system throughout, verdigris accent (`oklch(0.54 0.12 172)`)

---

## Running It

See [SETUP.md](SETUP.md) for full setup instructions, environment variables, and the demo flow.

Quick start:

```bash
npm install
npm run api   # backend on :8787
npm run dev   # frontend on :5173
```

Open `http://localhost:5173`.

---

## Demo Flow

1. Open the app
2. Click **Begin with a brushstroke**
3. Describe what you want to build in plain language
4. Answer the design questions
5. Add a reference image or link if you have one, then click **Begin painting**
6. Watch the canvas paint — press Escape to interrupt mid-stroke
7. Click any section and steer it from the command capsule
8. Click **Codex apply** and watch the real files write to disk

The full stage script lives in [docs/demo-sequence.md](docs/demo-sequence.md).
