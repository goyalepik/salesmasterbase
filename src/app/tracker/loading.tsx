// A plain light screen while the tracker loads, instead of the dark operations skeleton.
export default function Loading() {
  return <div style={{ minHeight: "100dvh", background: "#f6f7f9" }} aria-busy="true" aria-label="Loading" />;
}
