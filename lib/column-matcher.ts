/**
 * Fuzzy column-name detection for logistics invoice CSVs.
 *
 * Scoring hierarchy (0–1):
 *   1.0  exact match after normalization
 *   0.9  one string fully contains the other
 *   0.6–0.9  Jaccard word-overlap
 *   0–0.6  Levenshtein character edit distance
 *
 * A required field must score ≥ CONFIDENCE_THRESHOLD (0.80) to be
 * auto-accepted.  Below that the user is shown the ColumnMappingModal.
 */

// ── Canonical field → known raw-header variations ─────────────────────────────
const VARIATIONS: Record<string, string[]> = {
  AWB: [
    "awb", "awb no", "awb number", "awbno", "awbnumber", "awb_no",
    "airway bill", "airwaybill", "tracking number", "tracking no",
    "tracking_number", "shipment id", "consignment number", "consignment no",
    "waybill", "way bill", "docket number", "docket no",
  ],
  OrderType: [
    "order type", "ordertype", "order_type", "type", "shipment type",
    "cod prepaid", "cod/prepaid", "payment type", "delivery type",
    "service type", "mode",
  ],
  BilledWeight: [
    "billed weight", "billed wt", "billed_weight", "billedweight",
    "charged weight", "charge weight", "invoice weight", "invoiced weight",
    "chargeable weight", "chargeable wt", "applicable weight",
  ],
  ActualWeight: [
    "actual weight", "actual wt", "actual_weight", "actualweight",
    "real weight", "dead weight", "dead wt", "physical weight",
    "declared weight", "package weight", "item weight", "gross weight",
  ],
  BilledZone: [
    "billed zone", "zone", "delivery zone", "shipment zone",
    "charged zone", "invoice zone", "billing zone", "service zone",
    "applicable zone",
  ],
  ActualZone: [
    "actual zone", "actual_zone", "correct zone", "calculated zone",
    "expected zone", "correct_zone",
  ],
  TotalBilledAmount: [
    "total billed amount", "total", "invoice amount", "billed amount",
    "amount", "total amount", "charged amount", "invoice total",
    "net amount", "total charges", "billing amount", "freight charges",
    "total freight", "amount payable", "grand total",
  ],
  Length: [
    "length", "len", "pkg length", "package length",
    "l (cm)", "length cm", "length(cm)",
  ],
  Width: [
    "width", "wid", "pkg width", "package width",
    "w (cm)", "width cm", "width(cm)",
  ],
  Height: [
    "height", "ht", "pkg height", "package height",
    "h (cm)", "height cm", "height(cm)",
  ],
  OriginPincode: [
    "origin pincode", "origin pin", "origin_pincode", "from pincode",
    "source pincode", "pickup pincode", "origin pin code", "sender pincode",
    "source pin", "from pin", "origin zip", "pickup pin",
  ],
  DestPincode: [
    "dest pincode", "destination pincode", "dest pin", "destination pin",
    "to pincode", "delivery pincode", "dest_pincode", "consignee pincode",
    "delivery pin", "to pin", "dest zip", "delivery zip",
  ],
  CODAmount: [
    "cod amount", "cod charges", "cash on delivery", "cod_amount",
    "cod fee", "cod value", "cod charge", "cod",
  ],
  ShipmentDate: [
    "shipment date", "date", "booking date", "ship date", "dispatch date",
    "created date", "invoice date", "order date", "manifest date",
  ],
}

export const REQUIRED_CANONICAL = [
  "AWB", "OrderType", "BilledWeight", "ActualWeight",
  "BilledZone", "ActualZone", "TotalBilledAmount",
] as const

export const OPTIONAL_CANONICAL = [
  "Length", "Width", "Height",
  "OriginPincode", "DestPincode",
  "CODAmount", "ShipmentDate",
] as const

export const ALL_CANONICAL = [...REQUIRED_CANONICAL, ...OPTIONAL_CANONICAL]

/** Minimum confidence to auto-accept without showing the mapping modal. */
export const CONFIDENCE_THRESHOLD = 0.8

// ── String utilities ──────────────────────────────────────────────────────────

