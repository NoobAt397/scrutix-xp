"use client"

import { useState, useMemo, useEffect } from "react"
import { ChevronDown, UploadCloud, FileText, X, Download } from "lucide-react"
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
import { analyzeInvoice, type AnalysisResult, type ContractRules, type Discrepancy } from "@/lib/billing-engine"
import { detectColumns, REQUIRED_CANONICAL, type DetectionResult } from "@/lib/column-matcher"
import { findHeaderRow, normalizeRows, applyMapping } from "@/lib/csv-normalizer"
import { useToast } from "@/hooks/use-toast"
import EvidenceModal from "@/components/EvidenceModal"
import ColumnMappingModal from "@/components/ColumnMappingModal"
import PDFPreviewModal from "@/components/PDFPreviewModal"
import type { ExtractionSource } from "@/app/api/extract-invoice/route"
import {
  buildAuditRecord,
  saveAuditRecord,
  loadAuditHistory,
  clearAuditHistory,
  type AuditRecord,
} from "@/lib/audit-history"
import AnalyticsDashboard from "@/components/AnalyticsDashboard"
import { exportPayoutExcel } from "@/lib/excel-export"
import {
  storeWeightData,
  loadWeightData,
  clearWeightData,
  type WeightDataPoint,
} from "@/lib/weight-regression"

// ── Constants ────────────────────────────────────────────────────────────────

const PROVIDER_CONTRACTS = {
  Delhivery:       { provider_name: "Delhivery",    zone_a_rate: 40, zone_b_rate: 55, zone_c_rate: 75, cod_fee_percentage: 1.5, rto_flat_fee: 30, fuel_surcharge_percentage: 15, docket_charge: 30, gst_percentage: 18 },
  BlueDart:        { provider_name: "BlueDart",      zone_a_rate: 55, zone_b_rate: 72, zone_c_rate: 95, cod_fee_percentage: 2.0, rto_flat_fee: 45, fuel_surcharge_percentage: 18, docket_charge: 50, gst_percentage: 18 },
  "Ecom Express":  { provider_name: "Ecom Express", zone_a_rate: 35, zone_b_rate: 48, zone_c_rate: 65, cod_fee_percentage: 1.2, rto_flat_fee: 25, fuel_surcharge_percentage: 12, docket_charge: 25, gst_percentage: 18 },
  Shadowfax:       { provider_name: "Shadowfax",     zone_a_rate: 30, zone_b_rate: 42, zone_c_rate: 58, cod_fee_percentage: 1.0, rto_flat_fee: 20, fuel_surcharge_percentage: 10, docket_charge: 20, gst_percentage: 18 },
} as const

type ProviderName = keyof typeof PROVIDER_CONTRACTS

// Full contract shape used throughout the component.
// Merges ContractRules (for billing engine) with a display name.
type FullContract = ContractRules & { provider_name: string }

const CHART_PALETTE = [
  "#ef4444", // red-500
  "#f97316", // orange-500
  "#f43f5e", // rose-500
  "#fb923c", // orange-400
  "#fbbf24", // amber-400
]

// ── Component ─────────────────────────────────────────────────────────────────

