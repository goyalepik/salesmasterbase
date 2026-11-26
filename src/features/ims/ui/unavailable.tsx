import Link from "next/link";
import type { ImsRole } from "../role";
import { ImsShell, type TabId } from "./shell";

/** When the Masterbase can't be read (link not set, or Google down). */
export function ImsUnavailable({ role, current }: { role: ImsRole; current: TabId }) {
  return (
    <ImsShell current={current} role={role} readAt={null}>
      <div className="ims-card" style={{ maxWidth: 560 }}>
        <h2 style={{ fontSize: 16, fontWeight: 600 }}>The sheets can&apos;t be read right now</h2>
        <p className="ims-note" style={{ marginTop: 6 }}>
          Either the links aren&apos;t set yet, or Google didn&apos;t answer. Refresh in a minute.{" "}
          {role === "admin" ? <Link href="/ims/admin" className="underline">Check the sources</Link> : "If it stays like this, ask an admin."}
        </p>
      </div>
    </ImsShell>
  );
}
