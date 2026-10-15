// Hit rate vs price on a shared 0–100% track: gray = what the price implies, green = how often it actually hit.
// The scale is zoomed to 50–100% since every line on the board is a heavy favorite.
const FLOOR = 0.5;
const pos = (p) => `${Math.max(0, Math.min(1, (p - FLOOR) / (1 - FLOOR))) * 100}%`;

export default function HitBar({ hit, implied }) {
  return (
    <div
      className="relative h-2.5 w-full min-w-[120px] rounded-full bg-ink-700"
      role="img"
      aria-label={`Hit rate ${(hit * 100).toFixed(1)}% versus implied ${(implied * 100).toFixed(1)}%`}
    >
      <div className="absolute inset-y-0 left-0 rounded-full bg-win" style={{ width: pos(hit) }} />
      <div className="absolute inset-y-0 left-0 rounded-full bg-[#4A5866]" style={{ width: pos(implied) }} />
      <div className="absolute -top-1 h-[18px] w-0.5 rounded bg-slate-200" style={{ left: pos(implied) }} title="Implied probability" />
    </div>
  );
}
