# Friendy Design Reference

> Cozy relationship memory, not AI SaaS.

Friendy should feel like a private little memory companion for people who meet many people and continue with their lives. The landing page should be light, warm, animated, and human. It should not look like a dashboard, CRM, AI productivity cockpit, or enterprise contact system.

## Product Feeling

- Warm, private, cute-cozy.
- Personal memory, not surveillance.
- Human context before technical architecture.
- Calm relief: "I could not remember their name, but Friendy remembered the moment."
- A little playful, but still trustworthy because the product touches contacts and calendar context.

## Audience

Primary landing-page audience:

- People who meet many people at events, residencies, dinners, conferences, schools, founder circles, and creative communities.
- They add contacts quickly, then later remember the story, project, room, activity, or conversation better than the name.
- They want help refinding people, not managing a pipeline.

Do not design for event organizers, enterprise sales teams, recruiters, or CRM admins unless a future product direction explicitly changes.

## Visual Direction

Friendy is a light-first cozy-white website with a living animated backdrop.

Use:

- Warm paper and cozy white surfaces.
- Soft sky, cream, peach, butter, and pale mint accents.
- Small character illustrations of people meeting, passing by, exchanging small memory notes, or walking through an event-like world.
- Floating message and memory panels over the animated scene.
- Rounded, soft controls with clear contrast.
- Gentle atmosphere similar in spirit to the supplied Superhuman and Genie references, but warmer and more personal.

Avoid:

- Dark Mercury/Raycast command-center mood.
- Generic purple/blue AI gradients.
- Inter-only or Space Grotesk-only SaaS typography.
- Three-column feature grids as the default landing-page structure.
- Cards inside cards.
- CRM tables, lead pipelines, contact dashboards, analytics counters.
- Placeholder prompt copy or fake metrics.
- Product panels that imply Friendy reads messages, scrapes socials, or saves people automatically.

## Signature Concept

The signature visual idea is a "passing lives" scene:

Little human characters move through a soft event world. Two characters cross paths, a small memory note appears between them, then they continue on. Friendy quietly keeps the note so the user can find the person later from context.

This should show up in at least five places when designing the landing page:

- Hero animated background.
- Product preview message: "Who was the AI recruiting founder who played piano?"
- Event-window consent chip.
- Candidate confirmation moment.
- Saved memory note with source and context.

## Landing Page Story

The landing page should tell the actual Friendy loop:

1. You meet someone.
2. You add their contact.
3. Friendy asks before remembering the event window or saving the person.
4. You add one messy human note.
5. Later, you search by context instead of name.
6. Friendy returns the likely person, why it matched, and the contact route.

The first viewport should not be generic "AI relationship intelligence." It should make the magic obvious in under 10 seconds.

Example hero copy direction:

```text
Remember people by the moment, not the name.

Friendy helps you refind people you meet by keeping small, private notes tied to the events where life crossed paths.
```

## Color Tokens

These are starting tokens for design work. Adjust only with a clear reason.

| Name | Value | Token | Role |
| --- | --- | --- | --- |
| Cozy White | `#fffdf7` | `--color-cozy-white` | Primary page canvas; warmer than pure white |
| Warm Paper | `#f7efe4` | `--color-warm-paper` | Section background and large calm surfaces |
| Milk Glass | `rgba(255, 253, 247, 0.72)` | `--color-milk-glass` | Translucent hero panels over animation |
| Ink Brown | `#26211c` | `--color-ink-brown` | Primary text; warmer than black |
| Soft Cocoa | `#6f6258` | `--color-soft-cocoa` | Secondary text and captions |
| Cloud Blue | `#eaf6ff` | `--color-cloud-blue` | Sky wash, illustration background, gentle depth |
| Butter | `#fff1b8` | `--color-butter` | Tiny highlight moments in illustration |
| Peach | `#ffd8c2` | `--color-peach` | Warm character and memory-note accents |
| Mint | `#d8f0df` | `--color-mint` | Consent/success accent and gentle confirmation states |
| Friendy Teal | `#0f766e` | `--color-friendy-teal` | Existing product accent; use sparingly for confirmed/private states |
| Soft Line | `#e9ded2` | `--color-soft-line` | Hairline borders |
| Cozy Shadow | `rgba(79, 56, 34, 0.10)` | `--shadow-cozy` | Soft elevation on white/paper surfaces |

Rules:

