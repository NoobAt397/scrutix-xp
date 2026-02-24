"use client"

import {
  ComposedChart,
  Scatter,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts"
import { AlertTriangle, CheckCircle, Info } from "lucide-react"
import {
  type WeightDataPoint,
  type RegressionResult,
  runRegression,
  sampleForDisplay,
  groupByProvider,
} from "@/lib/weight-regression"

// ── Constants ─────────────────────────────────────────────────────────────────

const ALERT_R2_THRESHOLD = 0.7
const ALERT_OVERCHARGE_PCT_THRESHOLD = 5

// ── Tooltip ───────────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function DarkTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null
  const d = payload[0]?.payload as { x: number; y: number } | undefined
  if (!d) return null
  return (
    <div
      className="text-[11px] rounded border px-2.5 py-2 shadow-xl font-mono"
      style={{
        background: "#111",
        borderColor: "rgba(255,255,255,0.08)",
        color: "#e4e4e7",
      }}
    >
      <div>Declared: {(d.x / 1000).toFixed(3)} kg</div>
      <div>Billed:   {(d.y / 1000).toFixed(3)} kg</div>
    </div>
  )
}

// ── Alert banner ──────────────────────────────────────────────────────────────

function AlertBanner({ result }: { result: RegressionResult }) {
  const overchargePct = result.avgOverchargePct
  const isSuspicious =
    result.r2 >= ALERT_R2_THRESHOLD &&
    overchargePct >= ALERT_OVERCHARGE_PCT_THRESHOLD

  if (!isSuspicious) {
    return (
      <div
        className="flex items-start gap-2.5 rounded-md px-4 py-3 text-xs border"
        style={{
          background: "rgba(22,163,74,0.06)",
          borderColor: "rgba(22,163,74,0.2)",
          color: "rgb(134,239,172)",
        }}
      >
        <CheckCircle size={13} className="mt-0.5 flex-shrink-0" />
        <span>
          No systematic weight inflation detected for{" "}
          <strong>{result.provider}</strong>. Overcharge pattern appears random
          (R²={result.r2.toFixed(2)}, avg {overchargePct > 0 ? "+" : ""}
          {overchargePct.toFixed(1)}%).
        </span>
      </div>
    )
  }

  return (
    <div
      className="flex items-start gap-2.5 rounded-md px-4 py-3 text-xs border"
      style={{
        background: "rgba(239,68,68,0.07)",
        borderColor: "rgba(239,68,68,0.25)",
        color: "rgb(252,165,165)",
      }}
    >
      <AlertTriangle size={13} className="mt-0.5 flex-shrink-0 text-red-400" />
      <span>
        <strong>{result.provider}</strong> shows systematic weight inflation of{" "}
        <strong>+{overchargePct.toFixed(1)}%</strong> (R²={result.r2.toFixed(2)}
        ). This pattern across{" "}
        <strong>{result.pointCount} shipments</strong> suggests systematic
        overbilling, not random error. Consider raising a dispute.
      </span>
    </div>
  )
}

// ── Stat chips ────────────────────────────────────────────────────────────────

function Chip({
  label,
  value,
  accent,
}: {
  label: string
  value: string
  accent?: string
}) {
  return (
    <div
      className="flex flex-col gap-0.5 rounded-md px-3 py-2 border"
      style={{
        background: "rgba(255,255,255,0.02)",
        borderColor: "rgba(255,255,255,0.06)",
      }}
    >
      <span className="text-[10px] uppercase tracking-widest text-zinc-500 font-medium">
        {label}
      </span>
      <span
        className="text-sm font-mono font-semibold"
        style={{ color: accent ?? "#e4e4e7" }}
      >
        {value}
      </span>
    </div>
  )
}

// ── Per-provider card ─────────────────────────────────────────────────────────

interface ProviderCardProps {
  provider: string
  points: WeightDataPoint[]
}

