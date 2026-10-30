import "server-only";

import { cache } from "react";
import type { OpsStore } from "@/lib/ops/store";

/** One metrics pass per request, shared by every section that needs it. */
export const metricsFor = cache((store: OpsStore) => store.metrics(new Date()));
