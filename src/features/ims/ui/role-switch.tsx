"use client";

import { useTransition } from "react";
import { setImsRoleAction } from "@/app/actions/ims";

export function RoleSwitch({ role }: { role: "viewer" | "admin" }) {
  const [pending, start] = useTransition();
  return (
    <div className="ims-role" role="group" aria-label="Role" style={{ opacity: pending ? 0.6 : 1 }}>
      {(["viewer", "admin"] as const).map((r) => (
        <button key={r} type="button" aria-pressed={role === r} onClick={() => role !== r && start(() => setImsRoleAction(r))}>
          {r === "viewer" ? "Viewer" : "Admin"}
        </button>
      ))}
    </div>
  );
}
