import { readFileSync } from "node:fs";
import { createHmac } from "node:crypto";

function readEnvFile(path: string): Record<string, string> {
  try {
    const values: Record<string, string> = {};
    for (const line of readFileSync(path, "utf8").split("\n")) {
      const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (!match) continue;
      values[match[1]!] = match[2]!.replace(/^['"]|['"]$/g, "");
    }
    return values;
  } catch {
    return {};
  }
}

const env = { ...readEnvFile(".env"), ...readEnvFile(".env.local"), ...process.env };
const secret = env.SLACK_SIGNING_SECRET?.trim();
if (!secret) {
  console.error("Set SLACK_SIGNING_SECRET in .env.local before generating a signed fixture.");
  process.exit(1);
}

const body = JSON.stringify({
  type: "event_callback",
  team_id: "T00000000",
  event_id: `EvFixture${Date.now()}`,
  event_time: Math.floor(Date.now() / 1000),
  event: {
    type: "message",
    channel: env.SLACK_CHANNEL_ID?.trim() || "C00000000",
    user: "U00000000",
    text: "Customer: Sample Person. Order DEMO-1006. UPI ₹22,000.",
    ts: `${Math.floor(Date.now() / 1000)}.000100`,
  },
});
const timestamp = String(Math.floor(Date.now() / 1000));
const signature = `v0=${createHmac("sha256", secret).update(`v0:${timestamp}:${body}`).digest("hex")}`;

console.log(`curl -sS -D - http://localhost:3000/api/slack/events \\
  -H 'content-type: application/json' \\
  -H 'x-slack-request-timestamp: ${timestamp}' \\
  -H 'x-slack-signature: ${signature}' \\
  --data '${body.replaceAll("'", "'\\''")}'`);
