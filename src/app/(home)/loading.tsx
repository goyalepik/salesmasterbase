// A plain cream screen while the home loads, instead of the dark operations skeleton.
export default function Loading() {
  return <div style={{ minHeight: "100dvh", background: "#fffdf5" }} aria-busy="true" aria-label="Loading" />;
}
