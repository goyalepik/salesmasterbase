import { MemoryOpsStore } from "../src/lib/ops/memory-store";
import { buildDemoSeed } from "../src/lib/ops/demo-seed";
import { loadSeed } from "../src/lib/ops/snapshot";
import type { Person } from "../src/lib/ops/types";
import type { Handled, OpsDeps } from "../src/lib/slack/ops-actions";
import type { SlackClient, SlackResult } from "../src/lib/slack/slack-client";

export const NOW = new Date("2026-10-30T06:00:00Z");
export const SALES_CHANNEL = "CSALES0001";
export const SALESPERSON = "USALES0001";

type Call = { method: keyof SlackClient; args: Record<string, unknown> };

export function fakeSlack() {
  const calls: Call[] = [];
  let seq = 0;
  const record = (method: keyof SlackClient) => async (args: unknown): Promise<SlackResult> => {
    calls.push({ method, args: args as Record<string, unknown> });
    if (method === "postMessage") {
      seq += 1;
      return { ok: true, ts: `1761800000.${String(seq).padStart(6, "0")}` };
    }
    if (method === "getPermalink") {
      const a = args as { channel: string; message_ts: string };
      return { ok: true, permalink: `https://epik.slack.com/archives/${a.channel}/p${a.message_ts.replace(".", "")}` };
    }
    return { ok: true };
  };
  const client: SlackClient = {
    postMessage: record("postMessage"),
    update: record("update"),
    postEphemeral: record("postEphemeral"),
    viewsOpen: record("viewsOpen"),
    getPermalink: record("getPermalink"),
  };
  return {
    client,
    calls,
    of: (method: keyof SlackClient) => calls.filter((c) => c.method === method).map((c) => c.args),
    last: (method: keyof SlackClient) => calls.filter((c) => c.method === method).at(-1)?.args,
    clear: () => calls.splice(0, calls.length),
  };
}

export async function setup(people: Person[] = []) {
  const store = new MemoryOpsStore();
  await loadSeed(store, buildDemoSeed(NOW));
  for (const person of people) await store.upsertPerson(person);
  const slack = fakeSlack();
  const deps: OpsDeps = {
    store,
    slack: slack.client,
    appBaseUrl: "https://ops.example.com",
    teamChannels: { revops: "CREVOPS01", inventory: "CINVENT01", logistics: "CLOGIST01" },
    cardButtons: true,
    now: () => NOW,
  };
  return { store, slack, deps };
}

export async function run(handled: Handled) {
  for (const task of handled.later) await task();
}

type Block = { type: string; block_id?: string; element?: Record<string, unknown>; elements?: Array<Record<string, unknown>> };
export type Answer = string | string[] | { value: string; text: string };

/**
 * Builds `view.state.values` the way Slack sends it for a submitted modal: every input block,
 * keyed by block_id then action_id. Unanswered blocks keep their initial value.
 */
export function stateFor(view: { blocks: unknown[] }, answers: Record<string, Answer>): Record<string, Record<string, unknown>> {
  const values: Record<string, Record<string, unknown>> = {};
  for (const raw of view.blocks as Block[]) {
    if (raw.type !== "input" || !raw.block_id || !raw.element) continue;
    const el = raw.element as Record<string, unknown> & { type: string; action_id: string };
    const answer = answers[raw.block_id];
    let state: Record<string, unknown>;
    switch (el.type) {
      case "plain_text_input":
        state = { type: el.type, value: typeof answer === "string" ? answer : ((el.initial_value as string | undefined) ?? null) };
        break;
      case "static_select": {
        const options = el.options as Array<{ value: string; text: { text: string } }>;
        const chosen = typeof answer === "string" ? options.find((o) => o.value === answer) : (el.initial_option as { value: string } | undefined);
        if (typeof answer === "string" && !chosen) throw new Error(`No option ${answer} in ${raw.block_id}`);
        state = { type: el.type, selected_option: chosen ?? null };
        break;
      }
      case "external_select": {
        const pick = answer && typeof answer === "object" && !Array.isArray(answer) ? answer : null;
        state = { type: el.type, selected_option: pick ? { text: { type: "plain_text", text: pick.text }, value: pick.value } : null };
        break;
      }
      case "datepicker":
        state = { type: el.type, selected_date: typeof answer === "string" ? answer : ((el.initial_date as string | undefined) ?? null) };
        break;
      case "checkboxes": {
        const options = el.options as Array<{ value: string }>;
        const chosen = Array.isArray(answer) ? options.filter((o) => answer.includes(o.value)) : ((el.initial_options as unknown[] | undefined) ?? []);
        state = { type: el.type, selected_options: chosen };
        break;
      }
      default:
        throw new Error(`Unhandled element ${el.type}`);
    }
    values[raw.block_id] = { [el.action_id]: state };
  }
  return values;
}

/** All interactive elements of a message, with the block they live in. */
export function elementsOf(blocks: unknown[]): Array<{ blockId: string; el: Record<string, unknown> }> {
  const out: Array<{ blockId: string; el: Record<string, unknown> }> = [];
  for (const block of blocks as Block[]) {
    if (block.type !== "actions") continue;
    for (const el of block.elements ?? []) out.push({ blockId: block.block_id ?? "", el });
  }
  return out;
}

let actionSeq = 0;

/** A block_actions payload for tapping a button (or picking an overflow option) on a card. */
export function tap(blocks: unknown[], actionId: string, opts: { blockId?: string; option?: string; user?: string; actionTs?: string } = {}) {
  const found = elementsOf(blocks).find((e) => e.el.action_id === actionId && (!opts.blockId || e.blockId === opts.blockId));
  if (!found) throw new Error(`No ${actionId} in ${opts.blockId ?? "card"}`);
  actionSeq += 1;
  const action: Record<string, unknown> = { action_id: actionId, block_id: found.blockId, type: found.el.type, action_ts: opts.actionTs ?? `1761800100.${actionSeq}` };
  if (found.el.type === "overflow") {
    const options = found.el.options as Array<{ value: string; text: { text: string } }>;
    const option = options.find((o) => o.text.text === opts.option);
    if (!option) throw new Error(`No overflow option ${opts.option}`);
    action.selected_option = option;
  } else {
    action.value = found.el.value;
  }
  return {
    type: "block_actions",
    trigger_id: `trigger-${actionSeq}`,
    user: { id: opts.user ?? "UOPS00001", username: "riya", name: "riya" },
    channel: { id: SALES_CHANNEL },
    container: { type: "message", channel_id: SALES_CHANNEL, message_ts: "1761800000.000001" },
    actions: [action],
  };
}

let viewSeq = 0;

export function submission(view: Record<string, unknown>, answers: Record<string, Answer>, opts: { user?: string; viewId?: string } = {}) {
  viewSeq += 1;
  return {
    type: "view_submission",
    user: { id: opts.user ?? "UOPS00001", username: "riya", name: "riya" },
    view: {
      id: opts.viewId ?? `V${viewSeq}`,
      callback_id: view.callback_id as string,
      private_metadata: view.private_metadata as string,
      state: { values: stateFor(view as { blocks: unknown[] }, answers) },
    },
  };
}
