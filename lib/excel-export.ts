/**
 * Client-side Excel export for the Mosaic Logistics Payout / Dispute file.
 *
 * Produces a .xlsx workbook with 3 sheets:
 *   1. Dispute Summary   – cover sheet with metadata + KPI table
 *   2. Line Item Disputes – one row per flagged AWB, colour-coded by error type
 *   3. Verified Payout   – every AWB with corrected amounts and dispute status
 *
 * Uses SheetJS (xlsx) CE with cellStyles enabled.
 * Styles (bold, fill colours, font colours) work in xlsx 0.18.x when
 * XLSX.write is called with { cellStyles: true }.
 */

import type { AnalysisResult, Discrepancy } from "@/lib/billing-engine"

// ── Palette ───────────────────────────────────────────────────────────────────

const C = {
  DARK_BG:   "1A1A1A",
  WHITE:     "FFFFFF",
  RED_BG:    "FEE2E2",
  RED_TEXT:  "DC2626",
  RED_BOLD:  "B91C1C",
  GREEN_TEXT:"166534",
  ALT_ROW:   "F9F9F9",
  AMBER:     "FEF3C7",
  ORANGE:    "FED7AA",
  PURPLE:    "EDE9FE",
  BLUE:      "DBEAFE",
  GRAY:      "F3F4F6",
  FOOTER_BG: "27272A",
  LABEL:     "52525B",
  VALUE:     "18181B",
} as const

const ERROR_BG: Record<string, string> = {
  "Weight Mismatch": C.AMBER,
  "Zone Mismatch":   C.ORANGE,
  "Duplicate AWB":   C.RED_BG,
  "Incorrect COD":   C.PURPLE,
  "RTO Overcharge":  C.BLUE,
  "Non-contracted":  C.GRAY,
}

// ── Types ─────────────────────────────────────────────────────────────────────

// Minimal cell shape accepted by xlsx
type XCell = {
  v: string | number | null
  t: "s" | "n"
  z?: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  s?: Record<string, any>
}

// ── Style helpers ─────────────────────────────────────────────────────────────

function sc(v: string | null, s?: XCell["s"]): XCell {
  return { v: v ?? "", t: "s", s }
}

function nc(v: number, fmt = "#,##0.00", s?: XCell["s"]): XCell {
  return { v, t: "n", z: fmt, s }
}

function font(bold = false, rgb: string = C.VALUE, sz = 10): Record<string, unknown> {
  return { bold, color: { rgb }, sz, name: "Arial" }
}

function fill(rgb: string): Record<string, unknown> {
  return { fgColor: { rgb }, patternType: "solid" }
}

const HDR_STYLE: XCell["s"] = {
  font:      font(true, C.WHITE),
  fill:      fill(C.DARK_BG),
  alignment: { horizontal: "left", vertical: "center" },
}

const HDR_R_STYLE: XCell["s"] = {
  font:      font(true, C.WHITE),
  fill:      fill(C.DARK_BG),
  alignment: { horizontal: "right", vertical: "center" },
}

function hdr(v: string, right = false): XCell {
  return sc(v, right ? HDR_R_STYLE : HDR_STYLE)
}

const FTR_STYLE: XCell["s"] = {
  font:      font(true, C.WHITE),
  fill:      fill(C.FOOTER_BG),
  alignment: { horizontal: "right" },
}

// ── Data helpers ──────────────────────────────────────────────────────────────

function fmtDate(d: Date): string {
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })
}

function findBillingPeriod(rows: Record<string, unknown>[]): string {
  if (!rows.length) return "N/A"
  const dateKey = Object.keys(rows[0]).find((k) => /date/i.test(k))
  if (!dateKey) return "N/A"

  const ts: number[] = []
  for (const row of rows) {
    const d = new Date(String(row[dateKey] ?? ""))
    if (!isNaN(d.getTime())) ts.push(d.getTime())
  }
  if (!ts.length) return "N/A"

  return `${fmtDate(new Date(Math.min(...ts)))} – ${fmtDate(new Date(Math.max(...ts)))}`
}

function errorCategory(issueType: string): string {
  const lower = issueType.toLowerCase()
  if (lower.includes("weight"))    return "Weight Mismatch"
  if (lower.includes("zone"))      return "Zone Mismatch"
  if (lower.includes("duplicate")) return "Duplicate AWB"
  if (lower.includes("cod"))       return "Incorrect COD"
  if (lower.includes("rto"))       return "RTO Overcharge"
  return "Non-contracted"
}