function ProviderRegressionCard({ provider, points }: ProviderCardProps) {
  const result = runRegression(points)
  const displayPoints = sampleForDisplay(points)

  // Build scatter data: { x: declaredWeight_g, y: billedWeight_g }
  const scatterData = displayPoints.map((p) => ({
    x: p.declaredWeight_g,
    y: p.billedWeight_g,
  }))

  // Build regression line data: two endpoints spanning the x range
  const xs = displayPoints.map((p) => p.declaredWeight_g)
  const xMin = Math.min(...xs)
  const xMax = Math.max(...xs)

  const regressionLineData = result
    ? [
        { x: xMin, y: result.slope * xMin + result.intercept },
        { x: xMax, y: result.slope * xMax + result.intercept },
      ]
    : []

  // Perfect billing line: y = x
  const perfectLineData = [
    { x: xMin, y: xMin },
    { x: xMax, y: xMax },
  ]

  const hasEnoughData = points.length >= 30

  return (
    <div
      className="rounded-lg border p-5 space-y-4"
      style={{
        background: "rgba(255,255,255,0.015)",
        borderColor: "rgba(255,255,255,0.06)",
      }}
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-zinc-200">{provider}</h3>
        <span className="text-[10px] text-zinc-600 font-mono">
          {points.length} shipment{points.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Insufficient data */}
      {!hasEnoughData && (
        <div
          className="flex items-center gap-2 text-xs rounded-md px-3 py-2.5 border"
          style={{
            background: "rgba(161,161,170,0.05)",
            borderColor: "rgba(161,161,170,0.12)",
            color: "rgb(161,161,170)",
          }}
        >
          <Info size={12} className="flex-shrink-0" />
          <span>
            Need at least 30 shipments for regression analysis.{" "}
            {30 - points.length} more needed.
          </span>
        </div>
      )}

      {/* Regression stats */}
      {result && (
        <>
          <AlertBanner result={result} />

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <Chip label="Slope (m)" value={result.slope.toFixed(4)} />
            <Chip
              label="Intercept (b)"
              value={`${result.intercept >= 0 ? "+" : ""}${result.intercept.toFixed(1)}g`}
            />
            <Chip label="R²" value={result.r2.toFixed(4)} />
            <Chip
              label="Avg Overcharge"
              value={`${result.avgOverchargePct > 0 ? "+" : ""}${result.avgOverchargePct.toFixed(1)}%`}
              accent={
                result.avgOverchargePct >= ALERT_OVERCHARGE_PCT_THRESHOLD
                  ? "rgb(252,165,165)"
                  : result.avgOverchargePct <= 0
                  ? "rgb(134,239,172)"
                  : "rgb(253,224,71)"
              }
            />
          </div>
        </>
      )}

      {/* Scatter chart */}
      {hasEnoughData && (
        <div className="space-y-1">
          <p className="text-[10px] text-zinc-600 uppercase tracking-wider font-medium">
            Declared vs Billed Weight (grams)
          </p>
          <ResponsiveContainer width="100%" height={240}>
            <ComposedChart margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
              <CartesianGrid
                strokeDasharray="3 3"
                stroke="rgba(255,255,255,0.04)"
              />
              <XAxis
                dataKey="x"
                type="number"
                name="Declared"
                domain={["auto", "auto"]}
                tick={{ fontSize: 10, fill: "#52525b" }}
                tickFormatter={(v: number) => `${(v / 1000).toFixed(1)}kg`}
              />
              <YAxis
                dataKey="y"
                type="number"
                name="Billed"
                domain={["auto", "auto"]}
                tick={{ fontSize: 10, fill: "#52525b" }}
                tickFormatter={(v: number) => `${(v / 1000).toFixed(1)}kg`}
                width={52}
              />
              <Tooltip content={<DarkTooltip />} />
              <Legend
                iconSize={8}
                wrapperStyle={{ fontSize: 10, color: "#71717a" }}
              />

              {/* Scatter: actual data points */}
              <Scatter
                name="Shipments"
                data={scatterData}
                fill="rgba(96,165,250,0.5)"
                r={2.5}
              />

              {/* Perfect billing line: y = x (green) */}
              <Line
                name="Perfect billing (y=x)"
                data={perfectLineData}
                dataKey="y"
                dot={false}
                activeDot={false}
                stroke="rgb(74,222,128)"
                strokeWidth={1.5}
                strokeDasharray="5 4"
                legendType="line"
              />

              {/* Regression line (red) */}
              {result && (
                <Line
                  name={`Regression (m=${result.slope.toFixed(3)})`}
                  data={regressionLineData}
                  dataKey="y"
                  dot={false}
                  activeDot={false}
                  stroke="rgb(248,113,113)"
                  strokeWidth={2}
                  legendType="line"
                />
              )}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}

// ── Main export ───────────────────────────────────────────────────────────────

interface Props {
  weightData: WeightDataPoint[]
}

export default function WeightPatternAnalysis({ weightData }: Props) {
  if (weightData.length === 0) {
    return (
      <div
        className="rounded-lg border px-6 py-10 text-center text-sm text-zinc-600"
        style={{
          background: "rgba(255,255,255,0.01)",
          borderColor: "rgba(255,255,255,0.05)",
        }}
      >
        No weight data yet. Run an audit to start collecting weight pairs.
      </div>
    )
  }

  const byProvider = groupByProvider(weightData)

  return (
    <div className="space-y-4">
      {[...byProvider.entries()].map(([provider, points]) => (
        <ProviderRegressionCard key={provider} provider={provider} points={points} />
      ))}
    </div>
  )
}
