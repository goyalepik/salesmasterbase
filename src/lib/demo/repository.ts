import { buildDemoState } from "@/lib/demo/dataset";
import { isoDateInIst } from "@/lib/format";
import { MemoryRepository } from "@/lib/memory-repository";

const DEMO_VERSION = "orders-1";
const store = globalThis as { __epikDemo?: MemoryRepository; __epikDemoDay?: string; __epikDemoVersion?: string };

export function getDemoRepository(): MemoryRepository {
  const day = isoDateInIst(new Date());
  if (!store.__epikDemo || store.__epikDemoDay !== day || store.__epikDemoVersion !== DEMO_VERSION || typeof store.__epikDemo.lookupCustomers !== "function") {
    store.__epikDemo = new MemoryRepository(buildDemoState(new Date()));
    store.__epikDemoDay = day;
    store.__epikDemoVersion = DEMO_VERSION;
  }
  return store.__epikDemo;
}
