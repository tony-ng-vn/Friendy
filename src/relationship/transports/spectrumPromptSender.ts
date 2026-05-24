/**
 * Outbound Spectrum/iMessage prompt sender for the runtime and local-check flows.
 *
 * Sends pre-composed prompt text only; prompt wording and candidate selection belong to
 * `promptPlanner` and ingestion, not this transport adapter.
 */
import { Spectrum } from "spectrum-ts";
import { imessage } from "spectrum-ts/providers/imessage";
import { readSpectrumCredentials } from "../env";
import type { RuntimePromptSender } from "../runtime/friendyRuntime";

/** Runtime prompt sender backed by a Spectrum iMessage space. */
export type SpectrumPromptSender = RuntimePromptSender & {
  kind: "spectrum";
};

/** Injectable Spectrum iMessage client for tests and live wiring. */
export type SpectrumImessageClient = {
  user(phoneNumber: string): Promise<unknown> | unknown;
  space(user: unknown): Promise<SpectrumPromptSpace> | SpectrumPromptSpace;
};

type SpectrumPromptSpace = {
  id?: string;
  send(text: string): Promise<unknown> | unknown;
};

/** Input for constructing a testable Spectrum prompt sender. */
export type CreateSpectrumPromptSenderInput = {
  toPhone: string;
  imessageClient: SpectrumImessageClient;
  now?: () => string;
};

/** Input for constructing a live Spectrum prompt sender from env credentials. */
export type CreateLiveSpectrumPromptSenderInput = {
  env?: Partial<NodeJS.ProcessEnv>;
  now?: () => string;
};

/** Resolves the outbound iMessage recipient from `FRIENDY_PROMPT_TO_PHONE` or `FRIENDY_OWNER_PHONE`. */
export function resolveSpectrumPromptRecipient(env: Partial<NodeJS.ProcessEnv>): string {
  const recipient = env.FRIENDY_PROMPT_TO_PHONE?.trim() || env.FRIENDY_OWNER_PHONE?.trim();
  if (!recipient) {
    throw new Error("Spectrum prompt delivery requires FRIENDY_PROMPT_TO_PHONE or FRIENDY_OWNER_PHONE.");
  }

  return recipient;
}

/** Creates a reusable Spectrum prompt sender that lazily resolves the target iMessage space. */
export function createSpectrumPromptSender({
  toPhone,
  imessageClient,
  now = () => new Date().toISOString()
}: CreateSpectrumPromptSenderInput): SpectrumPromptSender {
  let spacePromise: Promise<{ send(text: string): Promise<unknown> | unknown }> | undefined;

  return {
    kind: "spectrum",
    async sendPrompt(input) {
      const space = await resolveSpace();
      await space.send(input.text);

      return {
        interactionId: `spectrum_prompt_${sanitizeInteractionTime(now())}_${input.candidateId ?? "warning"}`,
        spaceId: typeof space.id === "string" ? space.id : undefined
      };
    }
  };

  async function resolveSpace(): Promise<SpectrumPromptSpace> {
    // Reuse one iMessage space for the process lifetime to avoid repeated Spectrum user lookups.
    if (!spacePromise) {
      spacePromise = Promise.resolve(imessageClient.user(toPhone)).then((user) => imessageClient.space(user));
    }

    return spacePromise;
  }
}

/** Creates a live Spectrum prompt sender using credentials from the process environment. */
export async function createLiveSpectrumPromptSender({
  env = process.env,
  now
}: CreateLiveSpectrumPromptSenderInput = {}): Promise<SpectrumPromptSender> {
  const toPhone = resolveSpectrumPromptRecipient(env);
  const { projectId, projectSecret } = readSpectrumCredentials(env as NodeJS.ProcessEnv);
  const app = await Spectrum({
    projectId,
    projectSecret,
    providers: [imessage.config()]
  });

  const im = imessage(app);
  return createSpectrumPromptSender({
    toPhone,
    imessageClient: {
      user: (phoneNumber) => im.user(phoneNumber),
      space: (user) => im.space(user as never)
    },
    now
  });
}

/** Strips ISO punctuation so interaction ids stay log-safe without embedded separators. */
function sanitizeInteractionTime(value: string): string {
  return value.replace("T", "").replace(/[^0-9a-z]/gi, "");
}
