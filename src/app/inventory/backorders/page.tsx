import { redirect } from "next/navigation";

/** Backorders now live on Incoming, under "Expected deliveries". */
export default function BackordersPage() {
  redirect("/inventory/incoming");
}