function buildErrorDetail(d: Discrepancy): string {
  const b = d.breakdown
  if (!b) return "Duplicate AWB — second charge rejected"

  const parts: string[] = []
  if (b.zoneMismatch) {
    const src = b.pincodeDerivedZone ? "pincode-derived" : "CSV column"
    parts.push(`Billed zone ${b.billedZone} vs effective zone ${b.effectiveZone} (${src})`)
  }
  if (b.weightOvercharge) {
    parts.push(
      `Weight billed ${b.billedWeight.toFixed(3)} kg; chargeable ${b.chargeableWeight.toFixed(3)} kg`
    )
  }
  if (b.weightDiscrepancy && b.volumetricWeight != null) {
    parts.push(`Volumetric ${b.volumetricWeight.toFixed(3)} kg not reflected in bill`)
  }
  return parts.length ? parts.join("; ") : d.issue_type
}

// ── Sheet 1: Dispute Summary ──────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildSummarySheet(XLSX: any, ar: AnalysisResult, provider: string, period: string) {
  const totalVerified  = ar.totalBilled - ar.totalOvercharge
  const overchargePct  = ar.totalBilled > 0
    ? ((ar.totalOvercharge / ar.totalBilled) * 100).toFixed(2) + "%"
    : "0.00%"

  const titleStyle: XCell["s"] = { font: { bold: true, sz: 20, color: { rgb: C.DARK_BG }, name: "Arial" } }
  const labelStyle: XCell["s"] = { font: font(true, C.LABEL) }
  const valStyle:   XCell["s"] = { font: font(false, C.VALUE) }
  const secHdr:     XCell["s"] = { font: font(true, C.WHITE), fill: fill(C.DARK_BG), alignment: { horizontal: "left" } }
  const rowNormal:  XCell["s"] = { font: font(false, C.VALUE) }
  const rowNormalR: XCell["s"] = { font: font(false, C.VALUE), alignment: { horizontal: "right" } }
  const overLbl:    XCell["s"] = { font: font(true, C.RED_TEXT), fill: fill(C.RED_BG) }
  const overVal:    XCell["s"] = { font: font(true, C.RED_TEXT), fill: fill(C.RED_BG), alignment: { horizontal: "right" } }

  // AOA — col A (label) | col B (value)
  const aoa: XCell[][] = [
    // row 0: company title (merged A1:B1)
    [sc("Mosaic Wellness", titleStyle), sc("")],
    [sc(""), sc("")],
    // row 2-5: metadata
    [sc("Provider",       labelStyle), sc(provider,   valStyle)],
    [sc("Billing Period", labelStyle), sc(period,      valStyle)],
    [sc("Export Date",    labelStyle), sc(fmtDate(new Date()), valStyle)],
    [sc("Disputed AWBs",  labelStyle), sc(String(ar.discrepancies.length), valStyle)],
    [sc(""), sc("")],
    // row 7: section header
    [sc("Metric", secHdr), sc("Value", { ...secHdr, alignment: { horizontal: "right" } })],
    // row 8-12: KPI rows
    [sc("Total Shipments Audited",  rowNormal), nc(ar.totalRows,      "0",        rowNormalR)],
    [sc("Total Amount Billed",      rowNormal), nc(ar.totalBilled,    "#,##0.00", rowNormalR)],
    [sc("Total Amount Verified",    rowNormal), nc(totalVerified,     "#,##0.00", rowNormalR)],
    [sc("Total Overcharge Found",   overLbl),   nc(ar.totalOvercharge,"#,##0.00", overVal)],
    [sc("Overcharge %",             rowNormal), sc(overchargePct,     { ...rowNormal, alignment: { horizontal: "right" } })],
  ]

  const ws = XLSX.utils.aoa_to_sheet(aoa)
  ws["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 1 } }]
  ws["!cols"] = [{ wch: 28 }, { wch: 24 }]
  return ws
}

