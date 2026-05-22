import { Spectrum } from "spectrum-ts";
import { imessage } from "spectrum-ts/providers/imessage";
import { readSpectrumCredentials } from "../env";
import type { RuntimePromptSender } from "../runtime/friendyRuntime";

export type SpectrumPromptSender = RuntimePromptSender & {
  kind: "spectrum";
};

export type SpectrumImessageClient = {
  user(phoneNumber: string): Promise<unknown> | unknown;
  space(user: unknown): Promise<SpectrumPromptSpace> | SpectrumPromptSpace;
};

type SpectrumPromptSpace = {
  id?: string;
  send(text: string): Promise<unknown> | unknown;
};

export type CreateSpectrumPromptSenderInput = {
  toPhone: string;
  imessageClient: SpectrumImessageClient;
  now?: () => string;
};

export type CreateLiveSpectrumPromptSenderInput = {
  env?: Partial<NodeJS.ProcessEnv>;
  now?: () => string;
};

export function resolveSpectrumPromptRecipient(env: Partial<NodeJS.ProcessEnv>): string {
  const recipient = env.FRIENDY_PROMPT_TO_PHONE?.trim() || env.FRIENDY_OWNER_PHONE?.trim();
  if (!recipient) {
    throw new Error("Spectrum prompt delivery requires FRIENDY_PROMPT_TO_PHONE or FRIENDY_OWNER_PHONE.");
  }

  return recipient;
}

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
    if (!spacePromise) {
      spacePromise = Promise.resolve(imessageClient.user(toPhone)).then((user) => imessageClient.space(user));
    }

    return spacePromise;
  }
}

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

function sanitizeInteractionTime(value: string): string {
  return value.replace("T", "").replace(/[^0-9a-z]/gi, "");
}
