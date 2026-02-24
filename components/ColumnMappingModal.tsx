"use client"

import { useEffect, useState } from "react"
import { X, Sparkles, AlertTriangle, CheckCircle2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  REQUIRED_CANONICAL,
  OPTIONAL_CANONICAL,
  CONFIDENCE_THRESHOLD,
  type DetectionResult,
} from "@/lib/column-matcher"

// ── Human-readable labels for canonical field names ──────────────────────────
const FIELD_LABELS: Record<string, string> = {
  AWB:               "AWB / Tracking No.",
  OrderType:         "Order Type",
  BilledWeight:      "Billed Weight",
  ActualWeight:      "Actual Weight",
  BilledZone:        "Billed Zone",
  ActualZone:        "Actual Zone",
  TotalBilledAmount: "Total Billed Amount",
  Length:            "Length (cm)",
  Width:             "Width (cm)",
  Height:            "Height (cm)",
  OriginPincode:     "Origin Pincode",
  DestPincode:       "Destination Pincode",
  CODAmount:         "COD Amount",
  ShipmentDate:      "Shipment Date",
}

interface Props {
  rawHeaders:  string[]
  detection:   DetectionResult
  onConfirm:   (mapping: Record<string, string | null>) => void
  onClose:     () => void
}

// ── Confidence badge ──────────────────────────────────────────────────────────
function ConfBadge({ score }: { score: number }) {
  const pct = Math.round(score * 100)
  const color =
    score >= 0.9
      ? { text: "rgb(134,239,172)", bg: "rgba(22,163,74,0.12)", border: "rgba(22,163,74,0.3)" }
      : score >= CONFIDENCE_THRESHOLD
      ? { text: "rgb(161,161,170)", bg: "rgba(39,39,42,0.4)",   border: "rgba(63,63,70,0.5)" }
      : { text: "rgb(252,211,77)",  bg: "rgba(217,119,6,0.12)", border: "rgba(217,119,6,0.3)" }

  if (score === 0) {
    return (
      <span className="text-[10px] font-mono text-zinc-700 tracking-wide px-2">—</span>
    )
  }
  return (
    <span
      className="inline-flex items-center gap-1 text-[10px] font-mono px-2 py-0.5 rounded-sm border tabular-nums"
      style={{ color: color.text, background: color.bg, borderColor: color.border }}
    >
      {score < CONFIDENCE_THRESHOLD && <AlertTriangle size={9} />}
      {pct}%
    </span>
  )
}

