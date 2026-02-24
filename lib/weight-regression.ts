/**
 * Weight discrepancy regression analysis.
 *
 * Stores per-AWB declared vs billed weight pairs in localStorage and
 * runs least-squares linear regression per provider to detect systematic
 * overbilling patterns.
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export interface WeightDataPoint {
  provider: string
  awb: string
  declaredWeight_g: number   // actual / declared weight in grams
  billedWeight_g: number     // what the provider billed in grams
  date: number               // Date.now() at time of audit
}

export interface RegressionResult {
  provider: string
  pointCount: number
  slope: number        // m  (billedWeight = m * declaredWeight + b)
  intercept: number    // b
  r2: number           // coefficient of determination  [0, 1]
  avgOverchargePct: number  // mean((billed - declared) / declared) * 100
}

// ── Constants ─────────────────────────────────────────────────────────────────

const STORAGE_KEY = "mosaic_weight_data"
const MAX_RECORDS = 10_000
const MIN_POINTS_FOR_REGRESSION = 30
const MAX_DISPLAY_POINTS = 300

// ── Regression math ───────────────────────────────────────────────────────────

/**
 * Least-squares linear regression: y = m*x + b
 *
 * Formulas:
 *   m = (n·Σxy − Σx·Σy) / (n·Σx² − (Σx)²)
 *   b = (Σy − m·Σx) / n
 *   R² = 1 − SS_res / SS_tot
 */
export function runRegression(points: WeightDataPoint[]): RegressionResult | null {
  const n = points.length
  if (n < MIN_POINTS_FOR_REGRESSION) return null

  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0, sumOverchargePct = 0

  for (const p of points) {
    const x = p.declaredWeight_g
    const y = p.billedWeight_g
    sumX  += x
    sumY  += y
    sumXY += x * y
    sumX2 += x * x
    if (p.declaredWeight_g > 0) {
      sumOverchargePct += (p.billedWeight_g - p.declaredWeight_g) / p.declaredWeight_g
    }
  }

  const denom = n * sumX2 - sumX * sumX
  if (denom === 0) return null   // all x values identical — can't regress

  const m = (n * sumXY - sumX * sumY) / denom
  const b = (sumY - m * sumX) / n

  // R²
  const meanY = sumY / n
  let ssTot = 0, ssRes = 0
  for (const p of points) {
    const y = p.billedWeight_g
    const yHat = m * p.declaredWeight_g + b
    ssTot += (y - meanY) ** 2
    ssRes += (y - yHat) ** 2
  }
  const r2 = ssTot === 0 ? 1 : 1 - ssRes / ssTot

  return {
    provider: points[0].provider,
    pointCount: n,
    slope: Math.round(m * 10000) / 10000,
    intercept: Math.round(b * 100) / 100,
    r2: Math.round(r2 * 10000) / 10000,
    avgOverchargePct: Math.round((sumOverchargePct / n) * 10000) / 100,
  }
}

// ── Sampling ──────────────────────────────────────────────────────────────────

/**
 * Returns up to maxN evenly-sampled points from `points`.
 * The full array is always used for regression; this is only for rendering.
 */
export function sampleForDisplay(
  points: WeightDataPoint[],
  maxN = MAX_DISPLAY_POINTS
): WeightDataPoint[] {
  if (points.length <= maxN) return points
  const step = points.length / maxN
  const sampled: WeightDataPoint[] = []
  for (let i = 0; i < maxN; i++) {
    sampled.push(points[Math.floor(i * step)])
  }
  return sampled
}

// ── Grouping ──────────────────────────────────────────────────────────────────

/**
 * Groups an array of WeightDataPoints by provider name.
 */
export function groupByProvider(
  points: WeightDataPoint[]
): Map<string, WeightDataPoint[]> {
  const map = new Map<string, WeightDataPoint[]>()
  for (const p of points) {
    const existing = map.get(p.provider)
    if (existing) {
      existing.push(p)
    } else {
      map.set(p.provider, [p])
    }
  }
  return map
}

// ── localStorage helpers ──────────────────────────────────────────────────────

export function storeWeightData(newPoints: WeightDataPoint[]): void {
  if (typeof window === "undefined" || newPoints.length === 0) return
  try {
    const existing = loadWeightData()
    const merged = [...existing, ...newPoints]
    const trimmed = merged.slice(-MAX_RECORDS)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed))
  } catch {
    // localStorage unavailable or quota exceeded
  }
}

export function loadWeightData(): WeightDataPoint[] {
  if (typeof window === "undefined") return []
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    return JSON.parse(raw) as WeightDataPoint[]
  } catch {
    return []
  }
}

export function clearWeightData(): void {
  if (typeof window === "undefined") return
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    // ignore
  }
}
