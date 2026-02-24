"use client"

import { useEffect, useState } from "react"
import { X, FileText, Sparkles, ChevronLeft, ChevronRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import type { ExtractionSource } from "@/app/api/extract-invoice/route"

// ── Columns we try to surface in the preview ──────────────────────────────────
const PREVIEW_KEYS = [
  "AWB No.",
  "AWB",
  "Billed Zone",
  "Zone",
  "Billed Weight",
  "Actual Weight",
  "Total Billed Amount",
  "COD Amount",
  "Order Type",
  "Type",
]

/** Pick the first N columns that actually appear in at least one row. */
function selectColumns(rows: Record<string, unknown>[], max = 6): string[] {
  const allKeys = new Set(rows.flatMap((r) => Object.keys(r)))
  const preferred = PREVIEW_KEYS.filter((k) => allKeys.has(k))
  if (preferred.length >= 2) return preferred.slice(0, max)
  // Fall back to whatever keys exist
  return [...allKeys].slice(0, max)
}

// ── Source badge ──────────────────────────────────────────────────────────────

function SourceBadge({ source }: { source: ExtractionSource }) {
  if (source === "ai") {
    return (
      <span
        className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-sm border"
        style={{
          color: "rgb(192,132,252)",
          background: "rgba(124,58,237,0.1)",
          borderColor: "rgba(124,58,237,0.3)",
        }}
      >
        <Sparkles size={9} />
        Gemini AI
      </span>
    )
  }
  return (
    <span
      className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-sm border"
      style={{
        color: "rgb(96,165,250)",
        background: "rgba(37,99,235,0.1)",
        borderColor: "rgba(37,99,235,0.3)",
      }}
    >
      <FileText size={9} />
      Text Extracted
    </span>
  )
}

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  rows: Record<string, unknown>[]
  source: ExtractionSource
  pageCount: number
  fileName: string
  onConfirm: (rows: Record<string, unknown>[], source: ExtractionSource) => void
  onClose: () => void
}

const PAGE_SIZE = 20

// ── Main component ─────────────────────────────────────────────────────────────

export default function PDFPreviewModal({
  rows,
  source,
  pageCount,
  fileName,
  onConfirm,
  onClose,
}: Props) {
  const [page, setPage] = useState(0)
  const columns = selectColumns(rows)
  const totalPages = Math.ceil(rows.length / PAGE_SIZE)
  const visibleRows = rows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)

  // Escape key + body scroll lock
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
    }
    window.addEventListener("keydown", handler)
    document.body.style.overflow = "hidden"
    return () => {
      window.removeEventListener("keydown", handler)
      document.body.style.overflow = ""
    }
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.85)" }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        className="relative w-full max-w-4xl max-h-[90vh] flex flex-col rounded-lg border border-zinc-800/80 shadow-2xl overflow-hidden"
        style={{ background: "#0a0a0a" }}
      >
        {/* ── Header ── */}
        <div className="flex items-start justify-between gap-3 px-5 pt-5 pb-4 border-b border-zinc-800/60 flex-shrink-0">
          <div className="space-y-1.5">
            <p className="text-[11px] text-zinc-500 uppercase tracking-widest font-semibold">
              PDF Invoice Preview
            </p>
            <p className="text-sm text-zinc-200 font-mono truncate max-w-xs">{fileName}</p>
            <div className="flex items-center gap-2 flex-wrap">
              <SourceBadge source={source} />
              <span className="text-[10px] text-zinc-600">
                {rows.length} row{rows.length !== 1 ? "s" : ""} extracted
              </span>
              <span className="text-[10px] text-zinc-700">·</span>
              <span className="text-[10px] text-zinc-600">
                {pageCount} PDF page{pageCount !== 1 ? "s" : ""}
              </span>
            </div>
            {source === "ai" && (
              <p className="text-[11px] text-amber-500/80">
                Scanned PDF — data extracted by Gemini AI. Verify before running audit.
              </p>
            )}
          </div>
          <button
            onClick={onClose}
            className="text-zinc-600 hover:text-zinc-300 transition-colors mt-0.5 flex-shrink-0"
          >
            <X size={18} />
          </button>
        </div>

        {/* ── Table ── */}
        <div className="overflow-auto flex-1">
          {rows.length === 0 ? (
            <div className="flex items-center justify-center py-16 text-zinc-600 text-sm">
              No rows were extracted from this PDF.
            </div>
          ) : (
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="border-b border-zinc-800/60 bg-zinc-950/60 sticky top-0">
                  <th
                    className="text-left px-3 py-2 text-[10px] uppercase tracking-wider text-zinc-600 font-medium w-10"
                    style={{ background: "rgba(10,10,10,0.95)" }}
                  >
                    #
                  </th>
                  {columns.map((col) => (
                    <th
                      key={col}
                      className="text-left px-3 py-2 text-[10px] uppercase tracking-wider text-zinc-500 font-medium whitespace-nowrap"
                      style={{ background: "rgba(10,10,10,0.95)" }}
                    >
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((row, i) => (
                  <tr
                    key={i}
                    className="border-b border-zinc-800/30 hover:bg-zinc-900/40 transition-colors"
                  >
                    <td className="px-3 py-1.5 text-zinc-700 tabular-nums">
                      {page * PAGE_SIZE + i + 1}
                    </td>
                    {columns.map((col) => (
                      <td
                        key={col}
                        className="px-3 py-1.5 text-zinc-300 font-mono max-w-[160px] truncate"
                      >
                        {row[col] != null ? String(row[col]) : (
                          <span className="text-zinc-700">—</span>
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* ── Footer ── */}
        <div className="flex items-center justify-between gap-3 px-5 py-4 border-t border-zinc-800/60 flex-shrink-0">
          {/* Pagination */}
          {totalPages > 1 ? (
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={page === 0}
                className="p-1 text-zinc-500 hover:text-zinc-200 disabled:opacity-30 transition-colors"
              >
                <ChevronLeft size={14} />
              </button>
              <span className="text-[11px] text-zinc-500 tabular-nums">
                {page + 1} / {totalPages}
              </span>
              <button
                onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                disabled={page === totalPages - 1}
                className="p-1 text-zinc-500 hover:text-zinc-200 disabled:opacity-30 transition-colors"
              >
                <ChevronRight size={14} />
              </button>
            </div>
          ) : (
            <div />
          )}

          {/* Actions */}
          <div className="flex items-center gap-3">
            <button
              onClick={onClose}
              className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors px-2"
            >
              Cancel
            </button>
            <Button
              size="sm"
              disabled={rows.length === 0}
              onClick={() => onConfirm(rows, source)}
              className="h-8 px-4 text-xs text-white disabled:opacity-30 border-0"
              style={{ backgroundColor: "#1F4D3F" }}
            >
              Run Audit →
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