// ── Sheet 2: Line Item Disputes ───────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildDisputeSheet(XLSX: any, ar: AnalysisResult, rowsByAWB: Map<string, Record<string, unknown>>) {
  const headers: XCell[] = [
    hdr("AWB Number"),
    hdr("Shipment Date"),
    hdr("Origin Pincode"),
    hdr("Dest Pincode"),
    hdr("Declared Weight (g)", true),
    hdr("Billed Weight (g)",   true),
    hdr("Weight Diff (g)",     true),
    hdr("Billed Zone"),
    hdr("Actual Zone"),
    hdr("Order Type"),
    hdr("Contracted Rate (₹)", true),
    hdr("Billed Amount (₹)",   true),
    hdr("Verified Amount (₹)", true),
    hdr("Overcharge Amount (₹)", true),
    hdr("Error Type"),
    hdr("Error Detail"),
  ]

  const colWidths = [18, 14, 14, 14, 18, 18, 14, 12, 12, 14, 18, 18, 18, 20, 22, 40]

  if (ar.discrepancies.length === 0) {
    const ws = XLSX.utils.aoa_to_sheet([
      headers,
      [sc("—"), sc("No disputes found — all charges verified")],
    ])
    ws["!cols"] = colWidths.map((w) => ({ wch: w }))
    ws["!freeze"] = { xSplit: 0, ySplit: 1, topLeftCell: "A2", activePane: "bottomLeft", state: "frozen" }
    ws["!autofilter"] = { ref: `A1:P1` }
    return ws
  }

  const overchargeNumStyle: XCell["s"] = {
    font:      font(true, C.RED_BOLD),
    alignment: { horizontal: "right" },
  }

  const dataRows: XCell[][] = ar.discrepancies.map((d, i) => {
    const srcRow = rowsByAWB.get(d.awb_number) ?? {}
    const b      = d.breakdown

    // Pull optional fields from the original row
    const shipDate   = srcRow["ShipmentDate"] ?? srcRow["Date"] ?? srcRow["InvoiceDate"] ?? srcRow["OrderDate"] ?? ""
    const originPin  = (srcRow["OriginPincode"] as string | undefined) ?? ""
    const destPin    = (srcRow["DestPincode"]   as string | undefined) ?? ""

    const declaredG  = b ? Math.round(b.actualWeight  * 1000) : 0
    const billedG    = b ? Math.round(b.billedWeight   * 1000) : 0
    const diffG      = billedG - declaredG

    const errCat     = errorCategory(d.issue_type)
    const errBg      = ERROR_BG[errCat] ?? C.GRAY

    const altBg      = i % 2 === 1 ? C.ALT_ROW : C.WHITE
    const rowStyle   = (right = false): XCell["s"] => ({
      fill:      fill(altBg),
      alignment: { horizontal: right ? "right" : "left" },
    })
    const errCellStyle: XCell["s"] = { fill: fill(errBg), font: font(false, C.VALUE) }

    return [
      sc(d.awb_number,                        rowStyle()),
      sc(String(shipDate),                    rowStyle()),
      sc(originPin,                           rowStyle()),
      sc(destPin,                             rowStyle()),
      nc(declaredG,           "0",            rowStyle(true)),
      nc(billedG,             "0",            rowStyle(true)),
      nc(diffG,               "+0;-0;0",      rowStyle(true)),
      sc(b?.billedZone    ?? "", rowStyle()),
      sc(b?.effectiveZone ?? "", rowStyle()),
      sc(b?.orderType     ?? "", rowStyle()),
      nc(b?.baseRate      ?? 0, "#,##0.00",   rowStyle(true)),
      nc(d.billed_amount,       "#,##0.00",   rowStyle(true)),
      nc(d.correct_amount,      "#,##0.00",   rowStyle(true)),
      nc(d.difference,          "#,##0.00",   overchargeNumStyle),
      sc(errCat,                              errCellStyle),
      sc(buildErrorDetail(d),                 rowStyle()),
    ]
  })

  const ws = XLSX.utils.aoa_to_sheet([headers, ...dataRows])
  ws["!cols"]       = colWidths.map((w) => ({ wch: w }))
  ws["!freeze"]     = { xSplit: 0, ySplit: 1, topLeftCell: "A2", activePane: "bottomLeft", state: "frozen" }
  ws["!autofilter"] = { ref: `A1:P${ar.discrepancies.length + 1}` }
  return ws
}

