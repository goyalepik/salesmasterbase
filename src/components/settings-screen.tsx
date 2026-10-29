import { PageHeader, TextButton } from "@/components/ui";
import { formatDateTime } from "@/lib/format";
import type { HealthReport } from "@/lib/health";

function stateLabel(value: string): string {
  const labels: Record<string, string> = {
    reachable: "Reachable",
    configured: "Configured",
    not_configured: "Not configured",
    unreachable: "Unreachable",
    disabled: "Not connected",
    ready: "Ready",
    set: "Set",
    missing_secret: "Missing secret",
  };
  return labels[value] ?? value;
}

function namesNote(status: string, count: string): string | null {
  if (status === "missing_scope") return "Slack refused users.info. Add the users:read bot scope, reinstall the app, then refresh names again.";
  if (status === "no_token") return "SLACK_BOT_TOKEN is not set, so display names cannot be loaded.";
  if (status === "updated") return `Stored display names for ${count || "0"} Slack members.`;
  if (status === "none") return "No new display names were returned. Members who already have a name were left as they are.";
  if (status === "unavailable") return "Names can be refreshed after the workspace is ready.";
  return null;
}

export function SettingsScreen({ health, namesStatus = "", namesCount = "" }: { health: HealthReport; namesStatus?: string; namesCount?: string }) {
  const rows: Array<[string, string, string]> = [
    ["Application mode", health.modeLabel, health.modeLabel === "Demo" ? "Sample data only. Live messages are not mixed in." : "Live reads the database. Missing setup does not fall back to demo data."],
    ["Slack signing secret", health.slackSigning === "configured" ? "Present" : "Missing", "A present secret is not the same as a verified Slack delivery. The value is not shown."],
    ["Slack event receipt", health.facts?.lastEventAt ? (health.modeLabel === "Demo" ? "Sample timestamp only" : "At least one event is stored") : "No stored event", "Delivery is confirmed only by a stored row, not by this page calling Slack."],
    ["Slack ingestion", health.ingestion === "ready" ? "Endpoint can verify signatures" : health.ingestion === "disabled" ? "Disabled" : "Blocked", health.ingestion === "disabled" ? "Set APP_MODE=live after the other required values are in place." : "The endpoint is /api/slack/events. Ready means the signing secret is present."],
    ["OpenAI", health.openaiConfigured ? `Key present (${health.openaiModel})` : "Not configured", "The key is not shown. This page does not call the model, so a successful completion is not claimed here."],
    ["Live updates", health.modeLabel === "Demo" ? "Not subscribed" : health.database === "reachable" ? "Server stream is available after sign-in" : "Waiting on the database", "The header shows whether this browser is connected. A secret does not mean the stream is up."],
    ["Slack bot token", health.slackBotToken ? "Present" : "Missing", "Used for display names and history import. The token is not shown."],
    ["Slack display names", "users:read", "Add the users:read bot scope and reinstall the Slack app. Until a name is stored, the inbox shows the Slack user id."],
    ["Monitored channel", health.slackChannelId ?? "Not set", health.slackChannelName ? `Display name ${health.slackChannelName}. Other channels are stored and skipped.` : "If empty, every message event is parsed. Set SLACK_CHANNEL_ID before live use."],
    ["Dashboard access code", health.accessCode === "set" ? "Set" : health.accessCode === "not_required" ? "Not required in demo" : "Missing", "Required in live mode. Minimum 8 characters. The code is not shown."],
    ["Database", stateLabel(health.database), health.databaseDetail],
    ["Anon key", health.anonKeyPresent ? "Present, unused by the browser" : "Not set", "The dashboard does not query Supabase from the browser."],
    ["Latest stored event", formatDateTime(health.facts?.lastEventAt ?? null), health.modeLabel === "Demo" ? "Sample timestamp." : "From slack_messages."],
    ["Latest processing error", health.facts?.lastError?.summary ?? "None", health.facts?.lastError ? formatDateTime(health.facts.lastError.at) : "No failed processing error is stored."],
    ["Pending / failed", health.facts ? `${health.facts.pendingCount} pending, ${health.facts.failedCount} failed` : "—", "Pending means received or processing."],
  ];
  return (
    <section>
      <PageHeader
        title="Settings"
        description="What this process can actually see. Secret values stay on the server."
      />
      <div className="panel-strong overflow-x-auto">
        <table className="w-full min-w-[720px] border-collapse text-left text-[13px]">
          <thead className="text-[12px] text-muted">
            <tr>
              <th className="py-2 pr-3 font-medium">Check</th>
              <th className="py-2 pr-3 font-medium">State</th>
              <th className="py-2 font-medium">Note</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([check, state, note]) => (
              <tr key={check} className="border-t border-line align-top">
                <td className="py-2 pr-3">{check}</td>
                <td className="py-2 pr-3">{state}</td>
                <td className="py-2 text-muted">{note}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <form className="mt-6 flex flex-wrap items-center gap-3" action="/api/slack/names" method="post">
        <TextButton>Refresh Slack names</TextButton>
        <p className="text-[12px] text-muted">Demo mode updates the sample rows in this browser session. Live mode updates stored sender names.</p>
      </form>
      {namesNote(namesStatus, namesCount) ? <p className="mt-3 max-w-2xl text-[13px]">{namesNote(namesStatus, namesCount)}</p> : null}
      <div className="mt-8 max-w-2xl text-[13px] leading-6 text-muted">
        <h2 className="mb-2 text-[13px] font-semibold text-ink">Before the first live message</h2>
        <ol className="list-decimal space-y-2 pl-4">
          <li>Create a Supabase project and run <span className="font-mono text-[12px] text-ink">supabase/migrations/0001_init.sql</span>.</li>
          <li>Put the project URL and service-role key in <span className="font-mono text-[12px] text-ink">.env.local</span>. Do not put the service-role key in a public variable.</li>
          <li>In the Slack app, set the Events API request URL to <span className="font-mono text-[12px] text-ink">https://your-host/api/slack/events</span> and copy the signing secret.</li>
          <li>Subscribe the bot to <span className="font-mono text-[12px] text-ink">message.channels</span> and invite it to <span className="font-mono text-[12px] text-ink">#epik_cd-payment-updates</span>.</li>
          <li>Create the slash command <span className="font-mono text-[12px] text-ink">/sale</span> with request URL <span className="font-mono text-[12px] text-ink">https://salesmasterbase.vercel.app/api/slack/commands</span>. Set Interactivity to <span className="font-mono text-[12px] text-ink">https://salesmasterbase.vercel.app/api/slack/interactivity</span>. Add the <span className="font-mono text-[12px] text-ink">chat:write</span> bot scope and reinstall the app.</li>
          <li>Set <span className="font-mono text-[12px] text-ink">OPENAI_API_KEY</span> only if you want the assistant. The dashboard still loads without it. Optional <span className="font-mono text-[12px] text-ink">OPENAI_MODEL</span> defaults to gpt-4o-mini.</li>
          <li>Set <span className="font-mono text-[12px] text-ink">DASHBOARD_ACCESS_CODE</span>, then set <span className="font-mono text-[12px] text-ink">APP_MODE=live</span> and restart. Live mode without that code refuses every page.</li>
        </ol>
        <p className="mt-4">A signing secret, a reachable database, and a stored Slack event are three different states. OpenAI is not marked ready until a question returns a model-written answer.</p>
      </div>
    </section>
  );
}
