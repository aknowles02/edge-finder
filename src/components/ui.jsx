export function Spinner({ className = '' }) {
  return (
    <span
      role="status"
      aria-label="Loading"
      className={`inline-block h-5 w-5 animate-spin rounded-full border-2 border-ink-600 border-t-win-text ${className}`}
    />
  );
}

export function Logo({ className = '' }) {
  return (
    <span className={`inline-flex items-center gap-2 font-bold tracking-tight ${className}`}>
      <svg viewBox="0 0 32 32" className="h-7 w-7" aria-hidden="true">
        <rect width="32" height="32" rx="8" className="fill-ink-800" />
        <path d="M8 22 L14 15 L18 18 L24 10" fill="none" stroke="#4CC98A" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span>Edge<span className="text-win-text">Finder</span></span>
    </span>
  );
}

export function Alert({ tone = 'error', children }) {
  const tones = {
    error: 'border-loss/40 bg-loss/10 text-loss-text',
    success: 'border-win/50 bg-win/15 text-win-text',
    info: 'border-ink-600 bg-ink-850 text-slate-300',
  };
  return <div role={tone === 'error' ? 'alert' : 'status'} className={`rounded-xl border px-4 py-3 text-sm ${tones[tone]}`}>{children}</div>;
}

export function ResultBadge({ result }) {
  if (!result) return <span className="text-xs text-muted-dim">Pending</span>;
  const style = { W: 'bg-win/25 text-win-text', L: 'bg-loss/20 text-loss-text', P: 'bg-ink-700 text-muted' }[result];
  return <span className={`inline-grid h-7 w-7 place-items-center rounded-lg text-xs font-bold ${style}`}>{result}</span>;
}

export function LockIcon({ className = 'h-3.5 w-3.5' }) {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className={className} aria-hidden="true">
      <path fillRule="evenodd" d="M10 1a4.5 4.5 0 0 0-4.5 4.5V9H5a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6a2 2 0 0 0-2-2h-.5V5.5A4.5 4.5 0 0 0 10 1Zm3 8V5.5a3 3 0 1 0-6 0V9h6Z" clipRule="evenodd" />
    </svg>
  );
}