- Use warm canvas colors more than accent colors.
- Keep `Friendy Teal` as a small functional signal, not the brand's whole personality.
- Soft gradients are allowed only for atmospheric background and illustration. Do not use purple/multicolor gradient heroes.
- Text contrast must remain readable on warm surfaces.

## Typography

The repo currently uses Inter/system defaults, but that should not define the brand.

Recommended direction:

- Display: a warm rounded serif or humanist display face for landing-page headlines if available.
- Body/UI: a readable humanist sans with soft forms.
- Fallback: system sans is acceptable during prototype work, but do not make "plain Inter SaaS" the final aesthetic.

Typography rules:

- Do not use negative tracking unless the chosen typeface and design review justify it. Baseline UI generally prefers default letter spacing.
- Use balanced headline line breaks.
- Body copy should feel conversational and specific, not marketing-generic.
- Do not overuse giant hero typography inside compact product panels.

## Shapes And Surfaces

- Page canvas: warm, open, mostly unframed.
- Product panels: translucent milk-glass over hero animation, then solid cozy-white cards below.
- Buttons: rounded 999px or soft 12-16px radius depending on scale.
- Cards: use only for distinct repeated items or product panels. Do not place cards inside cards.
- Border: low-contrast warm hairline.
- Shadow: soft brown-tinted shadow only; avoid heavy gray SaaS shadows.

## Motion

Motion is part of the brand, but it must stay gentle.

Allowed:

- Slow looping background animation of small characters moving through a scene.
- Small memory-note reveal when characters meet.
- Soft floating motion for tiny decorative pieces.
- Message panel entrance when demonstrating the product loop.

Rules:

- Respect `prefers-reduced-motion`.
- Keep interaction feedback under 200ms.
- Animate transform and opacity only.
- Do not animate layout, blur-heavy full-screen surfaces, or large product panels.
- Background animation should never make text hard to read.

## Component Direction

### Hero

Full-bleed or near full-bleed warm animated scene. The product must be visible in the first viewport through a message/memory preview, not just atmosphere.

### Navigation

Small, quiet, warm-white or translucent top bar. Avoid large enterprise nav menus until the product has those pages.

### Primary CTA

Dark warm ink or Friendy teal fill. Short label. No glowing gradient button.

### Product Preview

Message-like panels showing:

- Event window consent.
- Candidate confirmation.
- Vague recall query.
- Source-backed match result.

Every product panel should reinforce privacy and user control.

### Feature Sections

Prefer narrative sections over generic grids:

- "Meet"
- "Confirm"
- "Remember"
- "Refind"

Each should show a product moment. Avoid vague cards like "AI-powered", "Smart search", "Secure".

## Copy Rules

Use concrete, human memory language:

- "Who was the AI recruiting founder from dinner?"
- "I remember they played piano."
- "Saved after you confirmed."
- "Source: new contact after Photon Residency Dinner."

Avoid:

- "Unlock your network."
- "AI-powered relationship intelligence."
- "Never miss an opportunity."
- "Automate your relationships."
- Any wording that suggests scraping, surveillance, or automatic saving.

## Privacy And Consent Rules

Friendy design must always preserve these facts:

- Friendy does not read iMessage.
- Friendy does not scrape Instagram, LinkedIn, X, or websites.
- Friendy does not use face recognition.
- Detected contacts become pending candidates, not saved memories.
- User confirmation is required before saving a relationship memory.
- Show the data source for each candidate whenever possible.

## Baseline UI Guardrails

Apply these when designing or reviewing UI:

- No cards inside cards.
- No dashboard-first layout unless the task is explicitly an app/dashboard surface.
- No default Inter/Space Grotesk plus purple gradient hero.
- No three-column feature grid unless each card represents a real Friendy product moment.
- No fake analytics or fake productivity metrics.
- No placeholder copy from prompts.
- Use accessible controls for focus/keyboard behavior.
- Icon-only buttons need accessible labels.
- Errors and privacy warnings belong near the action that caused them.
- Empty states need one clear next action.
- Mobile text must fit without overlapping or being clipped.

## Implementation Notes For This Repo

- Current stack is Vite, React, TypeScript, and plain CSS.
- There is no Tailwind or shadcn setup yet.
- The existing `src/App.tsx` is labeled as a legacy local web shell; do not treat it as final brand.
- If introducing shadcn/Tailwind later, do it as a deliberate design-system setup slice, not as incidental landing-page churn.
- Keep implementation slices small and verify with `npm test` and `npm run build`.

