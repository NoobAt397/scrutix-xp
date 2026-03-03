import { GoogleGenerativeAI } from "@google/generative-ai"
import { NextRequest, NextResponse } from "next/server"

// ── In-memory rate limiter ─────────────────────────────────────────────────────
// 5 requests per IP per hour. Works for single-instance deployments.
// For multi-instance / serverless scale-out, replace with Upstash Redis.
const RATE_LIMIT_MAX    = 5
const RATE_LIMIT_WINDOW = 60 * 60 * 1000 // 1 hour in ms

interface RateLimitEntry {
  count:   number
  resetAt: number
}

const rateLimitStore = new Map<string, RateLimitEntry>()

function checkRateLimit(ip: string): boolean {
  const now   = Date.now()
  const entry = rateLimitStore.get(ip)

  if (!entry || now >= entry.resetAt) {
    rateLimitStore.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW })
    return true
  }

  if (entry.count >= RATE_LIMIT_MAX) return false

  entry.count++
  return true
}

// ── Allowed origins ────────────────────────────────────────────────────────────
const ALLOWED_ORIGINS = [
  "https://scrutix.vercel.app",
  "http://localhost:3000",
  "http://localhost:3001",
]

function isAllowedOrigin(request: NextRequest): boolean {
  const origin  = request.headers.get("origin")
  const referer = request.headers.get("referer")
  // No origin/referer = direct server-side call or dev curl — allow
  if (!origin && !referer) return true
  const source = origin ?? referer ?? ""
  return ALLOWED_ORIGINS.some((allowed) => source.startsWith(allowed))
}

// ── File size limit ────────────────────────────────────────────────────────────
const MAX_FILE_SIZE = 5 * 1024 * 1024 // 5 MB

// ── Route handler ──────────────────────────────────────────────────────────────
export async function POST(request: NextRequest) {
  // 1. Origin check
  if (!isAllowedOrigin(request)) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 })
  }

  // 2. Rate limiting — use first IP from x-forwarded-for (set by Vercel)
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "unknown"
  if (!checkRateLimit(ip)) {
    return NextResponse.json(
      { error: "Rate limit exceeded. Try again later." },
      { status: 429 }
    )
  }

  try {
    const formData = await request.formData()
    const file = formData.get("file") as File | null

    // 3. File validation — all checks before touching Gemini
    if (!file) {
      return NextResponse.json(
        { error: "Request must include a 'file' field containing a PDF." },
        { status: 400 }
      )
    }

    if (file.type !== "application/pdf") {
      return NextResponse.json(
        { error: "Only PDF files are accepted." },
        { status: 400 }
      )
    }

    if (file.size === 0) {
      return NextResponse.json(
        { error: "File is empty." },
        { status: 400 }
      )
    }

    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: "File too large. Maximum size is 5MB." },
        { status: 400 }
      )
    }

    // Convert PDF to base64 for Gemini inline data
    const bytes  = await file.arrayBuffer()
    const base64 = Buffer.from(bytes).toString("base64")

    // GEMINI_API_KEY is server-side only — no NEXT_PUBLIC_ prefix
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!)
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" })

    const prompt = `You are an AI trained to extract logistics contract rates for Indian D2C e-commerce brands.
Read this courier service agreement PDF and extract the exact pricing details.

Return ONLY a strict JSON object (no markdown, no backticks, no explanation) with these exact keys:
- provider_name         (string)  : courier company name, e.g. "Delhivery"
- zone_a_rate           (number)  : per 500g freight rate for Zone A (intra-city / metro-to-metro)
- zone_b_rate           (number)  : per 500g freight rate for Zone B (same state)
- zone_c_rate           (number)  : per 500g freight rate for Zone C (cross-state)
- cod_fee_percentage    (number)  : COD handling fee as a percentage of freight, e.g. 1.5
- rto_flat_fee          (number)  : Return-to-Origin flat fee in INR
- fuel_surcharge_percentage (number) : fuel or handling surcharge as a percentage of base freight
- docket_charge         (number)  : per-shipment docket / AWB charge in INR
- gst_percentage        (number)  : GST rate applied to courier services (typically 18)

Rules:
- All monetary values must be plain numbers in Indian Rupees (no currency symbols).
- If a field is not explicitly stated in the contract, use these sensible defaults:
  fuel_surcharge_percentage = 12, docket_charge = 25, gst_percentage = 18.
- Never return null; always return a number.`

    const result = await model.generateContent([
      {
        inlineData: {
          data: base64,
          mimeType: "application/pdf",
        },
      },
      prompt,
    ])

    const raw       = result.response.text().trim()
    const extracted = JSON.parse(raw)

    return NextResponse.json(extracted)
  } catch (error) {
    console.error("[extract-contract] Error:", error)
    return NextResponse.json(
      { error: "Failed to extract contract data from PDF." },
      { status: 500 }
    )
  }
}
