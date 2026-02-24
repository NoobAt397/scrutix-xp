"use client"

import { useState, useMemo } from "react"
import { Trash2, TrendingUp } from "lucide-react"
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { clearAuditHistory, type AuditRecord } from "@/lib/audit-history"
import { type WeightDataPoint } from "@/lib/weight-regression"
import WeightPatternAnalysis from "@/components/WeightPatternAnalysis"

// ── Color palettes ────────────────────────────────────────────────────────────

const PROVIDER_COLORS: Record<string, string> = {
  Delhivery:      "#ef4444",
  BlueDart:       "#3b82f6",
  "Ecom Express": "#f97316",
  Shadowfax:      "#a855f7",
}
const FALLBACK_COLORS = ["#22c55e", "#eab308", "#06b6d4", "#ec4899", "#14b8a6"]

function providerColor(name: string, idx: number): string {
  return PROVIDER_COLORS[name] ?? FALLBACK_COLORS[idx % FALLBACK_COLORS.length]
}

const ERROR_KEYS = ["Weight", "Zone", "Dup. AWB", "COD", "RTO", "Other"] as const
const ERROR_COLORS: Record<string, string> = {
  Weight:     "#ef4444",
  Zone:       "#f97316",
  "Dup. AWB": "#eab308",
  COD:        "#a855f7",
  RTO:        "#3b82f6",
  Other:      "#6b7280",
}

// ── Formatters ────────────────────────────────────────────────────────────────

