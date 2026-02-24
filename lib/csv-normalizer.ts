/**
 * Value-level normalizers for logistics invoice data.
 *
 * Handles real-world messiness:
 *  - Weight strings: "500g", "0.5 kg", "500 grams" → number in kg
 *  - Amount strings: "₹1,234.56", "1234.56" → number
 *  - Pincode strings: " 110 001 " → "110001" (or null if invalid)
 *  - Multi-row headers: skip meta/title rows before the actual column header
 */

// ── Weight ────────────────────────────────────────────────────────────────────

/**
 * Normalises any weight representation to kilograms (number).
 *
 * Supported formats:
 *   number        → returned as-is  (assumed already in kg)
 *   "0.5"         → 0.5 kg
 *   "0.5 kg"      → 0.5 kg
 *   "500g"        → 0.5 kg
 *   "500 grams"   → 0.5 kg
 *   "500 gram"    → 0.5 kg
 */
export function normalizeWeight(raw: unknown): number {
  if (raw == null || raw === "") return 0
  if (typeof raw === "number") return raw

  const str = String(raw).toLowerCase().trim()

  // "500g" / "500 grams" / "500gram"
  const gramMatch = str.match(/^(\d+\.?\d*)\s*gr?a?m?s?$/)
  if (gramMatch) return parseFloat(gramMatch[1]) / 1000

  // "0.5 kg" / "0.5kg" / "0.5 kgs"
  const kgMatch = str.match(/^(\d+\.?\d*)\s*kgs?$/)
  if (kgMatch) return parseFloat(kgMatch[1])

  // plain numeric string
  const n = parseFloat(str)
  return isNaN(n) ? 0 : n
}

// ── Amount ────────────────────────────────────────────────────────────────────

/**
 * Strips currency symbols, commas, and whitespace from a value and
 * returns a plain number.  Returns 0 for unparseable input.
 *
 *   "₹1,234.56" → 1234.56
 *   "$55.00"    → 55.0
 *   "55"        → 55
 *   55          → 55
 */
export function normalizeAmount(raw: unknown): number {
  if (raw == null || raw === "") return 0
  if (typeof raw === "number") return raw
  const cleaned = String(raw)
    .replace(/[₹$€£,\s]/g, "")
    .trim()
  const n = parseFloat(cleaned)
  return isNaN(n) ? 0 : n
}

// ── Pincode ───────────────────────────────────────────────────────────────────

/**
 * Strips all whitespace from a pincode and validates it is exactly 6 digits.
 * Returns the clean string, or null for invalid/missing values.
 *
 *   "110 001"  → "110001"
 *   "110001"   → "110001"
 *   "1100"     → null  (too short)
 *   undefined  → null
 */
export function normalizePincode(raw: unknown): string | null {
  if (raw == null) return null
  const str = String(raw).replace(/\s/g, "")
  return /^\d{6}$/.test(str) ? str : null
}

// ── Multi-row header detection ────────────────────────────────────────────────

/**
 * Scans up to the first 10 rows of a raw 2-D array (strings) looking for
 * the row that most resembles a header row.
 *
 * A row is considered a header when ≥ 2 of its cells contain one of the
 * well-known logistics column keywords.
 *
 * Returns the 0-based row index, defaulting to 0 if nothing better is found.
 *
 * Example — a Delhivery report often looks like:
 *   row 0: "Report Generated: Jan 2024"
 *   row 1: "Account: XYZ Corp"
 *   row 2: "AWB No.", "Zone", "Weight", ...   ← header row (index 2)
 *   row 3+: data
 */
export function findHeaderRow(rows: string[][]): number {
  const HEADER_KEYWORDS = [
    "awb", "zone", "weight", "amount", "type", "order",
    "pincode", "date", "cod", "shipment", "invoice", "billed",
    "actual", "freight", "tracking",
  ]

  let bestIndex = 0
  let bestMatches = 0

  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    const row = rows[i]
    if (!row || row.length < 2) continue

    const cellsLower = row.map((c) => String(c ?? "").toLowerCase().trim())
    const matchCount = HEADER_KEYWORDS.filter((kw) =>
      cellsLower.some((cell) => cell.includes(kw))
    ).length

    if (matchCount > bestMatches) {
      bestMatches = matchCount
      bestIndex = i
    }

    // Early exit if we find a very strong header row
    if (matchCount >= 4) break
  }

  return bestIndex
}

// ── Row-level normalizer ──────────────────────────────────────────────────────

/**
 * Applies all value-level normalizers to an array of already-mapped rows
 * (canonical keys → raw values).  Safe to call on any row regardless of
 * which optional fields are present.
 */
export function normalizeRows(
  rows: Record<string, unknown>[]
): Record<string, unknown>[] {
  return rows.map((row) => {
    const out: Record<string, unknown> = { ...row }

    if ("BilledWeight" in out)     out.BilledWeight     = normalizeWeight(out.BilledWeight)
    if ("ActualWeight" in out)     out.ActualWeight     = normalizeWeight(out.ActualWeight)
    if ("TotalBilledAmount" in out) out.TotalBilledAmount = normalizeAmount(out.TotalBilledAmount)
    if ("CODAmount" in out)        out.CODAmount        = normalizeAmount(out.CODAmount)

    if ("Length" in out) out.Length = normalizeWeight(out.Length)  // same logic: numeric
    if ("Width"  in out) out.Width  = normalizeWeight(out.Width)
    if ("Height" in out) out.Height = normalizeWeight(out.Height)

    // Pincodes — replace with validated string or delete key entirely
    if ("OriginPincode" in out) {
      const p = normalizePincode(out.OriginPincode)
      if (p) out.OriginPincode = p
      else delete out.OriginPincode
    }
    if ("DestPincode" in out) {
      const p = normalizePincode(out.DestPincode)
      if (p) out.DestPincode = p
      else delete out.DestPincode
    }

    return out
  })
}

// ── Mapping applier ───────────────────────────────────────────────────────────

/**
 * Remaps raw rows (rawHeader → value) to canonical rows (canonical → value)
 * using the provided mapping.  Rows missing AWB or TotalBilledAmount are
 * dropped to prevent NaN propagation downstream.
 */
export function applyMapping(
  rows: Record<string, unknown>[],
  mapping: Record<string, string | null>
): Record<string, unknown>[] {
  const remapped = rows.map((row) => {
    const out: Record<string, unknown> = {}
    for (const [canonical, rawKey] of Object.entries(mapping)) {
      if (rawKey && rawKey in row) {
        out[canonical] = row[rawKey]
      }
    }
    return out
  })

  return remapped.filter(
    (row) => row.AWB != null && row.TotalBilledAmount != null
  )
}
