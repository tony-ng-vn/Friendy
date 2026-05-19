# Friendy Product Spec

## One-Sentence Definition

Friendy is a Photon relationship memory agent that helps you remember and refind people you met by watching for new contacts during approved event windows and asking you to add human context.

## Skeptical MVP Choice

Build the event-window memory loop first, not a CRM, social graph, or full contact manager.

The MVP should prove one thing: after a real event, can a user later recover the right person from a vague memory fragment? If that does not work, native integrations and richer profile cards will not matter.

## First User

The first user is a Photon residency or event participant who meets several people in a short period, adds some of them to phone contacts, and later remembers context better than names.

Do not start with event organizers. Organizers want directory workflows and attendee operations. Friendy is initially a personal memory agent.

## Core Job

The painful moment is: "I know I met someone, I remember the situation or what they were building, but I cannot remember their name or where I saved them."

Examples:

- "Who was the AI recruiting founder from Photon dinner?"
- "Who was playing piano at the event around 10 PM?"
- "Who did I meet at the residency who was working on agents?"

## V1 Product Loop

1. Friendy sees a calendar event.
2. Photon asks whether to track new contacts during the event window.
3. The user approves.
4. The app snapshots contacts before the window and compares after the window.
5. New contacts become pending candidates.
6. Photon asks the user to confirm each candidate.
7. The user adds lightweight context in natural language.
8. Later, the user texts Photon a vague query.
9. Photon returns likely matches, reasons, and contact actions.

## Explicit Non-Goals

- Do not read iMessage.
- Do not scrape Instagram, LinkedIn, X, or websites.
- Do not use face recognition.
- Do not build a full CRM.
- Do not build an enterprise relationship intelligence product.
- Do not build a multi-event social network.
- Do not auto-save people without user approval.
- Do not require the user to manually create a Photon event card for V1.

## Minimum Useful Person Memory

Required:

- Display name
- At least one contact method or contact label
- Event title or manually confirmed event context
- Detected time
- User-confirmed status
- User-added context note

Optional:

- Company or school
- Project
- Tags
- Website
- Social profile URL
- Photo
- Follow-up status

## Privacy And Consent

Friendy should feel like personal memory, not surveillance.

Guardrails:

- Ask before tracking any event window.
- Ask before saving any person as a memory.
- Show the data source for each candidate, such as "new phone contact after Photon Residency Dinner."
- Let the user edit notes.
- Let the user ignore candidates.
- Let the user delete saved memories.
- Keep user notes private by default.
- Avoid claiming certainty when the match is weak.

## Search Strategy

V1 can use deterministic fuzzy matching.

Search over:

- Person name
- Event title
- Event location
- Contact label
- User note
- Extracted tags
- Detected time

Ranking:

- User-added notes should carry the most weight.
- Event title and event time should come next.
- Name and contact metadata should help but should not dominate.
- If confidence is low, return a short list instead of pretending certainty.

Embeddings can come later, after the capture loop is validated.

## Future Features

- Voice context capture after the event.
- Image input for place, badge, menu, table, or whiteboard context.
- Forwarded profile links from Instagram, LinkedIn, X, or websites.
- Follow-up message drafts using saved context.
- Native iOS Contacts and Calendar companion app.
- Photon/Spectrum messaging surface across SMS, iMessage-like chat, WhatsApp, Slack, and web chat.