// ── Sheet 3: Verified Payout ──────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildPayoutSheet(XLSX: any, ar: AnalysisResult, mappedRows: Record<string, unknown>[]) {
  const headers: XCell[] = [
    hdr("AWB Number"),
    hdr("Original Billed (₹)", true),
    hdr("Verified Amount (₹)", true),
    hdr("Adjustment (₹)",      true),
    hdr("Status"),
  ]

  // Build dispute lookup: AWB → list of discrepancies (some AWBs may have multiple)
  const disputesByAWB = new Map<string, Discrepancy[]>()
  for (const d of ar.discrepancies) {
    const list = disputesByAWB.get(d.awb_number) ?? []
    list.push(d)
    disputesByAWB.set(d.awb_number, list)
  }

  let sumBilled   = 0
  let sumVerified = 0
  let sumAdj      = 0

  const awbSeenCount = new Map<string, number>()

  const dataRows: XCell[][] = mappedRows.map((row, i) => {
    const awb    = String(row["AWB"] ?? "")
    const billed = Number(row["TotalBilledAmount"] ?? 0)
    const seen   = awbSeenCount.get(awb) ?? 0
    awbSeenCount.set(awb, seen + 1)

    const altBg = i % 2 === 1 ? C.ALT_ROW : C.WHITE
    const base  = (right = false): XCell["s"] => ({
      fill:      fill(altBg),
      alignment: { horizontal: right ? "right" : "left" },
    })

    let verified: number
    let adj:      number
    let status:   string
    let statusStyle: XCell["s"]

    if (seen > 0) {
      // Duplicate occurrence — reject entirely
      verified    = 0
      adj         = -billed
      status      = "Duplicate — Reject"
      statusStyle = { fill: fill(altBg), font: font(true, C.RED_TEXT) }
    } else {
      const disputes = disputesByAWB.get(awb) ?? []
      // Non-duplicate disputes for this AWB's primary occurrence
      const realDisputes = disputes.filter((d) => !d.issue_type.includes("Duplicate"))
      if (realDisputes.length > 0) {
        // Use the first non-duplicate dispute's correct_amount
        const d  = realDisputes[0]
        verified = d.correct_amount
        adj      = d.correct_amount - billed
        status   = "Overcharge — Dispute Raised"
        statusStyle = { fill: fill(altBg), font: font(false, C.RED_TEXT) }
      } else if (disputes.some((d) => d.issue_type.includes("Duplicate"))) {
        // The very first occurrence of a duplicate-only AWB
        verified    = 0
        adj         = -billed
        status      = "Duplicate — Reject"
        statusStyle = { fill: fill(altBg), font: font(true, C.RED_TEXT) }
      } else {
        verified    = billed
        adj         = 0
        status      = "Correct"
        statusStyle = { fill: fill(altBg), font: font(false, C.GREEN_TEXT) }
      }
    }

    sumBilled   += billed
    sumVerified += verified
    sumAdj      += adj

    const adjStyle: XCell["s"] = {
      fill:      fill(altBg),
      font:      { bold: false, color: { rgb: adj < 0 ? C.RED_TEXT : adj > 0 ? "2563EB" : C.VALUE }, sz: 10, name: "Arial" },
      alignment: { horizontal: "right" },
    }

    return [
      sc(awb,                             base()),
      nc(billed,   "#,##0.00",            base(true)),
      nc(verified, "#,##0.00",            base(true)),
      nc(adj,      "+#,##0.00;-#,##0.00;0.00", adjStyle),
      sc(status,                          statusStyle),
    ]
  })

  // Footer totals row
  const footer: XCell[] = [
    sc("TOTAL", FTR_STYLE),
    nc(sumBilled,   "#,##0.00", FTR_STYLE),
    nc(sumVerified, "#,##0.00", FTR_STYLE),
    nc(sumAdj,      "+#,##0.00;-#,##0.00;0.00", FTR_STYLE),
    sc("—", FTR_STYLE),
  ]

  const ws = XLSX.utils.aoa_to_sheet([headers, ...dataRows, footer])
  ws["!cols"]   = [{ wch: 20 }, { wch: 20 }, { wch: 20 }, { wch: 20 }, { wch: 26 }]
  ws["!freeze"] = { xSplit: 0, ySplit: 1, topLeftCell: "A2", activePane: "bottomLeft", state: "frozen" }
  return ws
}

// ── Public export ─────────────────────────────────────────────────────────────

export interface ExcelExportParams {
  analysisResult: AnalysisResult
  mappedRows:     Record<string, unknown>[]
  providerName:   string
}

/**
 * Builds and downloads a formatted XLSX dispute package.
 * Returns the number of disputed AWBs (for toast message).
 */
export async function exportPayoutExcel(params: ExcelExportParams): Promise<number> {
  const { analysisResult, mappedRows, providerName } = params

  // Dynamic import keeps xlsx out of the server bundle
  const XLSX = await import("xlsx")

  // Pre-build AWB → row lookup for Sheet 2 (O(1) access)
  const rowsByAWB = new Map<string, Record<string, unknown>>()
  for (const row of mappedRows) {
    const awb = String(row["AWB"] ?? "")
    if (awb && !rowsByAWB.has(awb)) rowsByAWB.set(awb, row)
  }

  const billingPeriod = findBillingPeriod(mappedRows)

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, buildSummarySheet(XLSX, analysisResult, providerName, billingPeriod), "Dispute Summary")
  XLSX.utils.book_append_sheet(wb, buildDisputeSheet(XLSX, analysisResult, rowsByAWB), "Line Item Disputes")
  XLSX.utils.book_append_sheet(wb, buildPayoutSheet(XLSX, analysisResult, mappedRows), "Verified Payout")

  // Serialise to ArrayBuffer and trigger browser download
  const today = new Date().toISOString().slice(0, 10) // YYYY-MM-DD
  const filename = `Mosaic_${providerName.replace(/\s+/g, "_")}_Dispute_${today}.xlsx`

  const buf  = XLSX.write(wb, { bookType: "xlsx", type: "array", cellStyles: true })
  const blob = new Blob([buf], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  })
  const url = URL.createObjectURL(blob)
  const a   = document.createElement("a")
  a.href     = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)

  return analysisResult.discrepancies.length
}
