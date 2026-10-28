import { z } from "zod";

const nestedMessageSchema = z
  .object({
    ts: z.string().optional(),
    text: z.string().optional(),
    user: z.string().optional(),
  })
  .passthrough();

export const slackEnvelopeSchema = z
  .object({
    type: z.string(),
    challenge: z.string().optional(),
    team_id: z.string().optional(),
    event_id: z.string().optional(),
    event_time: z.number().optional(),
    event: z
      .object({
        type: z.string(),
        subtype: z.string().optional(),
        channel: z.string().optional(),
        user: z.string().optional(),
        bot_id: z.string().optional(),
        text: z.string().optional(),
        ts: z.string().optional(),
        thread_ts: z.string().optional(),
        event_ts: z.string().optional(),
        message: nestedMessageSchema.optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

export type SlackEnvelope = z.infer<typeof slackEnvelopeSchema>;

export function sourceMetadata(envelope: SlackEnvelope): Record<string, unknown> {
  return {
    team_id: envelope.team_id ?? null,
    event_id: envelope.event_id ?? null,
    event_time: envelope.event_time ?? null,
    event_type: envelope.event?.type ?? null,
    subtype: envelope.event?.subtype ?? null,
    channel: envelope.event?.channel ?? null,
    ts: envelope.event?.ts ?? envelope.event?.message?.ts ?? null,
    user: envelope.event?.user ?? envelope.event?.message?.user ?? null,
  };
}

export function slackPermalink(channelId: string, ts: string): string {
  return `https://slack.com/archives/${channelId}/p${ts.replace(".", "")}`;
}