function normalise(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function levenshtein(a: string, b: string): number {
  const m = a.length
  const n = b.length
  // Single-row rolling array for O(n) space
  let prev = Array.from({ length: n + 1 }, (_, j) => j)
  for (let i = 1; i <= m; i++) {
    const curr = [i]
    for (let j = 1; j <= n; j++) {
      curr[j] =
        a[i - 1] === b[j - 1]
          ? prev[j - 1]
          : 1 + Math.min(prev[j], curr[j - 1], prev[j - 1])
    }
    prev = curr
  }
  return prev[n]
}

/**
 * Returns a [0, 1] similarity score between two raw header strings.
 */
export function similarity(a: string, b: string): number {
  const na = normalise(a)
  const nb = normalise(b)

  if (na === nb) return 1.0

  // Substring containment
  if (na.includes(nb) || nb.includes(na)) return 0.9

  // Jaccard word-overlap
  const wa = new Set(na.split(" ").filter(Boolean))
  const wb = new Set(nb.split(" ").filter(Boolean))
  const intersection = [...wa].filter((w) => wb.has(w)).length
  const union = new Set([...wa, ...wb]).size
  if (intersection > 0) {
    const jaccard = intersection / union
    return 0.55 + jaccard * 0.35 // maps [0,1] → [0.55, 0.90]
  }

  // Levenshtein fallback — penalised by length ratio
  const dist = levenshtein(na, nb)
  const maxLen = Math.max(na.length, nb.length)
  if (maxLen === 0) return 1.0
  return Math.max(0, 1 - dist / maxLen)
}

// ── Public API ────────────────────────────────────────────────────────────────

export interface ColumnMatch {
  /** Canonical field name, e.g. "AWB" */
  canonical: string
  /** Best-matching raw header, or null if nothing met the min threshold */
  rawHeader: string | null
  /** 0–1 confidence score */
  confidence: number
}

export interface DetectionResult {
  /** canonical → raw header (or null when not detected) */
  mapping: Record<string, string | null>
  /** canonical → confidence score */
  confidences: Record<string, number>
  /** Required fields where confidence < CONFIDENCE_THRESHOLD */
  lowConfidenceFields: string[]
  /** True when any required field needs human review */
  needsManualReview: boolean
}

/**
 * Main entry point.  Runs fuzzy matching for every canonical field against
 * the provided raw headers and returns a DetectionResult.
 *
 * Each raw header is only assigned to one canonical field (the one where it
 * scores highest).  A raw header that beats the minimum threshold (0.40) on
 * two fields goes to whichever has the higher score.
 */
export function detectColumns(rawHeaders: string[]): DetectionResult {
  // Build a score matrix: canonical → { raw, score }[]
  const candidates: Record<string, { raw: string; score: number }[]> = {}

  for (const canonical of ALL_CANONICAL) {
    const variations = VARIATIONS[canonical] ?? []
    candidates[canonical] = []

    for (const raw of rawHeaders) {
      // Best score against all known variations for this canonical field
      let best = similarity(raw, canonical) // direct name similarity
      for (const v of variations) {
        const s = similarity(raw, v)
        if (s > best) best = s
      }
      if (best >= 0.4) {
        candidates[canonical].push({ raw, score: best })
      }
    }

    // Sort descending by score
    candidates[canonical].sort((a, b) => b.score - a.score)
  }

  // Greedy assignment: assign highest-scoring uncontested raw headers first
  const mapping: Record<string, string | null> = {}
  const confidences: Record<string, number> = {}
  const usedRawHeaders = new Set<string>()

  // Process required fields first to give them priority
  for (const canonical of ALL_CANONICAL) {
    const top = candidates[canonical].find((c) => !usedRawHeaders.has(c.raw))
    if (top) {
      mapping[canonical] = top.raw
      confidences[canonical] = top.score
      usedRawHeaders.add(top.raw)
    } else {
      mapping[canonical] = null
      confidences[canonical] = 0
    }
  }

  const lowConfidenceFields = REQUIRED_CANONICAL.filter(
    (f) => (confidences[f] ?? 0) < CONFIDENCE_THRESHOLD || mapping[f] === null
  )

  return {
    mapping,
    confidences,
    lowConfidenceFields,
    needsManualReview: lowConfidenceFields.length > 0,
  }
}