// ── Main Component ─────────────────────────────────────────────────────────────
export default function ColumnMappingModal({
  rawHeaders,
  detection,
  onConfirm,
  onClose,
}: Props) {
  // Local state: user-editable mapping
  const [mapping, setMapping] = useState<Record<string, string | null>>(
    () => ({ ...detection.mapping })
  )
  const [isAiLoading, setIsAiLoading] = useState(false)

  // Escape key + body scroll lock
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose() }
    window.addEventListener("keydown", handler)
    document.body.style.overflow = "hidden"
    return () => {
      window.removeEventListener("keydown", handler)
      document.body.style.overflow = ""
    }
  }, [onClose])

  // Derived: which required fields are still unresolved
  const unresolvedRequired = REQUIRED_CANONICAL.filter((f) => !mapping[f])

  async function handleAiAssist() {
    setIsAiLoading(true)
    try {
      const res = await fetch("/api/map-headers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rawHeaders }),
      })
      if (!res.ok) throw new Error("AI mapping failed")
      const aiMapping: Record<string, string | null> = await res.json()

      // Merge: AI result only fills slots where user hasn't already set a value
      setMapping((prev) => {
        const merged = { ...prev }
        for (const [canonical, raw] of Object.entries(aiMapping)) {
          if (!merged[canonical] && raw) merged[canonical] = raw
        }
        return merged
      })
    } catch {
      // Silent fail — user still has manual controls
    } finally {
      setIsAiLoading(false)
    }
  }

  function handleSelect(canonical: string, value: string) {
    setMapping((prev) => ({ ...prev, [canonical]: value || null }))
  }

  // ── Render ────────────────────────────────────────────────────────────────

  const selectStyle: React.CSSProperties = {
    background: "rgba(24,24,27,0.9)",
    border: "1px solid rgba(63,63,70,0.7)",
    borderRadius: "4px",
    color: "rgb(161,161,170)",
    fontSize: "11px",
    padding: "4px 8px",
    width: "100%",
    outline: "none",
    cursor: "pointer",
  }

  function FieldRow({
    canonical,
    required,
  }: {
    canonical: string
    required: boolean
  }) {
    const raw     = mapping[canonical]
    const score   = raw ? (detection.confidences[canonical] ?? 0) : 0
    const changed = raw !== detection.mapping[canonical]
    const missing = required && !raw

    return (
      <div
        className="grid items-center gap-3 px-3 py-2 border-b border-zinc-800/40 last:border-0"
        style={{
          gridTemplateColumns: "160px 1fr 54px",
          background: missing ? "rgba(185,28,28,0.06)" : "transparent",
        }}
      >
        {/* Field label */}
        <div className="flex items-center gap-1.5">
          {required && (
            <span
              className="w-1 h-1 rounded-full flex-shrink-0"
              style={{ backgroundColor: missing ? "rgb(239,68,68)" : "rgb(82,82,91)" }}
            />
          )}
          <span
            className="text-[11px] uppercase tracking-wider"
            style={{ color: missing ? "rgb(248,113,113)" : "rgb(113,113,122)" }}
          >
            {FIELD_LABELS[canonical] ?? canonical}
          </span>
        </div>

        {/* Dropdown selector */}
        <div className="relative">
          <select
            value={raw ?? ""}
            onChange={(e) => handleSelect(canonical, e.target.value)}
            style={{
              ...selectStyle,
              color: raw ? (changed ? "rgb(252,211,77)" : "rgb(212,212,216)") : "rgb(82,82,91)",
              borderColor: missing
                ? "rgba(185,28,28,0.4)"
                : changed
                ? "rgba(217,119,6,0.4)"
                : "rgba(63,63,70,0.7)",
            }}
          >
            <option value="">— Not Detected —</option>
            {rawHeaders.map((h) => (
              <option key={h} value={h}>
                {h}
              </option>
            ))}
          </select>
        </div>

        {/* Confidence badge */}
        <div className="flex justify-end">
          {raw ? (
            changed ? (
              <span className="text-[10px] text-amber-500 font-medium tracking-wide">edited</span>
            ) : (
              <ConfBadge score={score} />
            )
          ) : (
            <span className="text-[10px] text-zinc-700">—</span>
          )}
        </div>
      </div>
    )
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.85)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        className="relative w-full max-w-xl max-h-[90vh] flex flex-col rounded-lg border border-zinc-800/80 shadow-2xl overflow-hidden"
        style={{ background: "#0a0a0a" }}
      >
        {/* ── Header ── */}
        <div className="flex items-start justify-between gap-3 px-5 pt-5 pb-4 border-b border-zinc-800/60 flex-shrink-0">
          <div className="space-y-1">
            <p className="text-[11px] text-zinc-500 uppercase tracking-widest font-semibold">
              Map CSV Columns
            </p>
            <p className="text-sm text-zinc-200">
              {rawHeaders.length} column{rawHeaders.length !== 1 ? "s" : ""} detected
            </p>
            {detection.lowConfidenceFields.length > 0 && (
              <p className="text-[11px] text-amber-500 flex items-center gap-1.5">
                <AlertTriangle size={11} />
                {detection.lowConfidenceFields.length} field
                {detection.lowConfidenceFields.length !== 1 ? "s" : ""} need your review
              </p>
            )}
          </div>
          <button
            onClick={onClose}
            className="text-zinc-600 hover:text-zinc-300 transition-colors mt-0.5"
          >
            <X size={18} />
          </button>
        </div>

        {/* ── Body ── */}
        <div className="overflow-y-auto flex-1">
          {/* Required fields */}
          <div className="px-3 pt-3 pb-1">
            <p className="text-[10px] text-zinc-600 uppercase tracking-widest px-1 pb-1">
              Required Fields
            </p>
            <div
              className="rounded-md border border-zinc-800/50 overflow-hidden"
              style={{ background: "rgba(15,15,15,0.8)" }}
            >
              {/* Column headers */}
              <div
                className="grid px-3 py-1.5 border-b border-zinc-800/60"
                style={{ gridTemplateColumns: "160px 1fr 54px" }}
              >
                <span className="text-[10px] text-zinc-700 uppercase tracking-wider">Field</span>
                <span className="text-[10px] text-zinc-700 uppercase tracking-wider">
                  Your CSV Column
                </span>
                <span className="text-[10px] text-zinc-700 uppercase tracking-wider text-right">
                  Conf.
                </span>
              </div>
              {REQUIRED_CANONICAL.map((f) => (
                <FieldRow key={f} canonical={f} required />
              ))}
            </div>
          </div>

          {/* Optional fields */}
          <div className="px-3 pt-3 pb-4">
            <p className="text-[10px] text-zinc-700 uppercase tracking-widest px-1 pb-1">
              Optional Fields (volumetric weight &amp; zone validation)
            </p>
            <div
              className="rounded-md border border-zinc-800/30 overflow-hidden"
              style={{ background: "rgba(15,15,15,0.5)" }}
            >
              <div
                className="grid px-3 py-1.5 border-b border-zinc-800/40"
                style={{ gridTemplateColumns: "160px 1fr 54px" }}
              >
                <span className="text-[10px] text-zinc-700 uppercase tracking-wider">Field</span>
                <span className="text-[10px] text-zinc-700 uppercase tracking-wider">
                  Your CSV Column
                </span>
                <span className="text-[10px] text-zinc-700 uppercase tracking-wider text-right">
                  Conf.
                </span>
              </div>
              {OPTIONAL_CANONICAL.map((f) => (
                <FieldRow key={f} canonical={f} required={false} />
              ))}
            </div>
          </div>
        </div>

        {/* ── Footer ── */}
        <div className="flex items-center justify-between gap-3 px-5 py-4 border-t border-zinc-800/60 flex-shrink-0">
          {/* AI Assist */}
          <Button
            variant="outline"
            size="sm"
            disabled={isAiLoading}
            onClick={handleAiAssist}
            className="h-8 px-3 text-xs border-zinc-700/60 text-zinc-400 hover:text-white hover:border-zinc-500 bg-transparent"
          >
            {isAiLoading ? (
              <span className="flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-ping" />
                AI Analyzing…
              </span>
            ) : (
              <span className="flex items-center gap-1.5">
                <Sparkles size={11} className="text-violet-400" />
                AI Assist
              </span>
            )}
          </Button>

          {/* Status + Confirm */}
          <div className="flex items-center gap-3">
            {unresolvedRequired.length > 0 ? (
              <span className="text-[11px] text-red-500 flex items-center gap-1">
                <AlertTriangle size={11} />
                {unresolvedRequired.length} required field{unresolvedRequired.length !== 1 ? "s" : ""} missing
              </span>
            ) : (
              <span className="text-[11px] text-green-500 flex items-center gap-1">
                <CheckCircle2 size={11} />
                All required fields mapped
              </span>
            )}

            <Button
              size="sm"
              disabled={unresolvedRequired.length > 0}
              onClick={() => onConfirm(mapping)}
              className="h-8 px-4 text-xs text-white disabled:opacity-30 border-0"
              style={{ backgroundColor: "#1F4D3F" }}
            >
              Confirm →
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
