import Link from "next/link";
import type { ImsRole } from "../role";
import { ImsShell } from "./shell";

/** When none of the three sheets can be read (links not set yet, or Google down). */
export function ImsUnavailable({ role, current }: { role: ImsRole; current: "overview" | "stock" | "incoming" | "sources" }) {
  return (
    <ImsShell current={current} role={role} readAt={null}>
      <div className="ims-card ims-card-pad" style={{ maxWidth: 560 }}>
        <h2>The sheets can&apos;t be read right now</h2>
        <p className="ims-note" style={{ marginTop: 6 }}>
          Either their links aren&apos;t set yet, or Google didn&apos;t answer. Refresh in a minute.{" "}
          {role === "admin" ? <Link href="/ims/sources" className="underline">Check the sources</Link> : "If it stays like this, ask an admin to check the sources."}
        </p>
      </div>
    </ImsShell>
  );
}
