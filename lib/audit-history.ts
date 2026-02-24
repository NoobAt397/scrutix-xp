/**
 * Persistent audit history stored in localStorage.
 *
 * Each time the user runs an audit, one AuditRecord is appended.
 * The analytics dashboard reads these records to draw trend charts.
 */
import type { AnalysisResult, Discrepancy } from "@/lib/billing-engine"

// ── Types ─────────────────────────────────────────────────────────────────────

export interface OverchargeByType {
  /** "Weight Overcharge" / "Weight Discrepancy" */
  weightMismatch: number
  /** "Zone Mismatch" */
  zoneMismatch: number
  /** "Duplicate Charge" */
  duplicateAWB: number
  /** "Invalid COD Charge" */
  incorrectCOD: number
  /** "RTO Overcharge" */
  rtoMismatch: number
  /** "Non-contracted Surcharge" / "Rate Overcharge" / anything else */
  other: number
}

export interface AuditRecord {
  id: string
  timestamp: number        // Date.now()
  providerName: string
  fileName: string
  totalRows: number
  totalBilled: number
  totalOvercharge: number
  flaggedLineItems: number
  overchargeByType: OverchargeByType
}

// ── Constants ─────────────────────────────────────────────────────────────────

const STORAGE_KEY = "mosaic_audit_history"
const MAX_RECORDS = 500   // cap to avoid localStorage bloat

// ── Internal helpers ──────────────────────────────────────────────────────────

/**
 * Splits overcharge amounts across the known issue categories.
 * A single AWB can have multiple issues joined by ", " — the difference is
 * split equally across each contributing category.
 */
function categorizeOvercharge(discrepancies: Discrepancy[]): OverchargeByType {
  const result: OverchargeByType = {
    weightMismatch: 0,
    zoneMismatch:   0,
    duplicateAWB:   0,
    incorrectCOD:   0,
    rtoMismatch:    0,
    other:          0,
  }

  for (const d of discrepancies) {
    const types = d.issue_type.split(", ").map((t) => t.trim())
    const share = d.difference / (types.length || 1)

    for (const type of types) {
      const lower = type.toLowerCase()
      if (lower.includes("weight")) {
        result.weightMismatch += share
      } else if (lower.includes("zone")) {
        result.zoneMismatch += share
      } else if (lower.includes("duplicate")) {
        result.duplicateAWB += share
      } else if (lower.includes("cod")) {
        result.incorrectCOD += share
      } else if (lower.includes("rto")) {
        result.rtoMismatch += share
      } else {
        result.other += share
      }
    }
  }

  // Round to 2 decimal places
  for (const key of Object.keys(result) as Array<keyof OverchargeByType>) {
    result[key] = Math.round(result[key] * 100) / 100
  }

  return result
}

// ── Public API ────────────────────────────────────────────────────────────────

export function buildAuditRecord(params: {
  analysisResult: AnalysisResult
  providerName:   string
  fileName:       string
}): AuditRecord {
  const { analysisResult: a, providerName, fileName } = params
  return {
    id:              `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    timestamp:       Date.now(),
    providerName,
    fileName,
    totalRows:       a.totalRows,
    totalBilled:     Math.round(a.totalBilled     * 100) / 100,
    totalOvercharge: Math.round(a.totalOvercharge * 100) / 100,
    flaggedLineItems: a.discrepancies.length,
    overchargeByType: categorizeOvercharge(a.discrepancies),
  }
}

export function saveAuditRecord(record: AuditRecord): void {
  if (typeof window === "undefined") return
  try {
    const existing = loadAuditHistory()
    existing.push(record)
    // Trim oldest records beyond cap
    const trimmed = existing.slice(-MAX_RECORDS)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed))
  } catch {
    // localStorage unavailable (private mode, quota exceeded)
  }
}

export function loadAuditHistory(): AuditRecord[] {
  if (typeof window === "undefined") return []
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    return JSON.parse(raw) as AuditRecord[]
  } catch {
    return []
  }
}

export function clearAuditHistory(): void {
  if (typeof window === "undefined") return
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    // ignore
  }
}
