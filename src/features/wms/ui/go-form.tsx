"use client";

import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import { ActionForm } from "@/components/ops/action-form";
import type { ActionResult } from "@/lib/ops-ui/action-result";

/** An action form that opens the new record's page when the action says where (a new return, a new count). */
export function GoForm({ action, children, className }: { action: (form: FormData) => Promise<ActionResult & { href?: string }>; children: ReactNode; className?: string }) {
  const router = useRouter();
  return (
    <ActionForm
      className={className}
      resetOnSuccess={false}
      action={async (form) => {
        const result = await action(form);
        if (result.ok && result.href) router.push(result.href);
        return result;
      }}
    >
      {children}
    </ActionForm>
  );
}
