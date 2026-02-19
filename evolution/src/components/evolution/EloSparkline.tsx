// Tiny inline sparkline chart showing a variant's Elo rating over iterations.
// Used in variant table rows for at-a-glance trajectory visualization.
'use client';

import dynamic from 'next/dynamic';

const SparklineInner = dynamic(
  () =>
    import('recharts').then((mod) => {
      const { LineChart, Line } = mod;

      function Sparkline({
        data,
      }: {
        data: { iteration: number; elo: number }[];
      }) {
        if (data.length < 2) return null;
        return (
          <LineChart width={60} height={20} data={data}>
            <Line
              type="monotone"
              dataKey="elo"
              stroke="var(--accent-gold)"
              strokeWidth={1.5}
              dot={false}
              isAnimationActive={false}
            />
          </LineChart>
        );
      }

      return Sparkline;
    }),
  { ssr: false },
);

export function EloSparkline({
  data,
}: {
  data: { iteration: number; elo: number }[];
}) {
  return (
    <span className="inline-block" data-testid="elo-sparkline">
      <SparklineInner data={data} />
    </span>
  );
}
