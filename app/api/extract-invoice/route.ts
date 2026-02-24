import { GoogleGenerativeAI } from "@google/generative-ai"
import { NextRequest, NextResponse } from "next/server"
import { findHeaderRow } from "@/lib/csv-normalizer"

// ── Types ─────────────────────────────────────────────────────────────────────

export type ExtractionSource = "text" | "ai"

export interface InvoiceExtractionResult {
  rows: Record<string, unknown>[]
  source: ExtractionSource
  pageCount: number
}

// ── Text-based table parser ───────────────────────────────────────────────────

/**
 * Splits a single text line into cells by 2+ whitespace gaps.
 * Falls back to tab-splitting if 2+ tabs are present.
 */
function splitLine(line: string): string[] {
  if ((line.match(/\t/g) ?? []).length >= 2) {
    return line.split("\t").map((c) => c.trim())
  }
  return line.split(/\s{2,}/).map((c) => c.trim()).filter(Boolean)
}

/**
 * Attempts to parse tabular data from raw PDF text.
 * Returns an array of row objects (raw header → value).
 */
function parseTextTable(text: string): Record<string, unknown>[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)

  if (lines.length === 0) return []

  // Build a 2-D array to feed findHeaderRow
  const grid: string[][] = lines.map(splitLine)

  const headerIdx = findHeaderRow(grid)
  const headerCells = grid[headerIdx]

  if (headerCells.length < 2) return []

  const rows: Record<string, unknown>[] = []
  for (let i = headerIdx + 1; i < grid.length; i++) {
    const cells = grid[i]
    // Skip rows that are mostly empty or look like sub-headers / totals
    if (cells.length < 2) continue
    const numericCount = cells.filter((c) => /^[\d.,₹$-]+$/.test(c)).length
    if (numericCount === 0 && cells.length < 3) continue

    const row: Record<string, unknown> = {}
    headerCells.forEach((header, idx) => {
      if (header) row[header] = cells[idx] ?? ""
    })
    rows.push(row)
  }

  return rows
}

/**
 * Quality gate: checks whether text-extracted rows are likely real invoice data.
 * Returns true if the rows look usable.
 */
function isGoodQuality(rows: Record<string, unknown>[], text: string): boolean {
  if (rows.length < 3) return false

  const totalLines = text.split(/\r?\n/).filter((l) => l.trim()).length
  const numericLines = text.split(/\r?\n/).filter((l) => /\d{5,}/.test(l)).length // lines with 5+ digit numbers
  if (totalLines === 0) return false
  if (numericLines / totalLines < 0.04) return false // less than 4% numeric lines = likely scanned

  return true
}

// ── Gemini AI fallback ────────────────────────────────────────────────────────

const INVOICE_SYSTEM_PROMPT = `You are a logistics invoice parser. Extract every line item from this invoice table as a JSON array. Each object should have: awb, billedWeight_grams, actualWeight_grams, zone, totalBilled_INR, codAmount_INR, surcharges. Return only valid JSON, no explanation.`

async function extractWithGemini(
  base64: string
): Promise<Record<string, unknown>[]> {
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!)
  const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" })

  const result = await model.generateContent([
    { inlineData: { data: base64, mimeType: "application/pdf" } },
    INVOICE_SYSTEM_PROMPT,
  ])

  const raw = result.response.text().trim()

  // Strip markdown fences if present
  const jsonStr = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim()
  const parsed: Record<string, unknown>[] = JSON.parse(jsonStr)

  // Normalise Gemini's field names → canonical raw keys that column-matcher expects
  return parsed.map((item) => {
    const normalised: Record<string, unknown> = { ...item }

    // Map Gemini's snake_case keys to readable header names the matcher knows
    if ("awb" in normalised) {
      normalised["AWB No."] = normalised.awb
    }
    if ("billedWeight_grams" in normalised && typeof normalised.billedWeight_grams === "number") {
      normalised["Billed Weight"] = (normalised.billedWeight_grams as number) / 1000
    }
    if ("actualWeight_grams" in normalised && typeof normalised.actualWeight_grams === "number") {
      normalised["Actual Weight"] = (normalised.actualWeight_grams as number) / 1000
    }
    if ("zone" in normalised) {
      normalised["Billed Zone"] = normalised.zone
    }
    if ("totalBilled_INR" in normalised) {
      normalised["Total Billed Amount"] = normalised.totalBilled_INR
    }
    if ("codAmount_INR" in normalised) {
      normalised["COD Amount"] = normalised.codAmount_INR
    }

    return normalised
  })
}

// ── Route handler ─────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData()
    const file = formData.get("file") as File | null

    if (!file || file.type !== "application/pdf") {
      return NextResponse.json(
        { error: "Request must include a 'file' field containing a PDF." },
        { status: 400 }
      )
    }

    const bytes = await file.arrayBuffer()
    const buffer = Buffer.from(bytes)
    const base64 = buffer.toString("base64")

    // ── Primary: pdf-parse ────────────────────────────────────────────────────
    // require() keeps this out of the client bundle; serverExternalPackages
    // in next.config.ts ensures Node can resolve it without bundling.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const pdfParse: (buf: Buffer) => Promise<{ text: string; numpages: number }> = require("pdf-parse")
    const pdfData = await pdfParse(buffer)

    const text: string = pdfData.text ?? ""
    const pageCount: number = pdfData.numpages ?? 1

    const textRows = parseTextTable(text)

    if (isGoodQuality(textRows, text)) {
      return NextResponse.json({
        rows: textRows,
        source: "text",
        pageCount,
      } satisfies InvoiceExtractionResult)
    }

    // ── Fallback: Gemini AI ───────────────────────────────────────────────────
    const aiRows = await extractWithGemini(base64)

    return NextResponse.json({
      rows: aiRows,
      source: "ai",
      pageCount,
    } satisfies InvoiceExtractionResult)
  } catch (error) {
    console.error("[extract-invoice] Error:", error)
    return NextResponse.json(
      { error: "Failed to extract invoice data from PDF." },
      { status: 500 }
    )
  }
}
