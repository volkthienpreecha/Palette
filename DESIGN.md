<!-- SEED: re-run /impeccable document once there's code to capture the actual tokens and components. -->
---
name: Palette
description: A Codex-native canvas where beginners paint frontend software into real code.
---

# Design System: Palette

## 1. Overview

**Creative North Star: "The Codex Atelier"**

Palette should feel like stepping into a quiet 19th-century painter's studio where the canvas is alive and Codex is the brush. The interface begins with open space, reference swatches, a small studio companion, and a glass command capsule that feels like a tool in the hand, not a chat box. The product should be instantly legible to beginners: prime the canvas, mix swatches, begin painting, guide the brush, set the paint.

The aesthetic should borrow from Monet-era painting language, classical studio materials, and soft physical light, then translate that into a modern software workspace. Use painterly atmosphere with restraint: warm canvas surfaces, ink-like text, pigment swatches, soft washes during generation, and clear action controls. Reject generic AI SaaS styling, purple-blue gradients, glass cards everywhere, and generated-dashboard slop.

**Key Characteristics:**
- Blank-canvas first impression with generous space and no marketing-page hero.
- Painterly system language: canvas, swatches, brush, wash, varnish, set the paint.
- Beginner-safe controls that make Codex visible, interruptible, and steerable.
- Soft studio atmosphere with crisp product affordances.
- Demo-first motion where the UI appears in visible strokes and layers.

## 2. Colors

The palette should feel like warm canvas, aged plaster, graphite ink, and restrained pigment. Exact values are [to be resolved during implementation].

### Primary
- **Graphite Ink** ([to be resolved during implementation]): The main text and command color. It should feel deep and clear without becoming pure black.

### Secondary
- **Cobalt Brush** ([to be resolved during implementation]): A rare action accent for the active brush, selected swatches, and "Set the Paint" moments.

### Tertiary
- **Vermilion Pin** ([to be resolved during implementation]): A tiny warm accent for interrupt states, recording, and pinned notes. Use sparingly.

### Neutral
- **Atelier Canvas** ([to be resolved during implementation]): The primary page surface, warm and off-white rather than sterile white.
- **Plaster Wash** ([to be resolved during implementation]): Subtle panels, blurred overlays, and generation washes.
- **Soft Charcoal** ([to be resolved during implementation]): Secondary text, helper copy, and inactive controls.
- **Dry Brush Line** ([to be resolved during implementation]): Hairline borders and selection outlines.

### Named Rules

**The Pigment Scarcity Rule.** Color is paint, not decoration. Pigment accents must be rare enough that users notice when the brush is active.

**The No AI Gradient Rule.** Purple-blue AI gradients are prohibited. If a surface needs atmosphere, use a wash, texture, or tonal layer instead.

## 3. Typography

**Display Font:** Serif display + sans body ([font pairing to be chosen at implementation])  
**Body Font:** Sans body ([font pairing to be chosen at implementation])  
**Label Font:** Crisp sans labels for controls, status, and canvas tools ([font pairing to be chosen at implementation])

**Character:** The type should feel like a museum label meeting a modern command surface: cultured, readable, and direct. Display type can carry atelier warmth; product controls should stay plain enough for first-time AI coding users.

### Hierarchy
- **Display** ([to be resolved during implementation]): Product name, blank-canvas title, and major painting phase only.
- **Headline** ([to be resolved during implementation]): Corgi interview questions and major panel headings.
- **Title** ([to be resolved during implementation]): Swatch labels, section labels, and toolbars.
- **Body** ([to be resolved during implementation]): Plain-language beginner guidance, capped at readable line length.
- **Label** ([to be resolved during implementation]): Command actions, keyboard hints, and status tags.

### Named Rules

**The Studio Label Rule.** Copy should sound like an artist's studio translated into clear software language. Never drift into fake old-timey prose.

## 4. Elevation

Palette should be flat by default with layered atmosphere only around active tools. Depth comes from soft washes, translucent command surfaces, crisp selection outlines, and motion state. Shadows should be ambient and shallow, never heavy card stacks.

### Named Rules

**The Canvas First Rule.** The canvas is the main surface. Floating tools may lift above it, but page sections should not become nested cards.

## 5. Components

### Command Capsule
- **Shape:** A dark, rounded glass capsule that opens from a compact hint into a listening or typing state.
- **Role:** The user's brush handle: voice, text, interrupt, and send.
- **States:** Idle, listening, transcribing, applying, and cancelled must be visually distinct.

### Reference Swatches
- **Shape:** Small pinned image chips or paper scraps along the canvas edge.
- **Role:** Visual references that Palette "mixes" before painting.
- **States:** Added, selected, annotated, and removed.

### Painting Stage
- **Shape:** Full-canvas soft wash with layered reveal.
- **Role:** Shows Codex forming the UI in strokes: structure, hero, sections, motion, and editable surface.
- **States:** Priming, mixing, first wash, painting, varnishing, setting.

### Canvas Selection
- **Shape:** A crisp outline and compact inline toolbar around selected generated elements.
- **Role:** Direct manipulation for text, notes, delete, style, animation, and move up/down.
- **States:** Hover, selected, editing, changed, and locked while setting paint.

## 6. Do's and Don'ts

### Do:
- **Do** make the first screen a blank canvas with one obvious way to begin.
- **Do** use painterly language for the flow: prime, swatches, first wash, brush, varnish, set the paint.
- **Do** make interruptibility visible at all times while Codex is painting.
- **Do** keep beginner guidance short, concrete, and tied to the current action.
- **Do** make the product feel demoable in seconds, with visible formation rather than hidden waiting.
- **Do** use warm off-white surfaces and graphite-like text instead of pure white and pure black.

### Don't:
- **Don't** make a generic AI SaaS dashboard.
- **Don't** use purple-blue AI gradients, floating decorative orbs, or bland glass cards everywhere.
- **Don't** make Palette look like Lovable, v0, Bolt, Webflow, or Figma.
- **Don't** hide Codex behind a normal chat box. The canvas must be the primary interface.
- **Don't** overload beginners with files, frameworks, terminal logs, or technical setup before the magic moment.
- **Don't** use painterly copy that becomes confusing or theatrical. Clarity wins.
- **Don't** use emojis anywhere in the interface, status language, sample data, or pitch-facing copy.
