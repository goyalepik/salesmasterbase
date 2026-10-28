import { buildDemoState } from "@/lib/demo/dataset";
import { isoDateInIst } from "@/lib/format";
import { MemoryRepository } from "@/lib/memory-repository";

const store = globalThis as { __epikDemo?: MemoryRepository; __epikDemoDay?: string };

export function getDemoRepository(): MemoryRepository {
  const day = isoDateInIst(new Date());
  if (!store.__epikDemo || store.__epikDemoDay !== day || typeof store.__epikDemo.listActivity !== "function") {
    store.__epikDemo = new MemoryRepository(buildDemoState(new Date()));
    store.__epikDemoDay = day;
  }
  return store.__epikDemo;
}
