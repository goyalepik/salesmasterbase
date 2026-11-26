"use client";

import { useTransition } from "react";
import { setImsRoleAction } from "@/app/actions/ims";

const LABELS = { viewer: "Viewer", editor: "Editor", admin: "Admin" } as const;

export function RoleSwitch({ role }: { role: keyof typeof LABELS }) {
  const [pending, start] = useTransition();
  return (
    <div className="ims-role" role="group" aria-label="Role" style={{ opacity: pending ? 0.6 : 1 }}>
      {(Object.keys(LABELS) as Array<keyof typeof LABELS>).map((r) => (
        <button key={r} type="button" aria-pressed={role === r} onClick={() => role !== r && start(() => setImsRoleAction(r))}>{LABELS[r]}</button>
      ))}
    </div>
  );
}
