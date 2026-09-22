import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useTilt } from '@/hooks/useTilt'
import { shortDate } from '@/lib/format'
import type { VolumePoint } from '@/lib/types'

/**
 * Daily request volume, stacked by status.
 *
 * Status colours, not the categorical palette: pending, completed and cancelled
 * are states, and states get the reserved status colours so they mean the same
 * thing here as they do on the pills in the Requests Hub. A legend is present
 * because there are three series, so identity is never colour-alone.
 *
 * The API zero-fills quiet days, which matters: a bar chart that silently drops
 * empty days reads as "busy every day".
 */

// Chart-specific status colours, not the pill ones. See --chart-completed in
// index.css for why a large fill needs calmer values than a small badge.
const SERIES = [
  { key: 'completed', label: 'Completed', color: 'var(--chart-completed)' },
  { key: 'pending', label: 'Pending', color: 'var(--chart-pending)' },
  { key: 'cancelled', label: 'Cancelled', color: 'var(--chart-cancelled)' },
] as const

export function RequestVolumeChart({
  data,
  days,
}: {
  data: VolumePoint[]
  days: number
}) {
  const chartData = data.map((point) => ({
    ...point,
    label: shortDate(`${point.date}T12:00:00Z`),
  }))
  // Gentler than StatTile's tilt(8) — the same rotation swings a much wider
  // card's far corners through more visible pixels, which reads as unstable
  // rather than alive on something this large.
  const tilt = useTilt<HTMLDivElement>(3)

  return (
    <Card
      ref={tilt.ref}
      onMouseMove={tilt.onMouseMove}
      onMouseLeave={tilt.onMouseLeave}
      className="glass-interactive tilt-3d p-5"
    >
      <CardHeader className="p-0 pb-4">
        <CardTitle>Request volume</CardTitle>
        <CardDescription>Last {days} days, by status</CardDescription>
      </CardHeader>

      {/* flex-1 with a floor rather than a fixed height: this card sits beside
          a taller stack of panels, and a fixed height left a dead gap under the
          chart. It grows to fill instead. */}
      <div className="min-h-56 w-full flex-1">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: -24 }}>
            <CartesianGrid
              vertical={false}
              stroke="var(--chart-grid)"
              strokeDasharray="3 3"
            />
            <XAxis
              dataKey="label"
              tickLine={false}
              axisLine={false}
              interval="preserveStartEnd"
              // Long windows would otherwise print 90 overlapping labels.
              minTickGap={16}
              tick={{ fill: 'var(--foreground-subtle)', fontSize: 11 }}
            />
            <YAxis
              tickLine={false}
              axisLine={false}
              allowDecimals={false}
              width={44}
              tick={{ fill: 'var(--foreground-subtle)', fontSize: 11 }}
            />
            <Tooltip
              cursor={{ fill: 'var(--accent)' }}
              content={({ active, payload, label }) => {
                if (!active || !payload?.length) return null
                const total = payload.reduce(
                  (sum, entry) => sum + Number(entry.value ?? 0),
                  0,
                )
                return (
                  <div className="glass-strong flex flex-col gap-0.5 rounded-md px-2.5 py-2 text-xs">
                    <p className="font-medium">{label}</p>
                    {[...payload].reverse().map((entry) => (
                      <p
                        key={entry.name}
                        className="flex items-center gap-1.5 text-muted-foreground"
                      >
                        <span
                          aria-hidden
                          className="size-2 rounded-full"
                          style={{ backgroundColor: entry.color }}
                        />
                        {entry.name}: {entry.value}
                      </p>
                    ))}
                    <p className="mt-0.5 border-t border-border pt-0.5 font-medium">
                      {total} total
                    </p>
                  </div>
                )
              }}
            />
            <Legend
              verticalAlign="top"
              align="right"
              height={28}
              iconType="circle"
              iconSize={8}
              formatter={(value) => (
                <span className="text-[11px] text-muted-foreground">{value}</span>
              )}
            />
            {SERIES.map((series, index) => (
              <Bar
                key={series.key}
                dataKey={series.key}
                name={series.label}
                stackId="status"
                fill={series.color}
                maxBarSize={24}
                // Only the topmost segment gets rounded ends, so the stack
                // reads as one bar rather than three stacked pills.
                radius={index === SERIES.length - 1 ? [4, 4, 0, 0] : undefined}
                // The 2px surface gap between stacked segments.
                stroke="var(--card)"
                strokeWidth={2}
                // The grow-from-zero animation leaves the chart empty on every
                // mount and renders blank in any headless capture.
                isAnimationActive={false}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </Card>
  )
}
