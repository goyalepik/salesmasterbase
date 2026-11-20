import "server-only";

import { getWms } from "@/features/wms";
import { canSeeCost, type Wms } from "@/features/wms/service";
import type { Actor } from "@/lib/ops/service";
import { canAct } from "@/lib/ops/service";
import { currentActor } from "@/lib/ops-ui/actor";

export type WmsPage = { ctx: Wms; actor: Actor; showCost: boolean; canRaisePo: boolean; canReceive: boolean };

/** What every warehouse page needs: the stores, who is looking, and what they may see and do. Null when switched off. */
export async function loadWmsPage(): Promise<WmsPage | null> {
  const ctx = await getWms();
  if (!ctx) return null;
  const actor = await currentActor();
  const [showCost, canReceive] = await Promise.all([canSeeCost(ctx.ops, actor), canAct(ctx.ops, actor, "inventory")]);
  return { ctx, actor, showCost, canRaisePo: showCost, canReceive };
}
