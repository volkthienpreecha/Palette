# Palette

**A canvas where Codex becomes a live paintbrush.**

---

## The Problem

Every AI coding tool gives you the same experience: you write a prompt, you wait, you get back a wall of code you didn't watch happen. If the result is wrong, you start over from scratch.

The most powerful coding agent in the world — Codex — still feels like a black box. You can't see what it's building. You can't change direction mid-generation. You just wait and hope.

We use Codex every day. That friction is real, and it keeps Codex out of reach for anyone who isn't already comfortable in a terminal.

---

## The Solution

Palette is a canvas-first workspace for Codex.

Instead of a chat box, you get a canvas. Instead of waiting, you watch Codex paint your frontend in real time — section by section, layer by layer. And instead of restarting when something looks wrong, you interrupt, point at the section, give a new direction, and Codex steers from exactly where it stopped.

When it looks right, one button hands the canvas to Codex and it writes the real React files to disk.

---

## How It Works

```
Paint  →  Steer  →  Interrupt  →  Set the paint
```

**1. Paint** — Type one sentence. Palette sends it to Codex, which begins forming a frontend on the canvas in visible strokes. Hero, features, pricing, testimonials — each section appears as it's built.

**2. Steer** — Click any section while it's forming. Open the command capsule, type a new direction, and Codex incorporates it without restarting. Voice input is also supported.

**3. Interrupt** — Press Escape at any moment to lift the brush. The canvas pauses. You can inspect, redirect, or delete any section before Codex continues.

**4. Set the paint** — When the canvas looks right, hit Codex Apply. Codex writes `src/generated/PalettePage.tsx` to your repo — real, working React code, not a screenshot.

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

## Built With Codex

Palette was built using OpenAI Codex throughout development. The canvas painting flow — sections forming in sequence, the steering model, the interrupt mechanism — was designed around Codex's strengths as an execution agent, not a generic LLM.

The core loop:

1. A structured canvas model describes the frontend as typed sections with variants
2. The OpenAI Responses API resolves natural language into safe canvas operations
3. Codex receives a clean, validated handoff and writes the output files
4. The frontend reflects every change in real time as operations apply

---

## The Canvas

The interface is designed to make Codex feel approachable to anyone — not just developers.

- **Blank canvas first** — open space, one obvious way to begin
- **Painting stage** — sections appear in visible layers with a warm light sweep as each one forms
- **Corgi studio guide** — a small companion that narrates every phase of painting in plain language
- **Status rail** — shows the current painting phase so you always know where Codex is
- **Reference swatches** — drag and drop images; Palette extracts colors and mixes them into the canvas
- **Brush toolbar** — click any section to move it, remove it, or change its style
- **Command capsule** — fixed at the bottom, opens for text or voice steering at any moment

---

## Themes and Variants

Every generated section supports six visual variants:

- **Atelier** — warm canvas surface, editorial type, soft paper texture
- **Premium** — deep dark surface, cobalt accents, refined spacing
- **Playful** — rounded corners, warmer palette, more expressive
- **Minimal** — flat white, type-only, hairline borders
- **Glass** — frosted surface, intentional blur, cobalt-tinted edges
- **Editorial** — dark ink panel, reversed type, high contrast

---

## Technical Details

- **Frontend** — React 19, TypeScript, Vite, Framer Motion
- **Backend** — Node.js HTTP server (no framework), streams build and Codex apply progress via NDJSON
- **AI** — real skill-backed build runner with Groq/OpenAI/Codex provider selection, Codex CLI for repo apply, Groq Whisper for voice
- **Canvas model** — fully typed operation model with undo/redo history, export, and Codex-readable folder save

---

## Running It

See [SETUP.md](SETUP.md) for full setup instructions, environment variables, and the demo flow.

Quick start:

```bash
npm install
npm run api   # backend on :8787
npm run dev   # frontend on :5173
```

---

## Demo Flow

The old stage script now lives in [docs/demo-sequence.md](docs/demo-sequence.md). The normal app flow uses the real interview, reference board, Codex build, steering, and polish path.