function fmt(n: number) {
  return `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function fmtShort(n: number) {
  if (n >= 100_000) return `₹${(n / 100_000).toFixed(1)}L`
  if (n >= 1_000)   return `₹${(n / 1_000).toFixed(1)}k`
  return `₹${Math.round(n)}`
}

// ── Dark tooltip ──────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function DarkTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  return (
    <div
      style={{
        background: "#111111",
        border: "1px solid rgba(63,63,70,0.7)",
        borderRadius: "4px",
        padding: "8px 12px",
        minWidth: "140px",
      }}
    >
      <p
        style={{
          color: "rgb(113,113,122)",
          fontSize: "10px",
          marginBottom: "6px",
          textTransform: "uppercase",
          letterSpacing: "0.05em",
        }}
      >
        {label}
      </p>
      {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
      {payload.map((item: any, i: number) => (
        <p
          key={i}
          style={{ color: item.color, fontSize: "11px", fontFamily: "monospace", marginBottom: "2px" }}
        >
          {item.name}: {fmtShort(Number(item.value))}
        </p>
      ))}
    </div>
  )
}

// ── Types ─────────────────────────────────────────────────────────────────────

type DateRange = "30d" | "90d" | "all"

interface Props {
  records:    AuditRecord[]
  weightData: WeightDataPoint[]
  onClear:    () => void
}

// ── Main component ────────────────────────────────────────────────────────────

export default function AnalyticsDashboard({ records, weightData, onClear }: Props) {
  const [dateRange, setDateRange] = useState<DateRange>("all")

  // ── Filter + sort records ───────────────────────────────────────────────────
  const filtered = useMemo(() => {
    const cutoffMs =
      dateRange === "30d" ? Date.now() - 30 * 86_400_000
      : dateRange === "90d" ? Date.now() - 90 * 86_400_000
      : 0
    return [...records]
      .filter((r) => r.timestamp >= cutoffMs)
      .sort((a, b) => a.timestamp - b.timestamp)
  }, [records, dateRange])

  // ── Unique providers in filtered set ───────────────────────────────────────
  const providers = useMemo(
    () => [...new Set(filtered.map((r) => r.providerName))],
    [filtered]
  )

  // ── Summary stats ──────────────────────────────────────────────────────────
  const totalRecovered = useMemo(
    () => filtered.reduce((s, r) => s + r.totalOvercharge, 0),
    [filtered]
  )
  const totalBilledAll = useMemo(
    () => filtered.reduce((s, r) => s + r.totalBilled, 0),
    [filtered]
  )
  const avgOverchargeRate =
    totalBilledAll > 0 ? ((totalRecovered / totalBilledAll) * 100).toFixed(1) : "0.0"

  // ── View A: Overcharge trend line data ─────────────────────────────────────
  // Aggregate by audit date; multiple audits on the same day are summed per provider.
  const lineData = useMemo(() => {
    const map = new Map<string, Record<string, number | string>>()
    for (const r of filtered) {
      const label = new Date(r.timestamp).toLocaleDateString("en-IN", {
        month: "short",
        day:   "numeric",
      })
      if (!map.has(label)) map.set(label, { date: label })
      const entry = map.get(label)!
      entry[r.providerName] = ((entry[r.providerName] as number) || 0) + r.totalOvercharge
    }
    return Array.from(map.values())
  }, [filtered])

  // ── View B: Error type breakdown stacked bar (per provider) ────────────────
  const barData = useMemo(() =>
    providers.map((provider) => {
      const recs = filtered.filter((r) => r.providerName === provider)
      return {
        provider,
        Weight:     Math.round(recs.reduce((s, r) => s + r.overchargeByType.weightMismatch, 0)),
        Zone:       Math.round(recs.reduce((s, r) => s + r.overchargeByType.zoneMismatch,   0)),
        "Dup. AWB": Math.round(recs.reduce((s, r) => s + r.overchargeByType.duplicateAWB,   0)),
        COD:        Math.round(recs.reduce((s, r) => s + r.overchargeByType.incorrectCOD,   0)),
        RTO:        Math.round(recs.reduce((s, r) => s + r.overchargeByType.rtoMismatch,    0)),
        Other:      Math.round(recs.reduce((s, r) => s + r.overchargeByType.other,          0)),
      }
    }),
    [providers, filtered]
  )

  // ── View C: Provider comparison table ─────────────────────────────────────
  const providerStats = useMemo(() =>
    providers.map((provider) => {
      const recs      = filtered.filter((r) => r.providerName === provider)
      const pBilled   = recs.reduce((s, r) => s + r.totalBilled, 0)
      const pRecovered = recs.reduce((s, r) => s + r.totalOvercharge, 0)
      const avgRate   = pBilled > 0 ? ((pRecovered / pBilled) * 100).toFixed(1) : "0.0"

      const sums: Record<string, number> = {
        "Weight Mismatch": recs.reduce((s, r) => s + r.overchargeByType.weightMismatch, 0),
        "Zone Mismatch":   recs.reduce((s, r) => s + r.overchargeByType.zoneMismatch,   0),
        "Duplicate AWB":   recs.reduce((s, r) => s + r.overchargeByType.duplicateAWB,   0),
        "COD Error":       recs.reduce((s, r) => s + r.overchargeByType.incorrectCOD,   0),
        "RTO Mismatch":    recs.reduce((s, r) => s + r.overchargeByType.rtoMismatch,    0),
      }
      const [mostCommon, mcAmt] = Object.entries(sums).sort((a, b) => b[1] - a[1])[0]

      return {
        provider,
        totalAudits:    recs.length,
        avgRate,
        totalRecovered: pRecovered,
        mostCommon:     mcAmt > 0 ? mostCommon : "—",
      }
    }),
    [providers, filtered]
  )

  // ── Empty state (no records at all) ────────────────────────────────────────
  if (records.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-28 space-y-4">
        <div
          className="w-16 h-16 rounded-full border border-zinc-800 flex items-center justify-center"
          style={{ boxShadow: "0 0 24px rgba(220,38,38,0.08)" }}
        >
          <TrendingUp className="w-6 h-6 text-zinc-700" />
        </div>
        <p className="text-zinc-600 text-sm">No audit history yet</p>
        <p className="text-zinc-700 text-xs">Run an audit to start tracking overcharge trends</p>
      </div>
    )
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">

      {/* ── Headline + controls row ── */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">

        {/* Headline stat */}
        <div>
          <p className="text-[11px] text-zinc-500 uppercase tracking-widest mb-1">
            Total Recovered Across All Audits
          </p>
          <p
            className="text-4xl font-bold tabular-nums"
            style={{ color: totalRecovered > 0 ? "rgb(248,113,113)" : "white" }}
          >
            {fmt(totalRecovered)}
          </p>
          <p className="text-xs text-zinc-600 mt-1">
            {records.length} audit{records.length !== 1 ? "s" : ""} saved
            {dateRange !== "all" && ` · ${filtered.length} in selected range`}
            {" · "}{avgOverchargeRate}% avg overcharge rate
          </p>
        </div>

        {/* Date range filter + clear */}
        <div className="flex items-center gap-3 flex-shrink-0">
          <div
            className="flex items-center gap-0.5 p-1 rounded-md border border-zinc-800/60"
            style={{ background: "rgba(10,10,10,0.9)" }}
          >
            {(["30d", "90d", "all"] as DateRange[]).map((r) => (
              <button
                key={r}
                onClick={() => setDateRange(r)}
                className="px-3 py-1 rounded-sm text-[11px] font-medium transition-all duration-150"
                style={
                  dateRange === r
                    ? { background: "rgba(220,38,38,0.2)", color: "rgb(252,165,165)" }
                    : { color: "rgb(82,82,91)" }
                }
              >
                {r === "all" ? "All Time" : r === "30d" ? "30 Days" : "90 Days"}
              </button>
            ))}
          </div>

          <button
            onClick={() => { clearAuditHistory(); onClear() }}
            title="Clear all audit history"
            className="p-2 text-zinc-700 hover:text-red-500 transition-colors rounded-md border border-zinc-800/60 hover:border-red-900/40"
          >
            <Trash2 size={13} />
          </button>
        </div>
      </div>

      {/* ── Supporting KPI cards ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Audits Run",        value: filtered.length.toString(),  sub: "in selected range"   },
          { label: "Total Billed",      value: fmtShort(totalBilledAll),    sub: "across all AWBs"     },
          { label: "Avg Overcharge",    value: `${avgOverchargeRate}%`,      sub: "of billed amount"    },
          { label: "Providers Tracked", value: providers.length.toString(),  sub: "unique couriers"     },
        ].map(({ label, value, sub }) => (
          <Card key={label} className="bg-zinc-950 border border-zinc-800/70 shadow-none">
            <CardContent className="pt-4 pb-3">
              <p className="text-[10px] text-zinc-500 uppercase tracking-widest mb-1">{label}</p>
              <p className="text-2xl font-bold text-zinc-200 tabular-nums">{value}</p>
              <p className="text-[10px] text-zinc-600 mt-0.5">{sub}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* ── Empty range state ── */}
      {filtered.length === 0 && (
        <div className="py-12 text-center">
          <p className="text-zinc-600 text-sm">No audits in the selected date range.</p>
          <p className="text-zinc-700 text-xs mt-1">Try "All Time" to see all saved audits.</p>
        </div>
      )}

      {filtered.length > 0 && (
        <>
          {/* ── View A: Overcharge Trend Line Chart ── */}
          <Card className="bg-zinc-950 border border-zinc-800/70 shadow-none">
            <CardHeader className="pb-2">
              <CardTitle className="text-[11px] text-zinc-500 font-semibold uppercase tracking-widest">
                Overcharge Trend
              </CardTitle>
              <p className="text-[11px] text-zinc-600">
                Total overcharge (₹) per audit date — one line per provider
              </p>
            </CardHeader>
            <CardContent className="pt-2 pb-4">
              {lineData.length < 2 && (
                <p className="text-[11px] text-zinc-700 mb-2 pl-1">
                  Run more audits to see the trend line.
                </p>
              )}
              <ResponsiveContainer width="100%" height={240}>
                <LineChart data={lineData} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(63,63,70,0.4)" />
                  <XAxis
                    dataKey="date"
                    tick={{ fill: "rgb(82,82,91)", fontSize: 10 }}
                    axisLine={{ stroke: "rgba(63,63,70,0.5)" }}
                    tickLine={false}
                  />
                  <YAxis
                    tickFormatter={fmtShort}
                    tick={{ fill: "rgb(82,82,91)", fontSize: 10 }}
                    axisLine={false}
                    tickLine={false}
                    width={58}
                  />
                  <Tooltip content={<DarkTooltip />} />
                  <Legend
                    wrapperStyle={{ fontSize: "10px", color: "rgb(113,113,122)", paddingTop: "8px" }}
                  />
                  {providers.map((p, i) => (
                    <Line
                      key={p}
                      type="monotone"
                      dataKey={p}
                      stroke={providerColor(p, i)}
                      strokeWidth={2}
                      dot={{ r: 3, fill: providerColor(p, i), strokeWidth: 0 }}
                      activeDot={{ r: 5 }}
                      connectNulls
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          {/* ── View B: Error Type Breakdown Stacked Bar Chart ── */}
          <Card className="bg-zinc-950 border border-zinc-800/70 shadow-none">
            <CardHeader className="pb-2">
              <CardTitle className="text-[11px] text-zinc-500 font-semibold uppercase tracking-widest">
                Error Type Breakdown
              </CardTitle>
              <p className="text-[11px] text-zinc-600">
                Overcharge (₹) by error category, stacked per provider
              </p>
            </CardHeader>
            <CardContent className="pt-2 pb-4">
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={barData} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(63,63,70,0.4)" vertical={false} />
                  <XAxis
                    dataKey="provider"
                    tick={{ fill: "rgb(82,82,91)", fontSize: 10 }}
                    axisLine={{ stroke: "rgba(63,63,70,0.5)" }}
                    tickLine={false}
                  />
                  <YAxis
                    tickFormatter={fmtShort}
                    tick={{ fill: "rgb(82,82,91)", fontSize: 10 }}
                    axisLine={false}
                    tickLine={false}
                    width={58}
                  />
                  <Tooltip content={<DarkTooltip />} />
                  <Legend
                    wrapperStyle={{ fontSize: "10px", color: "rgb(113,113,122)", paddingTop: "8px" }}
                  />
                  {ERROR_KEYS.map((key) => (
                    <Bar key={key} dataKey={key} stackId="a" fill={ERROR_COLORS[key]} />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          {/* ── View C: Provider Comparison Table ── */}
          <Card className="bg-zinc-950 border border-zinc-800/70 shadow-none">
            <CardHeader className="pb-3">
              <CardTitle className="text-[11px] text-zinc-500 font-semibold uppercase tracking-widest">
                Provider Comparison
              </CardTitle>
              <p className="text-[11px] text-zinc-600">
                Side-by-side summary for each courier in the selected period
              </p>
            </CardHeader>
            <CardContent className="p-0 pb-1">
              <div className="overflow-x-auto">
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-zinc-800/60">
                      {["Provider", "Audits", "Avg Overcharge %", "Total Recovered (₹)", "Most Common Error"].map((h) => (
                        <th
                          key={h}
                          className="px-5 py-2.5 text-left text-[10px] text-zinc-500 uppercase tracking-wider font-semibold whitespace-nowrap"
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {providerStats.map((row, i) => {
                      const rate = Number(row.avgRate)
                      const rateColor =
                        rate > 5 ? "rgb(248,113,113)"
                        : rate > 2 ? "rgb(251,191,36)"
                        : "rgb(134,239,172)"
                      return (
                        <tr
                          key={row.provider}
                          className="border-b border-zinc-800/30"
                          style={{
                            backgroundColor: i % 2 === 1 ? "rgba(39,39,42,0.2)" : "transparent",
                          }}
                        >
                          <td
                            className="px-5 py-3 font-medium"
                            style={{ color: providerColor(row.provider, i) }}
                          >
                            {row.provider}
                          </td>
                          <td className="px-5 py-3 text-zinc-400 tabular-nums">
                            {row.totalAudits}
                          </td>
                          <td className="px-5 py-3 font-mono tabular-nums">
                            <span style={{ color: rateColor }}>{row.avgRate}%</span>
                          </td>
                          <td className="px-5 py-3 font-mono font-semibold text-red-400 tabular-nums">
                            {fmt(row.totalRecovered)}
                          </td>
                          <td className="px-5 py-3 text-zinc-500">
                            {row.mostCommon}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          {/* ── Weight Pattern Analysis ── */}
          <div className="space-y-3">
            <div>
              <p className="text-[11px] text-zinc-500 font-semibold uppercase tracking-widest">
                Weight Pattern Analysis
              </p>
              <p className="text-[11px] text-zinc-600 mt-0.5">
                Linear regression of declared vs billed weight per provider — detects systematic inflation
              </p>
            </div>
            <WeightPatternAnalysis weightData={weightData} />
          </div>
        </>
      )}
    </div>
  )
}
