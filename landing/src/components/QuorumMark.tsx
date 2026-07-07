// The committee, drawn as five seats around an empty center: a quorum.
// Replaces the spec's clover. Geometric, ink-filled, no gradients.
export default function QuorumMark({
  size = 26,
  className = "",
}: {
  size?: number;
  className?: string;
}) {
  const r = 50;
  const cx = 60;
  const cy = 60;
  const seats = Array.from({ length: 5 }, (_, i) => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / 5;
    return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
  });
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 120 120"
      className={className}
      aria-hidden="true"
    >
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="#1a1a1a" strokeWidth="3" />
      {seats.map((s, i) => (
        <circle key={i} cx={s.x} cy={s.y} r="11" fill="#1a1a1a" />
      ))}
      {/* the empty center: the question the committee convenes around */}
      <circle cx={cx} cy={cy} r="6" fill="none" stroke="#1a1a1a" strokeWidth="3" />
    </svg>
  );
}
