export default function Loading() {
  return (
    <div className="animate-pulse space-y-4" aria-busy="true" aria-label="Loading…">
      <div className="h-8 w-48 rounded-lg bg-surface-2" />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => <div key={i} className="h-20 rounded-xl bg-surface-2" />)}
      </div>
      <div className="h-56 rounded-2xl bg-surface-2" />
      <div className="h-40 rounded-2xl bg-surface-2" />
    </div>
  );
}
