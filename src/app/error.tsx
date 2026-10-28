"use client";

export default function Error({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <section>
      <h1 className="text-[20px] font-semibold">This page could not be loaded</h1>
      <p className="mt-2 max-w-xl text-[13px] text-muted">{error.message || "The request failed."}</p>
      <button type="button" className="mt-4 h-9 rounded-[9px] border border-line-strong bg-sidebar px-3 text-[13px]" onClick={reset}>Try again</button>
    </section>
  );
}
