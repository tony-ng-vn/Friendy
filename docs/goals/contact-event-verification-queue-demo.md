# Contact Event Verification Queue Demo Transcript

Command:

```bash
npm exec tsx -- -e "import { buildCandidateReviewPrompt, createRelationshipAgent } from './src/relationship/agentCore.ts'; import { demoDetectedContact, demoLongEvent, demoShortEvent, demoUser } from './src/relationship/fixtures.ts'; import { createRelationshipRepository } from './src/relationship/repository.ts'; import { createRelationshipTools } from './src/relationship/tools.ts'; const repo = createRelationshipRepository({ users: [demoUser], calendarEvents: [demoLongEvent, demoShortEvent] }); const tools = createRelationshipTools(repo); const candidate = tools.create_contact_candidate(demoDetectedContact); const matches = tools.list_candidate_event_matches(demoUser.id, candidate.id); const pendingBefore = tools.list_pending_candidates(demoUser.id).map((item) => item.displayName).join(', '); const agent = createRelationshipAgent(tools); const prompt = buildCandidateReviewPrompt(candidate.displayName, matches[0]?.eventTitle); const confirm = agent.handleMessage({ userId: demoUser.id, platform: 'terminal', text: 'yes, actually at Photon Residency, recruiting agents, played piano', receivedAt: '2026-05-20T12:00:00.000Z' }); const search = agent.handleMessage({ userId: demoUser.id, platform: 'terminal', text: 'who was the recruiting agents person from Photon?', receivedAt: '2026-05-20T12:05:00.000Z' }); console.log(['Detected contact: ' + candidate.displayName + ' at ' + candidate.detectedAt, 'Event guesses: ' + matches.map((match) => match.rank + '. ' + match.eventTitle).join(' | '), 'Pending queue before confirmation: ' + pendingBefore, 'Friendy: ' + prompt, 'User: yes, actually at Photon Residency, recruiting agents, played piano', 'Friendy: ' + confirm.outbound.text, 'Saved memory event: ' + repo.listMemories(demoUser.id)[0].eventTitle, 'Pending queue after confirmation: ' + tools.list_pending_candidates(demoUser.id).length, 'User: who was the recruiting agents person from Photon?', 'Friendy: ' + search.outbound.text].join('\n'));"
```

Transcript:

```text
Detected contact: Maya Chen at 2026-05-15T21:42:00-07:00
Event guesses: 1. Photon Residency Dinner | 2. Photon Residency
Pending queue before confirmation: Maya Chen
Friendy: I noticed you added Maya Chen during Photon Residency Dinner. Did you meet Maya Chen there?
User: yes, actually at Photon Residency, recruiting agents, played piano
Friendy: Saved. I'll remember Maya Chen from Photon Residency: recruiting agents, played piano.
Saved memory event: Photon Residency
Pending queue after confirmation: 0
User: who was the recruiting agents person from Photon?
Friendy: I think that was Maya Chen. You told me you met them at Photon Residency, and the clue was recruiting agents, played piano. You can reach them at +15550101020.
```
