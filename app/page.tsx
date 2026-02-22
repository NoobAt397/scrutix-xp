"use client"

import { useState, useMemo } from "react"
import { ChevronDown } from "lucide-react"
import Papa from "papaparse"
import { PieChart, Pie, Cell, Label } from "recharts"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart"
import { analyzeInvoice, type AnalysisResult } from "@/lib/billing-engine"

// ── Constants ────────────────────────────────────────────────────────────────

const MOCK_CONTRACT = {
  provider_name: "Delhivery",
  zone_a_rate: 40,
  zone_b_rate: 55,
  zone_c_rate: 75,
  cod_fee_percentage: 1.5,
  rto_flat_fee: 30,
}

const CHART_PALETTE = [
  "#ef4444", // red-500
  "#f97316", // orange-500
  "#f43f5e", // rose-500
  "#fb923c", // orange-400
  "#fbbf24", // amber-400
]

// ── Component ─────────────────────────────────────────────────────────────────

export default function Home() {
  const [analysisResults, setAnalysisResults] = useState<AnalysisResult | null>(null)
  const [isProcessing, setIsProcessing] = useState(false)
  const [fileName, setFileName] = useState<string | null>(null)
  const [contractOpen, setContractOpen] = useState(true)

  // ── Derived chart data ──────────────────────────────────────────────────────
  // Aggregate total overcharge (₹) per issue type.
  // A single row can have multiple issues joined by ", " — we attribute the
  // full difference to each contributing issue so nothing is lost in the chart.
  const chartData = useMemo(() => {
    if (!analysisResults?.discrepancies.length) return []

    const map = new Map<string, { amount: number; count: number }>()
    for (const d of analysisResults.discrepancies) {
      const types = d.issue_type.split(", ").map((t) => t.trim())
      const share = Number((d.difference / types.length).toFixed(2))
      for (const type of types) {
        const prev = map.get(type) ?? { amount: 0, count: 0 }
        map.set(type, { amount: prev.amount + share, count: prev.count + 1 })
      }
    }

    return Array.from(map.entries())
      .map(([issueType, { amount, count }]) => ({
        issueType,
        amount: Number(amount.toFixed(2)),
        count,
      }))
      .sort((a, b) => b.amount - a.amount)
  }, [analysisResults])

  const chartConfig = useMemo<ChartConfig>(() => {
    const cfg: ChartConfig = {}
    chartData.forEach((item, i) => {
      cfg[item.issueType] = {
        label: item.issueType,
        color: CHART_PALETTE[i % CHART_PALETTE.length],
      }
    })
    return cfg
  }, [chartData])

  // ── Handlers ────────────────────────────────────────────────────────────────

  function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return

    setFileName(file.name)
    setIsProcessing(true)

    Papa.parse(file, {
      header: true,
      dynamicTyping: true,
      skipEmptyLines: true,
      complete: (results) => {
        const analysis = analyzeInvoice(results.data as any[], MOCK_CONTRACT)
        setAnalysisResults(analysis)
        setIsProcessing(false)
      },
      error: () => setIsProcessing(false),
    })
  }

  function handleExport() {
    if (!analysisResults?.discrepancies.length) return

    const headers = ["AWB Number", "Issue Type", "Billed Amount", "Correct Amount", "Difference"]
    const rows = analysisResults.discrepancies.map((d) => [
      d.awb_number,
      d.issue_type,
      d.billed_amount.toFixed(2),
      d.correct_amount.toFixed(2),
      d.difference.toFixed(2),
    ])
    const csv = [headers, ...rows].map((r) => r.join(",")).join("\n")
    const blob = new Blob([csv], { type: "text/csv" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = "mosaic-discrepancy-payout.csv"
    a.click()
    URL.revokeObjectURL(url)
  }

  // ── Derived booleans ────────────────────────────────────────────────────────

  const hasOvercharge = (analysisResults?.totalOvercharge ?? 0) > 0

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="relative min-h-screen bg-black text-white overflow-x-hidden">

      {/* Ambient red glow layer */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 z-0"
        style={{
          background: [
            "radial-gradient(ellipse 90% 55% at 50% -5%, rgba(220,38,38,0.18) 0%, transparent 68%)",
            "radial-gradient(ellipse 35% 25% at 92% 95%, rgba(185,28,28,0.10) 0%, transparent 55%)",
            "radial-gradient(ellipse 25% 20% at 5% 80%, rgba(185,28,28,0.07) 0%, transparent 50%)",
          ].join(", "),
        }}
      />

      <div className="relative z-10 max-w-7xl mx-auto px-6 py-8 space-y-7">

        {/* ── Header ── */}
        <header className="space-y-2 pt-2">
          <div className="flex items-center gap-3">
            <span
              className="w-1.5 h-9 rounded-full block flex-shrink-0"
              style={{
                background: "linear-gradient(180deg, #ef4444 0%, #7f1d1d 100%)",
                boxShadow: "0 0 12px rgba(239,68,68,0.5)",
              }}
            />
            <h1 className="text-3xl font-bold tracking-tight text-white">
              Mosaic Logistics Command Center
            </h1>
          </div>
          <p className="text-zinc-500 text-sm pl-5">
            Contract-based invoice auditing for Indian D2C logistics
            &nbsp;·&nbsp;
            <span className="text-zinc-600">Demo contract: {MOCK_CONTRACT.provider_name}</span>
          </p>
        </header>

        {/* ── Upload + Contract Rules row ── */}
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-4 items-start">

          {/* Upload Card */}
          <Card className="bg-zinc-950 border border-zinc-800/70 shadow-none">
            <CardHeader className="pb-2">
              <CardTitle className="text-[11px] text-zinc-500 font-semibold uppercase tracking-widest">
                Upload Invoice CSV
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center">
                <Input
                  type="file"
                  accept=".csv"
                  onChange={handleFileUpload}
                  className="max-w-sm bg-zinc-900 border-zinc-700 text-zinc-300
                             file:text-zinc-400 file:bg-transparent file:border-0 file:mr-3
                             file:font-medium cursor-pointer transition-colors
                             hover:border-red-800 focus:border-red-700 focus:ring-red-900"
                />
                <p className="text-[11px] text-zinc-600 leading-relaxed">
                  Expected columns:&nbsp;
                  <span className="font-mono text-zinc-500">
                    AWB, OrderType, BilledWeight, ActualWeight, BilledZone, ActualZone, TotalBilledAmount
                  </span>
                </p>
              </div>
              {isProcessing && (
                <p className="text-xs text-red-400 animate-pulse flex items-center gap-2">
                  <span className="inline-block w-1.5 h-1.5 rounded-full bg-red-500 animate-ping" />
                  Analyzing {fileName}…
                </p>
              )}
              {!isProcessing && fileName && analysisResults && (
                <p className="text-xs text-zinc-600">
                  Processed: <span className="text-zinc-400 font-mono">{fileName}</span>
                </p>
              )}
            </CardContent>
          </Card>

          {/* Active Contract Rules Card */}
          <Card className="bg-zinc-950 border border-zinc-800/70 shadow-none">
            <CardHeader className="pb-0">
              <button
                onClick={() => setContractOpen((o) => !o)}
                className="w-full flex items-start justify-between gap-2 text-left group"
              >
                <div className="space-y-1.5">
                  <CardTitle className="text-[11px] text-zinc-500 font-semibold uppercase tracking-widest">
                    Active Contract Rules
                  </CardTitle>
                  {/* AI badge */}
                  <span
                    className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-sm border text-[10px] font-medium tracking-wide"
                    style={{
                      background: "rgba(124,58,237,0.12)",
                      borderColor: "rgba(124,58,237,0.35)",
                      color: "rgb(167,139,250)",
                    }}
                  >
                    <span
                      className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                      style={{ backgroundColor: "rgb(167,139,250)", boxShadow: "0 0 6px rgba(167,139,250,0.6)" }}
                    />
                    AI Extracted from PDF
                  </span>
                </div>
                <ChevronDown
                  className="mt-0.5 flex-shrink-0 text-zinc-600 transition-transform duration-200 group-hover:text-zinc-400"
                  style={{ transform: contractOpen ? "rotate(180deg)" : "rotate(0deg)" }}
                  size={14}
                />
              </button>
            </CardHeader>

            {contractOpen && (
              <CardContent className="pt-4 pb-4 space-y-0">
                {/* Provider */}
                <div className="flex items-center justify-between py-2 border-b border-zinc-800/60">
                  <span className="text-[11px] text-zinc-500 uppercase tracking-wider">Provider</span>
                  <span className="text-xs font-semibold text-zinc-200">{MOCK_CONTRACT.provider_name}</span>
                </div>

                {/* Zone rates */}
                {(
                  [
                    ["Zone A", MOCK_CONTRACT.zone_a_rate],
                    ["Zone B", MOCK_CONTRACT.zone_b_rate],
                    ["Zone C", MOCK_CONTRACT.zone_c_rate],
                  ] as [string, number][]
                ).map(([label, rate]) => (
                  <div
                    key={label}
                    className="flex items-center justify-between py-2 border-b border-zinc-800/60"
                  >
                    <span className="text-[11px] text-zinc-500 uppercase tracking-wider">{label}</span>
                    <span className="text-xs font-mono text-zinc-300">
                      ₹{rate}
                      <span className="text-zinc-600"> / 500g</span>
                    </span>
                  </div>
                ))}

                {/* COD fee */}
                <div className="flex items-center justify-between py-2 border-b border-zinc-800/60">
                  <span className="text-[11px] text-zinc-500 uppercase tracking-wider">COD Fee</span>
                  <span className="text-xs font-mono text-zinc-300">
                    {MOCK_CONTRACT.cod_fee_percentage}
                    <span className="text-zinc-600">%</span>
                  </span>
                </div>

                {/* RTO */}
                <div className="flex items-center justify-between py-2">
                  <span className="text-[11px] text-zinc-500 uppercase tracking-wider">RTO Flat Fee</span>
                  <span className="text-xs font-mono text-zinc-300">
                    ₹{MOCK_CONTRACT.rto_flat_fee}
                    <span className="text-zinc-600"> flat</span>
                  </span>
                </div>
              </CardContent>
            )}
          </Card>
        </div>

        {/* ── KPI Metrics ── */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">

          <Card className="bg-zinc-950 border border-zinc-800/70 shadow-none">
            <CardContent className="pt-6 pb-5">
              <p className="text-[11px] text-zinc-500 uppercase tracking-widest mb-2">
                Total Rows Processed
              </p>
              <p className="text-4xl font-bold text-white tabular-nums">
                {analysisResults ? analysisResults.totalRows.toLocaleString("en-IN") : "—"}
              </p>
              <p className="text-[11px] text-zinc-600 mt-1.5">shipments scanned</p>
            </CardContent>
          </Card>

          <Card className="bg-zinc-950 border border-zinc-800/70 shadow-none">
            <CardContent className="pt-6 pb-5">
              <p className="text-[11px] text-zinc-500 uppercase tracking-widest mb-2">
                Total Amount Billed
              </p>
              <p className="text-4xl font-bold text-white tabular-nums">
                {analysisResults
                  ? `₹${analysisResults.totalBilled.toLocaleString("en-IN", { minimumFractionDigits: 2 })}`
                  : "—"}
              </p>
              <p className="text-[11px] text-zinc-600 mt-1.5">across all AWBs</p>
            </CardContent>
          </Card>

          {/* Glowing recovery card */}
          <Card
            className="border shadow-none transition-all duration-500"
            style={{
              background: hasOvercharge
                ? "radial-gradient(ellipse 130% 130% at 50% 110%, rgba(220,38,38,0.2) 0%, #09090b 58%)"
                : "#09090b",
              borderColor: hasOvercharge ? "rgba(220,38,38,0.45)" : "rgba(39,39,42,0.7)",
              boxShadow: hasOvercharge
                ? "0 0 36px rgba(220,38,38,0.18), inset 0 0 24px rgba(220,38,38,0.06)"
                : "none",
            }}
          >
            <CardContent className="pt-6 pb-5">
              <p className="text-[11px] text-zinc-500 uppercase tracking-widest mb-2">
                Amount Recoverable
              </p>
              <p
                className="text-4xl font-bold tabular-nums transition-colors duration-500"
                style={{ color: hasOvercharge ? "rgb(248,113,113)" : "white" }}
              >
                {analysisResults
                  ? `₹${analysisResults.totalOvercharge.toLocaleString("en-IN", { minimumFractionDigits: 2 })}`
                  : "—"}
              </p>
              <p className="text-[11px] text-zinc-600 mt-1.5">
                {analysisResults
                  ? `${analysisResults.discrepancies.length} discrepancies flagged`
                  : "overcharged by provider"}
              </p>
            </CardContent>
          </Card>
        </div>

        {/* ── Donut Chart — Overcharge Breakdown ── */}
        {analysisResults && chartData.length > 0 && (
          <Card className="bg-zinc-950 border border-zinc-800/70 shadow-none">
            <CardHeader className="pb-0">
              <CardTitle className="text-[11px] text-zinc-500 font-semibold uppercase tracking-widest">
                Overcharge Breakdown by Issue Type
              </CardTitle>
              <p className="text-[11px] text-zinc-600">
                ₹ attributed proportionally when multiple issues apply to one shipment
              </p>
            </CardHeader>
            <CardContent className="pt-4">
              <div className="flex flex-col md:flex-row items-center gap-8">

                {/* Donut */}
                <div className="w-full md:w-[280px] flex-shrink-0">
                  <ChartContainer
                    config={chartConfig}
                    className="h-[240px] w-full"
                  >
                    <PieChart>
                      <ChartTooltip
                        cursor={false}
                        content={
                          <ChartTooltipContent
                            hideLabel
                            formatter={(value, name) => (
                              <div className="flex items-center gap-2 text-xs">
                                <span className="text-zinc-400">{name}</span>
                                <span className="font-mono font-semibold text-white">
                                  ₹{Number(value).toFixed(2)}
                                </span>
                              </div>
                            )}
                          />
                        }
                      />
                      <Pie
                        data={chartData}
                        dataKey="amount"
                        nameKey="issueType"
                        innerRadius={72}
                        outerRadius={108}
                        paddingAngle={3}
                        strokeWidth={0}
                      >
                        {chartData.map((_, i) => (
                          <Cell
                            key={i}
                            fill={CHART_PALETTE[i % CHART_PALETTE.length]}
                            stroke="transparent"
                          />
                        ))}
                        <Label
                          content={({ viewBox }) => {
                            if (!viewBox || !("cx" in viewBox)) return null
                            const { cx, cy } = viewBox as { cx: number; cy: number }
                            return (
                              <g>
                                <text
                                  x={cx}
                                  y={cy - 8}
                                  textAnchor="middle"
                                  fill="rgb(248,113,113)"
                                  fontSize={18}
                                  fontWeight={700}
                                  fontFamily="monospace"
                                >
                                  ₹{analysisResults.totalOvercharge.toLocaleString("en-IN")}
                                </text>
                                <text
                                  x={cx}
                                  y={cy + 12}
                                  textAnchor="middle"
                                  fill="rgb(82,82,91)"
                                  fontSize={10}
                                  letterSpacing={1}
                                >
                                  TOTAL LOST
                                </text>
                              </g>
                            )
                          }}
                        />
                      </Pie>
                    </PieChart>
                  </ChartContainer>
                </div>

                {/* Legend / breakdown list */}
                <div className="flex flex-col gap-3 w-full">
                  {chartData.map((item, i) => {
                    const pct =
                      analysisResults.totalOvercharge > 0
                        ? ((item.amount / analysisResults.totalOvercharge) * 100).toFixed(1)
                        : "0"
                    return (
                      <div key={i} className="flex items-center gap-3 group">
                        {/* colour swatch */}
                        <div
                          className="w-2.5 h-2.5 rounded-sm flex-shrink-0"
                          style={{ backgroundColor: CHART_PALETTE[i % CHART_PALETTE.length] }}
                        />
                        {/* label + progress bar */}
                        <div className="flex-1 min-w-0">
                          <div className="flex justify-between items-baseline mb-1">
                            <span className="text-xs text-zinc-300 truncate pr-2">{item.issueType}</span>
                            <span className="text-xs font-mono text-zinc-500 flex-shrink-0">
                              {item.count} AWB{item.count !== 1 ? "s" : ""}
                            </span>
                          </div>
                          <div className="h-1 w-full bg-zinc-800 rounded-full overflow-hidden">
                            <div
                              className="h-full rounded-full transition-all duration-700"
                              style={{
                                width: `${pct}%`,
                                backgroundColor: CHART_PALETTE[i % CHART_PALETTE.length],
                                opacity: 0.85,
                              }}
                            />
                          </div>
                        </div>
                        {/* amount */}
                        <span
                          className="text-xs font-mono font-semibold flex-shrink-0 w-24 text-right"
                          style={{ color: CHART_PALETTE[i % CHART_PALETTE.length] }}
                        >
                          ₹{item.amount.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                        </span>
                        <span className="text-[11px] text-zinc-600 w-10 text-right flex-shrink-0">
                          {pct}%
                        </span>
                      </div>
                    )
                  })}
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* ── Discrepancy Table ── */}
        {analysisResults && (
          <Card className="bg-zinc-950 border border-zinc-800/70 shadow-none">
            <CardHeader className="flex flex-row items-center justify-between pb-3 pr-4">
              <div>
                <CardTitle className="text-[11px] text-zinc-500 font-semibold uppercase tracking-widest">
                  Discrepancy Report
                </CardTitle>
                <p className="text-xs text-zinc-600 mt-0.5">
                  {analysisResults.discrepancies.length === 0
                    ? "No overcharges detected"
                    : `${analysisResults.discrepancies.length} flagged shipments`}
                </p>
              </div>
              <Button
                onClick={handleExport}
                disabled={analysisResults.discrepancies.length === 0}
                size="sm"
                className="bg-red-800 hover:bg-red-700 disabled:opacity-30
                           text-white border-0 text-xs tracking-wide h-8 px-4"
              >
                Download Payout File
              </Button>
            </CardHeader>

            <CardContent className="p-0">
              {analysisResults.discrepancies.length === 0 ? (
                <div className="py-16 flex flex-col items-center gap-3">
                  <div className="w-10 h-10 rounded-full border border-zinc-800 flex items-center justify-center">
                    <div className="w-3 h-3 rounded-full bg-zinc-700" />
                  </div>
                  <p className="text-zinc-600 text-sm">
                    Billing matches contract rates — no overcharges detected.
                  </p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow className="border-zinc-800/60 hover:bg-transparent">
                        <TableHead className="pl-6 text-[11px] text-zinc-500 uppercase tracking-wider font-semibold">
                          AWB Number
                        </TableHead>
                        <TableHead className="text-[11px] text-zinc-500 uppercase tracking-wider font-semibold">
                          Issue Type
                        </TableHead>
                        <TableHead className="text-[11px] text-zinc-500 uppercase tracking-wider font-semibold text-right">
                          Billed (₹)
                        </TableHead>
                        <TableHead className="text-[11px] text-zinc-500 uppercase tracking-wider font-semibold text-right">
                          Correct (₹)
                        </TableHead>
                        <TableHead className="pr-6 text-[11px] text-zinc-500 uppercase tracking-wider font-semibold text-right">
                          Difference (₹)
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {analysisResults.discrepancies.map((d, i) => (
                        <TableRow
                          key={i}
                          className="border-zinc-800/40 hover:bg-zinc-900/50 transition-colors"
                        >
                          <TableCell className="pl-6 font-mono text-xs text-zinc-300 py-3">
                            {d.awb_number}
                          </TableCell>
                          <TableCell className="py-3">
                            <Badge className="bg-red-950/80 text-red-400 border border-red-900/60 text-[11px] font-normal rounded-sm px-2 py-0.5">
                              {d.issue_type}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right text-zinc-400 text-sm tabular-nums py-3">
                            {d.billed_amount.toFixed(2)}
                          </TableCell>
                          <TableCell className="text-right text-zinc-400 text-sm tabular-nums py-3">
                            {d.correct_amount.toFixed(2)}
                          </TableCell>
                          <TableCell className="pr-6 text-right font-semibold text-red-400 text-sm tabular-nums py-3">
                            +{d.difference.toFixed(2)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* ── Empty state ── */}
        {!analysisResults && !isProcessing && (
          <div className="flex flex-col items-center justify-center py-28 space-y-4">
            <div
              className="w-16 h-16 rounded-full border border-zinc-800 flex items-center justify-center"
              style={{ boxShadow: "0 0 24px rgba(220,38,38,0.08)" }}
            >
              <div className="w-5 h-5 rounded-full bg-red-950/70" />
            </div>
            <p className="text-zinc-600 text-sm">Upload a CSV file to begin the audit</p>
          </div>
        )}

        {/* ── Footer ── */}
        <p className="text-center text-zinc-800 text-xs pb-4 tracking-wide">
          Mosaic Wellness · Logistics Intelligence Platform
        </p>
      </div>
    </div>
  )
}
