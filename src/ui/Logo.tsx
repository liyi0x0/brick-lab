/** 等轴测的 2×2 积木标志 */
export function Logo({ size = 28 }: { size?: number }) {
  const studs: [number, number][] = [
    [16, 6.4],
    [10.2, 9.7],
    [21.8, 9.7],
    [16, 13],
  ];
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <defs>
        <linearGradient id="lg-top" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ff7a6b" />
          <stop offset="1" stopColor="#f04a3a" />
        </linearGradient>
      </defs>
      <path d="M4 11.5 16 18 16 29.5 4 23z" fill="#c8281a" />
      <path d="M16 18 28 11.5 28 23 16 29.5z" fill="#a51d12" />
      <path d="M16 5 28 11.5 16 18 4 11.5z" fill="url(#lg-top)" />
      {studs.map(([x, y], i) => (
        <g key={i}>
          <path d={`M${x - 3.1} ${y} v-2 a3.1 1.7 0 0 1 6.2 0 v2 a3.1 1.7 0 0 1 -6.2 0z`} fill="#d33424" />
          <ellipse cx={x} cy={y - 2} rx="3.1" ry="1.7" fill="#ff9a8c" />
        </g>
      ))}
    </svg>
  );
}
