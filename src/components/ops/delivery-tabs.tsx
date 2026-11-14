import Link from "next/link";

/** Logistics and installation: one area, two tabs. */
export function DeliveryTabs({ current }: { current: "dispatch" | "installations" }) {
  return (
    <nav className="s-chips" aria-label="Logistics and installation">
      <Link href="/dispatch" aria-current={current === "dispatch" ? "page" : undefined}>Dispatch</Link>
      <Link href="/installations" aria-current={current === "installations" ? "page" : undefined}>Installations</Link>
    </nav>
  );
}
