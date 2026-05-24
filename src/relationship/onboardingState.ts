/**
 * Mac/iMessage onboarding gate shared by chat controls and contact automation.
 *
 * State machine is reduced in-process; production persistence may live elsewhere.
 * Chat phrases like "start" / "pause" map to `detectOnboardingControl`.
 */
export type OnboardingState =
  | "unverified"
  | "verification_sent"
  | "phone_verified"
  | "mac_helper_not_connected"
  | "mac_helper_connected"
  | "permissions_pending"
  | "ready_pending_user_start"
  | "active"
  | "paused"
  | "degraded_contacts_missing"
  | "degraded_calendar_missing"
  | "helper_disconnected";

export type OnboardingEvent =
  | { type: "code_sent" }
  | { type: "phone_verified" }
  | { type: "helper_connected" }
  | { type: "permissions_pending" }
  | { type: "permissions_ready" }
  | { type: "user_started" }
  | { type: "pause" }
  | { type: "resume" }
  | { type: "contacts_missing" }
  | { type: "calendar_missing" }
  | { type: "helper_disconnected" };

export type OnboardingControlAction = "started" | "paused" | "resumed";

export type OnboardingStateControllerOptions = {
  onControlApplied?: (action: OnboardingControlAction, state: OnboardingState) => void;
};

export type OnboardingStateController = {
  getState(): OnboardingState;
  applyControl(action: OnboardingControlAction): OnboardingState;
};

/** Pure transition table for onboarding lifecycle events. */
export function reduceOnboardingState(current: OnboardingState, event: OnboardingEvent): OnboardingState {
  if (event.type === "code_sent" && current === "unverified") {
    return "verification_sent";
  }
  if (event.type === "phone_verified") {
    return "phone_verified";
  }
  if (event.type === "helper_connected") {
    return "mac_helper_connected";
  }
  if (event.type === "permissions_pending") {
    return "permissions_pending";
  }
  if (event.type === "permissions_ready") {
    return "ready_pending_user_start";
  }
  if (event.type === "user_started" && current === "ready_pending_user_start") {
    return "active";
  }
  if (event.type === "pause" && current === "active") {
    return "paused";
  }
  if (event.type === "resume" && current === "paused") {
    return "active";
  }
  if (event.type === "contacts_missing") {
    return "degraded_contacts_missing";
  }
  if (event.type === "calendar_missing") {
    return "degraded_calendar_missing";
  }
  if (event.type === "helper_disconnected") {
    return "helper_disconnected";
  }
  return current;
}

/** Holds the per-process onboarding gate shared by chat controls and contact automation. */
export function createOnboardingStateController(
  initialState: OnboardingState = "ready_pending_user_start",
  options: OnboardingStateControllerOptions = {}
): OnboardingStateController {
  let state = initialState;

  return {
    getState() {
      return state;
    },
    applyControl(action) {
      if (action === "started") {
        state = reduceOnboardingState(state, { type: "user_started" });
      } else if (action === "paused") {
        state = reduceOnboardingState(state, { type: "pause" });
      } else {
        state = reduceOnboardingState(state, { type: "resume" });
      }

      options.onControlApplied?.(action, state);
      return state;
    }
  };
}

/** Whether contact detection may create candidates and send prompts in this state. */
export function isContactAutomationActive(state: OnboardingState): boolean {
  return state === "active" || state === "degraded_calendar_missing";
}

/** Detects lightweight setup control messages before they enter memory interpretation. */
export function detectOnboardingControl(text: string): OnboardingControlAction | undefined {
  const normalized = text.trim().toLowerCase();

  if (/^(start|yes,?\s*start|turn on friendy)$/.test(normalized)) {
    return "started";
  }

  if (/^(pause friendy|pause)$/.test(normalized)) {
    return "paused";
  }

  if (/^(resume friendy|resume)$/.test(normalized)) {
    return "resumed";
  }

  return undefined;
}
