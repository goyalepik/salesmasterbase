import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight, Download } from "lucide-react";
import { backupNowAction, checkShopifyAction } from "@/app/actions/ops";
import { ActionForm, SubmitButton } from "@/components/ops/action-form";
import { assistantStatus } from "@/lib/ai/runtime";
import { readBackupMark } from "@/lib/backup";
import { readEnv } from "@/lib/env";
import { isoDateInIst } from "@/lib/format";
import { getOpsStore } from "@/lib/ops";
import { isAdmin } from "@/lib/ops-ui/actor";
import { requestNow, shortWhen } from "@/lib/ops-ui/format";
import { shopifyConfigFromEnv } from "@/lib/shopify/client";

export const dynamic = "force-dynamic";

type Tone = "good" | "warn" | "bad";
type Check = { tone: Tone; text: string; fix?: string };

/** The whole system on one page, in the order of the notebook: Sales → RevOps → Inventory → Logistics, then the notes. */
export default async function SystemPage() {
  if (!(await isAdmin())) redirect("/");
  const store = await getOpsStore();
  const env = readEnv();
  const shopify = shopifyConfigFromEnv();
  const now = requestNow();
  const ago = (iso: string | null) => {
    if (!iso) return null;
    const minutes = Math.max(0, Math.round((now - Date.parse(iso)) / 60_000));
    return minutes < 1 ? "just now" : minutes < 120 ? `${minutes} min ago` : minutes < 2880 ? `${Math.round(minutes / 60)} h ago` : shortWhen(iso);
  };

  let dbOk = true;
  let counts = { payment: 0, inventory: 0, stock: 0, dispatch: 0, out: 0 };
  let latePos = 0;
  let people = 0;
  let withRoles = 0;
  let shopifyAt: string | null = null;
  let shopifyErr: string | null = null;
  let backupKey: string | null = null;
  let backupErr: string | null = null;
  try {
    if (!store) throw new Error("no store");
    const [p, i, s, d, o, pos, team, a, e, b, be] = await Promise.all([
      store.listOrders({ stage: "awaiting_payment", limit: 1 }),
      store.listOrders({ stage: "awaiting_inventory", limit: 1 }),
      store.listOrders({ stage: "awaiting_stock", limit: 1 }),
      store.listOrders({ stage: "ready_to_dispatch", limit: 1 }),
      store.listOrders({ stage: "out_for_delivery", limit: 1 }),
      store.listPurchaseOrders({ status: "open" }),
      store.people(),
      store.lastClaimAt("shopify-sync-ok:"),
      store.lastClaimAt("shopify-sync-error:"),
      store.lastClaimKey("backup-ok:"),
      store.lastClaimAt("backup-error:"),
    ]);
    counts = { payment: p.total, inventory: i.total, stock: s.total, dispatch: d.total, out: o.total };
    const today = isoDateInIst(new Date(now));
    latePos = new Set(pos.filter((x) => x.eta && x.eta < today).map((x) => x.poNumber)).size;
    people = team.length;
    withRoles = team.filter((x) => x.roles.length).length;
    shopifyAt = a;
    shopifyErr = e && (!a || e > a) ? e : null;
    backupKey = b;
    backupErr = be;
  } catch {
    dbOk = false;
  }
  const backup = readBackupMark(backupKey);
  const ai = assistantStatus();
  const mode = shopify?.slackSales ?? "off";

  const sales: Check[] = [
    env.slackBotToken ? { tone: "good", text: "Slack → Dashboard: on" } : { tone: "bad", text: "Slack → Dashboard: off", fix: "Add SLACK_BOT_TOKEN in Vercel." },
    { tone: "good", text: "Dashboard New order → Dashboard: on" },
    !shopify
      ? { tone: "bad", text: "Shopify not connected", fix: "Add the Shopify keys in Vercel." }
      : mode === "off"
        ? { tone: "warn", text: "Slack and Dashboard → Shopify: off", fix: "Set SHOPIFY_SLACK_SALES to order (or draft) in Vercel." }
        : { tone: "good", text: `Slack and Dashboard → Shopify: ${mode === "order" ? "real #PIK order" : "draft"}` },
    !shopify?.importFrom
      ? { tone: "warn", text: "Website → Dashboard: off", fix: "Set SHOPIFY_IMPORT_FROM (a start date) in Vercel." }
      : shopifyErr
        ? { tone: "bad", text: `Website → Dashboard: last check failed ${ago(shopifyErr)}` }
        : { tone: shopifyAt && now - Date.parse(shopifyAt) < 3_600_000 ? "good" : "warn", text: `Website → Dashboard: checked ${ago(shopifyAt) ?? "never"}`, fix: shopifyAt ? undefined : "Open Payments once, or set up the scheduled check." },
  ];
  const steps = [
    { title: "Sales", href: "/sales", checks: sales },
    { title: "RevOps", href: "/revops", checks: [{ tone: counts.payment > 20 ? "warn" : "good", text: `${counts.payment} waiting for a payment check` } as Check, { tone: "good", text: "Part paid and full paid are both checked" } as Check] },
    { title: "Inventory", href: "/inventory", checks: [{ tone: counts.inventory > 20 ? "warn" : "good", text: `${counts.inventory} new orders to decide` } as Check, { tone: "good", text: `${counts.stock} waiting for stock` } as Check, { tone: latePos ? "warn" : "good", text: latePos ? `${latePos} warehouse POs late` : "Warehouse POs on time" } as Check] },
    { title: "Logistics", href: "/dispatch", checks: [{ tone: "good", text: `${counts.dispatch} ready to dispatch` } as Check, { tone: "good", text: `${counts.out} out for delivery` } as Check] },
  ];

  const cronSet = (process.env.CRON_SECRET?.trim().length ?? 0) >= 16;
  const notes = [
    {
      title: "Backup",
      checks: [
        backup
          ? { tone: now - Date.parse(backup.at) < 36 * 3_600_000 ? "good" : "warn", text: `Last backup ${ago(backup.at)}: ${backup.rows.toLocaleString("en-IN")} rows, ${backup.kb} KB` }
          : { tone: "bad", text: "No backup yet", fix: "Press Back up now." },
        cronSet ? { tone: "good", text: "Daily backup at 2 am" } : { tone: "bad", text: "Daily backup not scheduled", fix: "Add CRON_SECRET (any long random text) in Vercel, then Redeploy." },
        ...(backupErr && (!backup || backupErr > backup.at) ? [{ tone: "bad", text: `Last backup failed ${ago(backupErr)}` }] : []),
      ] as Check[],
      action: (
        <div className="flex flex-wrap gap-2">
          <ActionForm action={backupNowAction}><SubmitButton tone="quiet" small>Back up now</SubmitButton></ActionForm>
          {backup ? <a href="/api/backup/latest" className="btn-quiet inline-flex h-9 items-center gap-1.5 rounded-[14px] px-3 text-[13px]"><Download size={14} /> Download latest</a> : null}
        </div>
      ),
    },
    {
      title: "AI bot and MCP",
      checks: [
        ai.provider === "anthropic" ? { tone: "good", text: `AI: Claude (${ai.model})` } : ai.provider === "openai" ? { tone: "warn", text: "AI: OpenAI (backup)", fix: "Add ANTHROPIC_API_KEY for Claude." } : { tone: "bad", text: "AI: off", fix: "Add ANTHROPIC_API_KEY in Vercel." },
        env.mcpToken ? { tone: "good", text: "MCP: on (sees orders, payments, stock in and out, POs, deliveries)" } : { tone: "warn", text: "MCP: off", fix: "Add MCP_TOKEN (any long random text) in Vercel." },
      ] as Check[],
    },
    {
      title: "Logins by role",
      checks: [
        withRoles ? { tone: "good", text: `${withRoles} people sign in with their own code` } : { tone: "warn", text: "Everyone uses the main code", fix: "Settings → Team roles: add each person and give them their code." },
        { tone: people ? "good" : "warn", text: people ? "Buttons check each person's role" : "Roles off: everyone can press everything" },
      ] as Check[],
      action: <Link href="/settings#team" className="inline-flex items-center gap-1 text-[13px] font-medium text-info">Team roles <ArrowRight size={13} /></Link>,
    },
    {
      title: "Does not crash",
      checks: [
        dbOk ? { tone: "good", text: "Database answering" } : { tone: "bad", text: "Database not answering", fix: "Check Supabase is up and the keys are right." },
        { tone: "good", text: "A failed page shows Try again; Slack, Shopify or AI being down never undoes a change" },
      ] as Check[],
      action: shopify ? <ActionForm action={checkShopifyAction}><SubmitButton tone="quiet" small>Check Shopify now</SubmitButton></ActionForm> : null,
    },
  ];

  return (
    <section className="sy">
      <header className="sy-head">
        <h1>The system</h1>
        <p>Every step and every safety net, live. Green is fine; amber or red says the one thing to do.</p>
      </header>
      <ol className="sy-flow">
        {steps.map((step, i) => (
          <li key={step.title} className="sy-step">
            <Link href={step.href} className="sy-step-title"><span>{i + 1}</span> {step.title}</Link>
            <CheckList checks={step.checks} />
          </li>
        ))}
      </ol>
      <h2 className="sy-h2">Notes</h2>
      <div className="sy-notes">
        {notes.map((note) => (
          <section key={note.title} className="sy-note">
            <h3>{note.title}</h3>
            <CheckList checks={note.checks} />
            {note.action ? <div className="mt-2">{note.action}</div> : null}
          </section>
        ))}
      </div>
    </section>
  );
}

function CheckList({ checks }: { checks: Check[] }) {
  return (
    <ul className="sy-checks">
      {checks.map((c) => (
        <li key={c.text} className={`is-${c.tone}`}>
          <span className="sy-dot" aria-hidden="true" />
          <span>
            {c.text}
            {c.fix ? <span className="sy-fix">{c.fix}</span> : null}
          </span>
        </li>
      ))}
    </ul>
  );
}