export default function Home() {
  const { toast } = useToast()
  const [selectedProvider, setSelectedProvider] = useState<ProviderName>("Delhivery")
  const [extractedContract, setExtractedContract] = useState<FullContract | null>(null)
  const [isExtracting, setIsExtracting] = useState(false)
  // Active contract: prefer AI-extracted over preset
  const activeContract: FullContract =
    extractedContract ?? (PROVIDER_CONTRACTS[selectedProvider] as FullContract)
  const [analysisResults, setAnalysisResults] = useState<AnalysisResult | null>(null)
  const [isProcessing, setIsProcessing] = useState(false)
  const [fileName, setFileName] = useState<string | null>(null)
  const [contractOpen, setContractOpen] = useState(true)
  const [selectedDiscrepancy, setSelectedDiscrepancy] = useState<Discrepancy | null>(null)
  const [currentPage, setCurrentPage] = useState(0)
  // Column mapping modal state
  const [pendingRawHeaders, setPendingRawHeaders] = useState<string[]>([])
  const [pendingRawRows, setPendingRawRows] = useState<Record<string, unknown>[] | null>(null)
  const [pendingDetection, setPendingDetection] = useState<DetectionResult | null>(null)
  const [analysisWarnings, setAnalysisWarnings] = useState<string[]>([])
  // PDF invoice preview state
  const [pendingPdfPreview, setPendingPdfPreview] = useState<{
    rows: Record<string, unknown>[]
    source: ExtractionSource
    pageCount: number
    fileName: string
  } | null>(null)
  const [isPdfExtracting, setIsPdfExtracting] = useState(false)
  // Tab + analytics history
  const [activeTab, setActiveTab] = useState<"audit" | "analytics">("audit")
  const [auditHistory, setAuditHistory] = useState<AuditRecord[]>([])
  const [weightData, setWeightData] = useState<WeightDataPoint[]>([])
  // Full normalized rows from most recent audit (needed for Excel export Sheet 2 & 3)
  const [lastMappedRows, setLastMappedRows] = useState<Record<string, unknown>[]>([])

  // Load history from localStorage on client mount
  useEffect(() => {
    setAuditHistory(loadAuditHistory())
    setWeightData(loadWeightData())
  }, [])

  const PAGE_SIZE = 50

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

  // ── Core analysis runner (shared by auto + manual mapping paths) ─────────────
  // fileNameHint: pass file.name when calling synchronously from the same event
  // handler as setFileName (React state batching means fileName won't be updated yet).
  function runAnalysis(mappedRows: Record<string, unknown>[], fileNameHint?: string) {
    // Build warnings for missing optional columns
    const warnings: string[] = []
    const first = mappedRows[0] ?? {}
    if (!("Length" in first) || !("Width" in first) || !("Height" in first)) {
      warnings.push("Volumetric weight check skipped — no dimension columns (Length, Width, Height) found.")
    }
    if (!("OriginPincode" in first) || !("DestPincode" in first)) {
      warnings.push("Pincode zone validation skipped — OriginPincode / DestPincode not detected.")
    }
    setAnalysisWarnings(warnings)

    const analysis = analyzeInvoice(mappedRows as any[], activeContract)
    setAnalysisResults(analysis)
    setLastMappedRows(mappedRows)
    setCurrentPage(0)
    setIsProcessing(false)

    // Persist this audit run to analytics history
    const record = buildAuditRecord({
      analysisResult: analysis,
      providerName:   activeContract.provider_name,
      fileName:       fileNameHint ?? fileName ?? "unknown",
    })
    saveAuditRecord(record)
    setAuditHistory((prev) => [...prev, record])

    // ── Weight regression data collection ─────────────────────────────────────
    // Canonical fields from normalizeRows are in kg; convert to grams for storage
    const provider = activeContract.provider_name
    const now = Date.now()
    const newWeightPoints: WeightDataPoint[] = []
    for (const row of mappedRows) {
      const declared = Number(row["ActualWeight"] ?? 0)
      const billed   = Number(row["BilledWeight"]  ?? 0)
      const awb      = String(row["AWB"] ?? "")
      if (declared > 0 && billed > 0 && awb) {
        newWeightPoints.push({
          provider,
          awb,
          declaredWeight_g: Math.round(declared * 1000),
          billedWeight_g:   Math.round(billed   * 1000),
          date: now,
        })
      }
    }
    if (newWeightPoints.length > 0) {
      storeWeightData(newWeightPoints)
      setWeightData((prev) => [...prev, ...newWeightPoints])
    }
  }

  // ── Called when user confirms mapping in the modal ────────────────────────
  function handleMappingConfirm(confirmedMapping: Record<string, string | null>) {
    if (!pendingRawRows) return
    setPendingDetection(null)

    setIsProcessing(true)
    const mapped    = applyMapping(pendingRawRows, confirmedMapping)
    const finalRows = normalizeRows(mapped)
    setPendingRawRows(null)

    if (finalRows.length === 0) {
      toast({
        variant: "destructive",
        title: "No Valid Rows",
        description: "No rows contained both AWB and Total Billed Amount after mapping.",
      })
      setFileName(null)
      setIsProcessing(false)
      return
    }

    toast({
      title: "Columns confirmed. Auditing…",
      description: `${finalRows.length} rows ready.`,
    })
    runAnalysis(finalRows)
  }

  // ── File upload entry point ────────────────────────────────────────────────
  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    // Reset input so the same file can be re-selected
    e.target.value = ""

    // Route PDF invoice files to the dedicated handler
    if (file.name.toLowerCase().endsWith(".pdf") || file.type === "application/pdf") {
      await handleInvoicePdfUpload(file)
      return
    }

    setFileName(file.name)
    setIsProcessing(true)
    setAnalysisResults(null)
    setAnalysisWarnings([])

    try {
      // ── 1. Parse file to raw string arrays (CSV or XLSX) ──────────────────
      let rawArrays: string[][]

      if (file.name.endsWith(".xlsx") || file.name.endsWith(".xls")) {
        // SheetJS — dynamic import to keep initial bundle lean
        const XLSX = await import("xlsx")
        const buffer = await file.arrayBuffer()
        const wb    = XLSX.read(new Uint8Array(buffer), { type: "array" })
        const sheet = wb.Sheets[wb.SheetNames[0]]
        rawArrays   = XLSX.utils.sheet_to_json(sheet, {
          header: 1,
          defval: "",
          raw:    false,
        }) as string[][]
      } else {
        // PapaParse with auto-delimiter detection
        rawArrays = await new Promise<string[][]>((resolve, reject) => {
          Papa.parse(file, {
            header:        false,
            delimiter:     "",        // auto-detect: comma, semicolon, tab
            dynamicTyping: false,     // keep strings; normalizers handle conversion
            skipEmptyLines: true,
            complete: (r) => resolve(r.data as string[][]),
            error:    (err) => reject(err),
          })
        })
      }

      if (rawArrays.length < 2) {
        toast({ variant: "destructive", title: "Empty File", description: "The file contains no data rows." })
        setFileName(null)
        setIsProcessing(false)
        return
      }

      // ── 2. Multi-row header detection ─────────────────────────────────────
      const headerIdx = findHeaderRow(rawArrays)
      const headers   = rawArrays[headerIdx].map((h) => String(h ?? "").trim()).filter(Boolean)
      const dataRows  = rawArrays.slice(headerIdx + 1)

      // Build objects from detected header row
      const rawRows: Record<string, unknown>[] = dataRows
        .map((row) => {
          const obj: Record<string, unknown> = {}
          headers.forEach((h, i) => { obj[h] = row[i] ?? null })
          return obj
        })
        .filter((row) => Object.values(row).some((v) => v !== null && v !== ""))

      if (rawRows.length === 0) {
        toast({ variant: "destructive", title: "No Data", description: "Could not find any data rows after detecting the header." })
        setFileName(null)
        setIsProcessing(false)
        return
      }

      // ── 3. Fast path: headers already match standard schema ───────────────
      const alreadyStandard = REQUIRED_CANONICAL.every((col) => col in rawRows[0])
      if (alreadyStandard) {
        runAnalysis(normalizeRows(rawRows), file.name)
        return
      }

      // ── 4. Fuzzy column detection ─────────────────────────────────────────
      const detection = detectColumns(headers)

      if (!detection.needsManualReview) {
        // All required fields detected with ≥ 80% confidence — apply silently
        const mapped    = applyMapping(rawRows, detection.mapping)
        const finalRows = normalizeRows(mapped)

        if (finalRows.length > 0) {
          toast({
            title: "Columns auto-mapped",
            description: `${headers.length} columns mapped with high confidence.`,
          })
          runAnalysis(finalRows, file.name)
          return
        }
      }

      // ── 5. Low confidence → show ColumnMappingModal ───────────────────────
      setPendingRawHeaders(headers)
      setPendingRawRows(rawRows)
      setPendingDetection(detection)
      setIsProcessing(false)

    } catch (err) {
      console.error("[handleFileUpload]", err)
      toast({
        variant: "destructive",
        title: "File Read Error",
        description: "Could not parse the file. Please check it is a valid CSV or Excel file.",
      })
      setFileName(null)
      setIsProcessing(false)
    }
  }

  async function handleExport() {
    if (!analysisResults) return
    try {
      const disputeCount = await exportPayoutExcel({
        analysisResult: analysisResults,
        mappedRows:     lastMappedRows,
        providerName:   activeContract.provider_name,
      })
      toast({
        title: "Payout file exported",
        description: disputeCount > 0
          ? `${disputeCount} dispute${disputeCount !== 1 ? "s" : ""} ready to send`
          : "All charges verified — no disputes found",
      })
    } catch (err) {
      console.error("[handleExport]", err)
      toast({ variant: "destructive", title: "Export Failed", description: "Could not generate the Excel file." })
    }
  }

  async function handlePdfUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    // Reset so the same file can be re-uploaded after clearing
    e.target.value = ""

    setIsExtracting(true)

    const { id, update } = toast({
      title: "Reading PDF contract…",
      description: `Sending ${file.name} to Gemini for analysis`,
    })

    try {
      const form = new FormData()
      form.append("file", file)

      const res = await fetch("/api/extract-contract", {
        method: "POST",
        body: form,
      })

      if (!res.ok) throw new Error("extraction failed")

      const data: FullContract = await res.json()
      setExtractedContract(data)

      update({
        id,
        title: "Contract Extracted",
        description: `${data.provider_name ?? "Custom"} rates loaded. Re-run your CSV to apply.`,
      })
    } catch {
      update({
        id,
        variant: "destructive",
        title: "Extraction Failed",
        description: "Could not parse the PDF. Ensure it is a valid courier contract.",
      })
    } finally {
      setIsExtracting(false)
    }
  }

  // ── Invoice PDF upload (separate from contract PDF upload) ─────────────────
  async function handleInvoicePdfUpload(file: File) {
    setFileName(file.name)
    setIsProcessing(false)
    setIsPdfExtracting(true)
    setAnalysisResults(null)
    setAnalysisWarnings([])

    const { id, update } = toast({
      title: "Reading PDF invoice…",
      description: `Extracting table data from ${file.name}`,
    })

    try {
      const form = new FormData()
      form.append("file", file)

      const res = await fetch("/api/extract-invoice", {
        method: "POST",
        body: form,
      })

      if (!res.ok) throw new Error("extraction failed")

      const data = await res.json() as {
        rows: Record<string, unknown>[]
        source: ExtractionSource
        pageCount: number
      }

      if (!data.rows || data.rows.length === 0) {
        update({
          id,
          variant: "destructive",
          title: "No Rows Found",
          description: "Could not extract any table rows from this PDF.",
        })
        setFileName(null)
        return
      }

      update({
        id,
        title: "Invoice Extracted",
        description: `${data.rows.length} rows found via ${data.source === "ai" ? "Gemini AI" : "text extraction"}. Review before auditing.`,
      })

      setPendingPdfPreview({ rows: data.rows, source: data.source, pageCount: data.pageCount, fileName: file.name })
    } catch {
      update({
        id,
        variant: "destructive",
        title: "Extraction Failed",
        description: "Could not parse the PDF. Try a text-based PDF or a CSV export.",
      })
      setFileName(null)
    } finally {
      setIsPdfExtracting(false)
    }
  }

  // ── Called when user confirms PDF preview and clicks "Run Audit" ────────────
  function handlePdfPreviewConfirm(rows: Record<string, unknown>[], source: ExtractionSource) {
    setPendingPdfPreview(null)
    setIsProcessing(true)

    if (source === "ai") {
      // Gemini has already normalised field names — run directly
      runAnalysis(normalizeRows(rows))
      return
    }

    // Text-extracted rows have raw header names — run through column detection
    const headers = Object.keys(rows[0] ?? {})
    const alreadyStandard = REQUIRED_CANONICAL.every((col) => col in (rows[0] ?? {}))

    if (alreadyStandard) {
      runAnalysis(normalizeRows(rows))
      return
    }

    const detection = detectColumns(headers)

    if (!detection.needsManualReview) {
      const mapped = applyMapping(rows, detection.mapping)
      const finalRows = normalizeRows(mapped)
      if (finalRows.length > 0) {
        toast({ title: "Columns auto-mapped", description: `${headers.length} columns detected.` })
        runAnalysis(finalRows)
        return
      }
    }

    // Low confidence — show mapping modal
    setPendingRawHeaders(headers)
    setPendingRawRows(rows)
    setPendingDetection(detection)
    setIsProcessing(false)
  }

  // ── Derived booleans + pagination ──────────────────────────────────────────

  const hasOvercharge = (analysisResults?.totalOvercharge ?? 0) > 0
  const totalDiscrepancies = analysisResults?.discrepancies.length ?? 0
  const totalPages = Math.ceil(totalDiscrepancies / PAGE_SIZE)
  const pagedDiscrepancies = analysisResults?.discrepancies.slice(
    currentPage * PAGE_SIZE,
    (currentPage + 1) * PAGE_SIZE
  ) ?? []

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
            <span className="text-zinc-600">Demo contract: {activeContract.provider_name}</span>
          </p>
        </header>

        {/* ── Tab navigation ── */}
        <div className="flex items-center gap-0 border-b border-zinc-800/40 -mb-1">
          {(["audit", "analytics"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className="relative px-5 py-2.5 text-xs font-medium uppercase tracking-widest transition-colors"
              style={{ color: activeTab === tab ? "rgb(212,212,216)" : "rgb(82,82,91)" }}
            >
              {tab === "audit" ? "Audit" : "Analytics"}
              {activeTab === tab && (
                <span
                  className="absolute bottom-0 left-0 right-0 h-px"
                  style={{ background: "rgb(239,68,68)" }}
                />
              )}
            </button>
          ))}
          {auditHistory.length > 0 && (
            <span className="ml-auto text-[10px] text-zinc-700 pr-2 tabular-nums">
              {auditHistory.length} audit{auditHistory.length !== 1 ? "s" : ""} tracked
            </span>
          )}
        </div>

        {/* ── Audit Tab Content ── */}
        {activeTab === "audit" && (<>

        {/* ── Upload + Contract Rules row ── */}
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-4 items-start">

          {/* Upload Card */}
          <Card className="bg-zinc-950 border border-zinc-800/70 shadow-none">
            <CardHeader className="pb-2">
              <CardTitle className="text-[11px] text-zinc-500 font-semibold uppercase tracking-widest">
                Upload Invoice
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {/* Dropzone */}
              <label
                className="flex flex-col items-center justify-center gap-3 w-full py-8 px-4
                           rounded-lg border-2 border-dashed border-zinc-700
                           hover:border-zinc-500 hover:bg-zinc-900/40
                           cursor-pointer transition-all duration-200 group"
              >
                <UploadCloud
                  className="w-9 h-9 text-zinc-600 group-hover:text-zinc-400 transition-colors duration-200"
                  strokeWidth={1.5}
                />
                <div className="text-center space-y-1">
                  <p className="text-sm font-medium text-zinc-400 group-hover:text-zinc-300 transition-colors">
                    {fileName && !isProcessing && !isPdfExtracting
                      ? fileName
                      : isPdfExtracting
                      ? "Extracting PDF…"
                      : "Click to upload Invoice"}
                  </p>
                  <p className="text-[11px] text-zinc-600">
                    CSV, XLSX, PDF · comma / semicolon / tab delimiters · multi-row headers auto-skipped
                  </p>
                  <p className="text-[11px] text-zinc-700 mt-0.5">
                    Columns auto-detected · scanned PDFs parsed by Gemini AI
                  </p>
                </div>
                <Input
                  type="file"
                  accept=".csv,.xlsx,.xls,.pdf"
                  onChange={handleFileUpload}
                  className="hidden"
                />
              </label>

              {(isProcessing || isPdfExtracting) && (
                <p className="text-xs text-red-400 animate-pulse flex items-center gap-2">
                  <span className="inline-block w-1.5 h-1.5 rounded-full bg-red-500 animate-ping" />
                  {isPdfExtracting ? `Extracting ${fileName}…` : `Analyzing ${fileName}…`}
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
                  {/* AI badge — changes colour based on extraction state */}
                  <span
                    className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-sm border text-[10px] font-medium tracking-wide transition-all duration-300"
                    style={
                      isExtracting
                        ? { background: "rgba(217,119,6,0.12)", borderColor: "rgba(217,119,6,0.35)", color: "rgb(252,211,77)" }
                        : extractedContract
                        ? { background: "rgba(22,163,74,0.12)", borderColor: "rgba(22,163,74,0.35)", color: "rgb(134,239,172)" }
                        : { background: "rgba(124,58,237,0.12)", borderColor: "rgba(124,58,237,0.35)", color: "rgb(167,139,250)" }
                    }
                  >
                    <span
                      className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${isExtracting ? "animate-ping" : ""}`}
                      style={{
                        backgroundColor: isExtracting
                          ? "rgb(252,211,77)"
                          : extractedContract
                          ? "rgb(134,239,172)"
                          : "rgb(167,139,250)",
                      }}
                    />
                    {isExtracting
                      ? "Extracting PDF…"
                      : extractedContract
                      ? "✓ AI Extracted"
                      : "AI Extracted from PDF"}
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
              <CardContent className="pt-3 pb-4 space-y-0">
                {/* Provider selector — preset tabs or extracted contract info */}
                <div className="pb-3 border-b border-zinc-800/60 space-y-2">
                  {extractedContract ? (
                    /* Extracted contract header */
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-green-400 font-medium">
                        {extractedContract.provider_name}
                      </span>
                      <button
                        onClick={() => setExtractedContract(null)}
                        className="flex items-center gap-1 text-[10px] text-zinc-600 hover:text-zinc-400 transition-colors"
                      >
                        <X size={10} />
                        Reset to preset
                      </button>
                    </div>
                  ) : (
                    /* Preset provider pill tabs */
                    <div className="flex flex-wrap gap-1.5">
                      {(Object.keys(PROVIDER_CONTRACTS) as ProviderName[]).map((name) => (
                        <button
                          key={name}
                          onClick={() => setSelectedProvider(name)}
                          className="px-2.5 py-1 rounded-sm text-[10px] font-medium tracking-wide transition-all duration-150"
                          style={
                            selectedProvider === name
                              ? { background: "rgba(220,38,38,0.2)", color: "rgb(252,165,165)", border: "1px solid rgba(220,38,38,0.45)" }
                              : { background: "transparent", color: "rgb(82,82,91)", border: "1px solid rgba(63,63,70,0.6)" }
                          }
                        >
                          {name}
                        </button>
                      ))}
                    </div>
                  )}

                  {/* PDF upload trigger */}
                  <label
                    className={`flex items-center justify-center gap-2 w-full py-1.5 rounded-sm border border-dashed cursor-pointer transition-all duration-200 ${
                      isExtracting
                        ? "border-amber-800/40 text-amber-600 cursor-not-allowed"
                        : "border-zinc-700/60 text-zinc-600 hover:border-zinc-500 hover:text-zinc-400"
                    }`}
                  >
                    <FileText size={11} />
                    <span className="text-[10px] font-medium tracking-wide">
                      {isExtracting ? "Extracting…" : "Upload PDF Contract"}
                    </span>
                    <input
                      type="file"
                      accept="application/pdf"
                      disabled={isExtracting}
                      onChange={handlePdfUpload}
                      className="hidden"
                    />
                  </label>
                </div>

                {/* Zone rates */}
                {(
                  [
                    ["Zone A", activeContract.zone_a_rate],
                    ["Zone B", activeContract.zone_b_rate],
                    ["Zone C", activeContract.zone_c_rate],
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
                    {activeContract.cod_fee_percentage}
                    <span className="text-zinc-600">%</span>
                  </span>
                </div>

                {/* Fuel surcharge */}
                <div className="flex items-center justify-between py-2 border-b border-zinc-800/60">
                  <span className="text-[11px] text-zinc-500 uppercase tracking-wider">Fuel Surcharge</span>
                  <span className="text-xs font-mono text-zinc-300">
                    {activeContract.fuel_surcharge_percentage}
                    <span className="text-zinc-600">%</span>
                  </span>
                </div>

                {/* Docket charge */}
                <div className="flex items-center justify-between py-2 border-b border-zinc-800/60">
                  <span className="text-[11px] text-zinc-500 uppercase tracking-wider">Docket Charge</span>
                  <span className="text-xs font-mono text-zinc-300">
                    ₹{activeContract.docket_charge}
                    <span className="text-zinc-600"> flat</span>
                  </span>
                </div>

                {/* GST */}
                <div className="flex items-center justify-between py-2 border-b border-zinc-800/60">
                  <span className="text-[11px] text-zinc-500 uppercase tracking-wider">GST</span>
                  <span className="text-xs font-mono text-zinc-300">
                    {activeContract.gst_percentage}
                    <span className="text-zinc-600">% (statutory)</span>
                  </span>
                </div>

                {/* RTO */}
                <div className="flex items-center justify-between py-2">
                  <span className="text-[11px] text-zinc-500 uppercase tracking-wider">RTO Flat Fee</span>
                  <span className="text-xs font-mono text-zinc-300">
                    ₹{activeContract.rto_flat_fee}
                    <span className="text-zinc-600"> + GST</span>
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
            className="border shadow-none transition-all duration-500 overflow-hidden"
            style={{
              background: hasOvercharge
                ? "radial-gradient(ellipse 130% 130% at 50% 110%, rgba(220,38,38,0.22) 0%, #09090b 58%)"
                : "#09090b",
              borderColor: hasOvercharge ? "rgba(220,38,38,0.5)" : "rgba(39,39,42,0.7)",
              boxShadow: hasOvercharge
                ? "0 0 48px rgba(220,38,38,0.22), inset 0 0 32px rgba(220,38,38,0.08)"
                : "none",
            }}
          >
            {/* Accent top-bar — visible only when overcharge exists */}
            <div
              className="h-0.5 w-full transition-opacity duration-500"
              style={{
                background: "linear-gradient(90deg, transparent, rgba(220,38,38,0.7) 50%, transparent)",
                opacity: hasOvercharge ? 1 : 0,
              }}
            />
            <CardContent className="pt-5 pb-5">
              <p className="text-[11px] text-zinc-500 uppercase tracking-widest mb-2">
                Amount Recoverable
              </p>
              <p
                className="text-5xl font-bold tabular-nums leading-none transition-colors duration-500"
                style={{ color: hasOvercharge ? "rgb(248,113,113)" : "white" }}
              >
                {analysisResults
                  ? `₹${analysisResults.totalOvercharge.toLocaleString("en-IN", { minimumFractionDigits: 2 })}`
                  : "—"}
              </p>
              <p className="text-[11px] text-zinc-600 mt-2">
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
                size="sm"
                className="disabled:opacity-30 text-white border-0 text-xs tracking-wide h-8 px-4
                           hover:opacity-90 transition-opacity flex items-center gap-1.5"
                style={{ backgroundColor: "#1F4D3F" }}
              >
                <Download size={12} />
                Export Payout File
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
                        <TableHead className="text-[11px] text-zinc-500 uppercase tracking-wider font-semibold text-right">
                          Difference (₹)
                        </TableHead>
                        <TableHead className="pr-4 w-20" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {pagedDiscrepancies.map((d, i) => (
                        <TableRow
                          key={i}
                          onClick={() => setSelectedDiscrepancy(d)}
                          className="border-zinc-800/40 hover:bg-zinc-900/60 transition-colors cursor-pointer group"
                          style={{ backgroundColor: i % 2 === 0 ? "transparent" : "rgba(39,39,42,0.25)" }}
                        >
                          <TableCell className="pl-6 font-mono text-xs text-zinc-300 py-3 group-hover:text-white transition-colors">
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
                          <TableCell className="pr-4 py-3 text-right">
                            <span className="text-[10px] text-zinc-700 group-hover:text-zinc-500 transition-colors font-medium tracking-wide uppercase">
                              Evidence →
                            </span>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}

              {/* ── Pagination ── */}
              {totalPages > 1 && (
                <div className="flex items-center justify-between px-6 py-3 border-t border-zinc-800/60">
                  <span className="text-[11px] text-zinc-600">
                    Showing {currentPage * PAGE_SIZE + 1}–
                    {Math.min((currentPage + 1) * PAGE_SIZE, totalDiscrepancies)} of{" "}
                    {totalDiscrepancies}
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      disabled={currentPage === 0}
                      onClick={() => setCurrentPage((p) => p - 1)}
                      className="px-3 py-1 rounded-sm text-[11px] font-medium transition-all disabled:opacity-30"
                      style={{ background: "rgba(39,39,42,0.6)", color: "rgb(161,161,170)", border: "1px solid rgba(63,63,70,0.6)" }}
                    >
                      ← Prev
                    </button>
                    <span className="text-[11px] text-zinc-600 tabular-nums">
                      {currentPage + 1} / {totalPages}
                    </span>
                    <button
                      disabled={currentPage >= totalPages - 1}
                      onClick={() => setCurrentPage((p) => p + 1)}
                      className="px-3 py-1 rounded-sm text-[11px] font-medium transition-all disabled:opacity-30"
                      style={{ background: "rgba(39,39,42,0.6)", color: "rgb(161,161,170)", border: "1px solid rgba(63,63,70,0.6)" }}
                    >
                      Next →
                    </button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* ── Analysis warnings (missing optional columns) ── */}
        {analysisResults && analysisWarnings.length > 0 && (
          <div className="rounded-md border border-amber-900/30 px-4 py-2.5 space-y-1"
               style={{ background: "rgba(120,53,15,0.08)" }}>
            {analysisWarnings.map((w, i) => (
              <p key={i} className="text-[11px] text-amber-600 flex items-start gap-2">
                <span className="flex-shrink-0 mt-px">⚠</span>
                {w}
              </p>
            ))}
          </div>
        )}

        {/* ── Empty state ── */}
        {!analysisResults && !isProcessing && !isPdfExtracting && !pendingDetection && !pendingPdfPreview && (
          <div className="flex flex-col items-center justify-center py-28 space-y-4">
            <div
              className="w-16 h-16 rounded-full border border-zinc-800 flex items-center justify-center"
              style={{ boxShadow: "0 0 24px rgba(220,38,38,0.08)" }}
            >
              <div className="w-5 h-5 rounded-full bg-red-950/70" />
            </div>
            <p className="text-zinc-600 text-sm">Upload a CSV, XLSX, or PDF invoice to begin the audit</p>
          </div>
        )}

        </>)}

        {/* ── Analytics Tab Content ── */}
        {activeTab === "analytics" && (
          <>
            {/* Re-export button — visible when a recent audit exists */}
            {analysisResults && lastMappedRows.length > 0 && (
              <div className="flex items-center justify-between">
                <p className="text-[11px] text-zinc-600">
                  Most recent audit: <span className="text-zinc-400 font-mono">{fileName ?? "—"}</span>
                </p>
                <Button
                  onClick={handleExport}
                  size="sm"
                  className="text-white border-0 text-xs tracking-wide h-8 px-4 hover:opacity-90 transition-opacity flex items-center gap-1.5"
                  style={{ backgroundColor: "#1F4D3F" }}
                >
                  <Download size={12} />
                  Export Payout File
                </Button>
              </div>
            )}

            <AnalyticsDashboard
              records={auditHistory}
              weightData={weightData}
              onClear={() => {
                clearWeightData()
                setWeightData([])
                setAuditHistory([])
              }}
            />
          </>
        )}

        {/* ── Footer ── */}
        <p className="text-center text-zinc-800 text-xs pb-4 tracking-wide">
          Mosaic Wellness · Logistics Intelligence Platform
        </p>
      </div>

      {/* ── Evidence Modal ── */}
      {selectedDiscrepancy && (
        <EvidenceModal
          discrepancy={selectedDiscrepancy}
          gstPercentage={activeContract.gst_percentage}
          onClose={() => setSelectedDiscrepancy(null)}
        />
      )}

      {/* ── Column Mapping Modal ── */}
      {pendingDetection && pendingRawRows && (
        <ColumnMappingModal
          rawHeaders={pendingRawHeaders}
          detection={pendingDetection}
          onConfirm={handleMappingConfirm}
          onClose={() => {
            setPendingDetection(null)
            setPendingRawRows(null)
            setFileName(null)
          }}
        />
      )}

      {/* ── PDF Invoice Preview Modal ── */}
      {pendingPdfPreview && (
        <PDFPreviewModal
          rows={pendingPdfPreview.rows}
          source={pendingPdfPreview.source}
          pageCount={pendingPdfPreview.pageCount}
          fileName={pendingPdfPreview.fileName}
          onConfirm={handlePdfPreviewConfirm}
          onClose={() => {
            setPendingPdfPreview(null)
            setFileName(null)
          }}
        />
      )}
    </div>
  )
}
