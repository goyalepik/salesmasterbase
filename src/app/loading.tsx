export default function Loading() {
  return (
    <div className="animate-pulse" aria-busy="true" aria-label="Loading">
      <div className="mb-5 h-7 w-56 rounded-lg bg-white/10" />
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="h-20 rounded-[18px] bg-white/[0.06]" />
        ))}
      </div>
      <div className="space-y-2 rounded-[18px] bg-white/[0.04] p-4">
        {Array.from({ length: 7 }, (_, i) => (
          <div key={i} className="h-5 rounded bg-white/[0.07]" style={{ width: `${92 - i * 6}%` }} />
        ))}
      </div>
    </div>
  );
}
