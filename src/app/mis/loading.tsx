/** A quiet paper screen while the MIS loads, instead of the operations skeleton. */
export default function MisLoading() {
  return <div style={{ minHeight: "100dvh", background: "#f4f2ec" }} aria-busy="true" />;
}
