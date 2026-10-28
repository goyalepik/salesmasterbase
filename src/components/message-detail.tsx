import Link from "next/link";
import { ExceptionLabel, PageHeader, ReviewText, SeverityText, TextButton } from "@/components/ui";
import { formatDateTime, formatInrFromMinor, senderLabel } from "@/lib/format";
import { EXCEPTION_LABELS, STATUS_LABELS, type MessageDetail } from "@/lib/types";

const INTENT: Record<string, string> = {
  payment_mention: "Payment mention",
  order_update: "Order update",
  unclassified: "Unclassified",
};

export function MessageDetailScreen({ detail }: { detail: MessageDetail }) {
  const extraction = detail.extraction;
  const canRetry = detail.processingStatus === "failed" && detail.retryCount < 5;
  return (
    <article>
      <p className="mb-3 text-[12px]"><Link href="/inbox" className="text-accent">Back to inbox</Link></p>
      <PageHeader
        title="Message"
        description="The Slack text is stored as it arrived. Extracted fields sit beside it and stay marked unverified."
        action={canRetry ? (
          <form action={`/api/messages/${detail.id}/retry`} method="post">
            <TextButton>Retry processing</TextButton>
          </form>
        ) : null}
      />
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1.15fr)_minmax(280px,0.85fr)]">
        <section>
          <h2 className="mb-2 text-[13px] font-semibold">Original message</h2>
          <pre className="whitespace-pre-wrap border-y border-line bg-paper px-3 py-3 font-sans text-[13px] leading-6">{detail.text}</pre>
          <dl className="mt-4 border-y border-line">
            {[
              ["Channel", detail.slackChannelName ? `${detail.slackChannelName} · ${detail.slackChannelId}` : detail.slackChannelId],
              ["Message timestamp", detail.slackMessageTs],
              ["Sender", `${senderLabel(detail.senderName, detail.senderId)}${detail.senderId ? ` · ${detail.senderId}` : ""}`],
              ["Received", formatDateTime(detail.eventReceivedAt)],
              ["Permalink", detail.permalink],
              ["Subtype", detail.subtype],
              ["Status", STATUS_LABELS[detail.processingStatus]],
              ["Skip reason", detail.skipReason],
              ["Error", detail.processingError],
              ["Attempts that failed", String(detail.retryCount)],
            ].map(([label, value]) => (
              <div key={label} className="grid grid-cols-[9.5rem_minmax(0,1fr)] gap-3 border-t border-line py-2 first:border-t-0">
                <dt className="text-[12px] text-muted">{label}</dt>
                <dd className="text-[13px] break-words">
                  {label === "Permalink" && value ? <a className="text-accent" href={value} target="_blank" rel="noreferrer">{value}</a> : value || "—"}
                </dd>
              </div>
            ))}
          </dl>
        </section>
        <section>
          <h2 className="mb-2 text-[13px] font-semibold">Extracted fields</h2>
          <p className="mb-2 text-[12px] text-muted">Source: {extraction?.extractSource ?? "none"}. Verification: unverified. A human resolution does not verify payment.</p>
          {extraction ? (
            <dl className="border-y border-line">
              {[
                ["Customer", extraction.customerName],
                ["Order reference", extraction.orderReference],
                ["Amount text", extraction.amountText],
                ["Amount read", formatInrFromMinor(extraction.amountMinor)],
                ["Mode mentioned", extraction.paymentModeMention],
                ["Intent", INTENT[extraction.intent] ?? extraction.intent],
                ["Preview", extraction.preview],
                ["Missing", extraction.missingFields.join(", ")],
              ].map(([label, value]) => (
                <div key={label} className="grid grid-cols-[9.5rem_minmax(0,1fr)] gap-3 border-t border-line py-2 first:border-t-0">
                  <dt className="text-[12px] text-muted">{label}</dt>
                  <dd className="text-[13px]">{value || "—"}</dd>
                </div>
              ))}
            </dl>
          ) : <p className="border-y border-line py-4 text-[13px] text-muted">No extraction was stored for this message.</p>}

          <h2 className="mt-6 mb-2 text-[13px] font-semibold">Exceptions</h2>
          {detail.exceptions.length === 0 ? <p className="text-[13px] text-muted">None.</p> : (
            <ul className="border-y border-line">
              {detail.exceptions.map((item) => (
                <li key={item.id} id={`exception-${item.id}`} className="border-t border-line py-3 first:border-t-0">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="text-[13px]"><ExceptionLabel type={item.type} /></p>
                    <p className="text-[12px]"><SeverityText severity={item.severity} /> · {item.status}</p>
                  </div>
                  <p className="mt-1 text-[13px] text-muted">{item.reason}</p>
                  {item.status === "resolved" ? <p className="mt-1 text-[12px] text-muted">Resolved {formatDateTime(item.resolvedAt)} by {item.resolver}. {item.resolutionNote}</p> : null}
                  {item.status === "open" ? (
                    <form className="mt-2 grid gap-2" action={`/api/exceptions/${item.id}/resolve`} method="post">
                      <input type="hidden" name="returnTo" value={`/inbox/${detail.id}`} />
                      <label className="text-[12px] text-muted">
                        Resolution note
                        <textarea required minLength={8} name="note" className="mt-1 min-h-16 w-full rounded-[2px] border border-line bg-paper px-2 py-1.5 text-[13px]" placeholder="What was checked. This does not verify a payment." />
                      </label>
                      <div><TextButton>Mark resolved</TextButton></div>
                    </form>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <div className="mt-8 grid gap-8 lg:grid-cols-2">
        <section>
          <h2 className="mb-2 text-[13px] font-semibold">Processing history</h2>
          {detail.attempts.length === 0 ? <p className="text-[13px] text-muted">No attempts recorded.</p> : (
            <table className="w-full border-collapse text-left text-[13px]">
              <tbody>
                {detail.attempts.map((attempt) => (
                  <tr key={attempt.id} className="border-t border-line">
                    <td className="py-2 pr-3 tabular-nums">#{attempt.attemptNumber}</td>
                    <td className="py-2 pr-3">{attempt.outcome}</td>
                    <td className="py-2 pr-3 text-muted tabular-nums">{formatDateTime(attempt.finishedAt)}</td>
                    <td className="py-2">{attempt.errorSummary ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
        <section>
          <h2 className="mb-2 text-[13px] font-semibold">Audit</h2>
          {detail.audit.length === 0 ? <p className="text-[13px] text-muted">No audit entries for this record.</p> : (
            <ul className="border-y border-line">
              {detail.audit.map((entry) => (
                <li key={entry.id} className="border-t border-line py-2 first:border-t-0">
                  <p className="text-[13px]">{entry.action} · {entry.outcome}</p>
                  <p className="text-[12px] text-muted">{formatDateTime(entry.createdAt)} · {entry.actor}</p>
                  <p className="text-[13px] text-muted">{entry.summary}</p>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
      <p className="mt-6 text-[12px] text-muted">
        Related label: <ReviewText review={detail.processingStatus === "needs_review" ? "required" : detail.processingStatus === "skipped" ? "not_applicable" : "clear"} />.
        Exception types understood here: {Object.values(EXCEPTION_LABELS).join(", ")}.
      </p>
    </article>
  );
}
