#!/usr/bin/env bash
# Friendy fix stack PR 1-10 status (read-only).
# Invoke: npm run friendy:stack-status
set -euo pipefail

ROOT="${1:-.}"
cd "$ROOT"

spec() { [[ -f "docs/superpowers/specs/$1" ]] && echo "yes" || echo "no"; }
plan() { [[ -f "docs/superpowers/plans/$1" ]] && echo "yes" || echo "no"; }
file_exists() { [[ -f "$1" ]]; }
wired() { grep -q "$2" "$1" 2>/dev/null; }

if file_exists "src/relationship/evals/agentEvalRunner.ts"; then M1=yes; else M1=no; fi
if grep -q 'list_people' src/relationship/tools.ts 2>/dev/null; then M2=yes; else M2=no; fi
if file_exists "src/relationship/routePolicyValidator.ts" && grep -q 'validateRoutePolicy' src/relationship/routePolicyValidator.ts 2>/dev/null; then M3=yes; else M3=no; fi
if file_exists "src/relationship/routerInputEnvelope.ts"; then M4=yes; else M4=no; fi

if file_exists "src/relationship/pendingReminderPolicy.ts" && wired "src/relationship/interpretedAgent.ts" "decidePendingReminder"; then
  M5=yes
elif file_exists "src/relationship/pendingReminderPolicy.ts"; then
  M5=prep
else
  M5=no
fi

if file_exists "src/relationship/personIdentity.ts" && wired "src/relationship/sqliteRepository.ts" "personId"; then
  M6=yes
elif file_exists "src/relationship/personIdentity.ts"; then
  M6=prep
else
  M6=no
fi

if file_exists "src/relationship/memoryTargetLookup.ts" && wired "src/relationship/tools.ts" "lookupMemoryTarget"; then
  M7=yes
elif file_exists "src/relationship/memoryTargetLookup.ts"; then
  M7=prep
else
  M7=no
fi

if file_exists "src/relationship/runtime/normalizeSensorEvent.ts"; then M8=yes; else M8=no; fi
M9=partial
if file_exists "src/relationship/conversationSession.ts"; then M10=yes; else M10=no; fi

status_for() {
  local s=$1 p=$2 m=$3
  if [[ "$m" == "yes" ]]; then echo "done"
  elif [[ "$m" == "prep" ]]; then echo "prep"
  elif [[ "$m" == "partial" ]]; then echo "partial"
  elif [[ "$s" == "yes" && "$p" == "yes" ]]; then echo "plan ready"
  elif [[ "$s" == "yes" ]]; then echo "spec only"
  else echo "missing"
  fi
}

printf '\nFriendy fix stack (PR 1-10)\n\n'
printf '%-4s %-34s %-5s %-5s %-12s\n' 'PR' 'Name' 'Spec' 'Plan' 'Status'
printf '%-4s %-34s %-5s %-5s %-12s\n' '----' '----------------------------------' '-----' '-----' '------------'

rows=(
  "1|Regression freeze|2026-05-23-friendy-regression-freeze-design.md|2026-05-23-friendy-regression-freeze-tests.md|$M1"
  "2|list_people tool|2026-05-23-friendy-list-people-tool-design.md|2026-05-23-friendy-list-people-tool.md|$M2"
  "3|Structured intent router|2026-05-23-structured-intent-router-design.md|2026-05-23-structured-intent-router.md|$M3"
  "4|Pass state into LLM router|2026-05-23-pass-state-into-llm-router-design.md|2026-05-23-pass-state-into-llm-router.md|$M4"
  "5|Pending reminder policy|2026-05-23-pending-reminder-policy-design.md|2026-05-23-pending-reminder-policy.md|$M5"
  "6|Identity resolution|2026-05-23-identity-resolution-design.md|2026-05-23-identity-resolution.md|$M6"
  "7|Robust delete/update|2026-05-23-robust-delete-update-design.md|2026-05-23-robust-delete-update.md|$M7"
  "8|Sensor normalization ack|2026-05-23-sensor-normalization-ack-lifecycle-design.md|2026-05-23-sensor-normalization-ack-lifecycle.md|$M8"
  "9|Strict-mode dogfooding trace|2026-05-23-strict-mode-dogfooding-trace-design.md|2026-05-23-strict-mode-dogfooding-trace.md|$M9"
  "10|Durable conversation session|2026-05-23-durable-conversation-session-design.md|2026-05-23-durable-conversation-session.md|$M10"
)

for row in "${rows[@]}"; do
  IFS='|' read -r pr name sfile pfile marker <<< "$row"
  s=$(spec "$sfile")
  p=$(plan "$pfile")
  st=$(status_for "$s" "$p" "$marker")
  printf '%-4s %-34s %-5s %-5s %-12s\n' "$pr" "$name" "$s" "$p" "$st"
done

printf '\n'
