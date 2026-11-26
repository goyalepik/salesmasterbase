import Link from "next/link";

/** Shown until the Sales feed tab exists in the live copy sheet. */
export function SalesFeedMissing({ detail }: { detail?: string }) {
  return (
    <div className="hq-card" style={{ marginBottom: 16 }}>
      <h3 style={{ fontSize: 16, fontWeight: 600 }}>One step left: connect the Sales Masterbase</h3>
      <p className="hq-note" style={{ marginTop: 6 }}>
        In the sheet <b>EPIK CD tracking feed (live copy of SMB)</b>, add a tab named <b>Sales feed</b> and put this in cell A1 (paste the Sales Masterbase link in the quotes):
      </p>
      <code style={{ display: "block", marginTop: 8, padding: "10px 12px", borderRadius: 12, background: "var(--soft)", fontSize: 12.5, overflowX: "auto", whiteSpace: "nowrap" }}>=IMPORTRANGE(&quot;Sales Masterbase link&quot;,&quot;Sales Tracker!A1:CJ&quot;)</code>
      <p className="hq-note" style={{ marginTop: 8 }}>The dashboard finds it by name within 2 minutes. {detail ? `(${detail})` : ""} <Link href="/hq/admin" className="underline">Sources</Link></p>
    </div>
  );
}
