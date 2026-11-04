// A plain paper screen while the report loads, instead of the dark operations skeleton.
export default function Loading() {
  return <div style={{ minHeight: "100dvh", background: "#faf8f3" }} aria-busy="true" aria-label="Loading" />;
}
