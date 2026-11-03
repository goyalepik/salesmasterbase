// A plain light screen while the support pilot loads, instead of the dark operations skeleton.
export default function Loading() {
  return <div style={{ minHeight: "100dvh", background: "#f7f7f5" }} aria-busy="true" aria-label="Loading" />;
}
