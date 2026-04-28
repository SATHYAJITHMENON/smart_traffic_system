"use client"
import { motion, AnimatePresence } from "framer-motion"
import { useEffect, useRef, useState } from "react"

// ── Types ─────────────────────────────────────────────────────

export interface DecisionLane {
  lane: string
  green_time: number
  vehicle_count: number
  queue_length: number
  avg_wait_time: number
  raw_score: number
  mode: string
}

interface Props {
  decisionData: DecisionLane[] | null
  mode: string
  prevData?: DecisionLane[] | null
  embedded?: boolean
}

// ── Helpers ───────────────────────────────────────────────────

const LANE_META: Record<string, { emoji: string; color: string; bg: string; border: string }> = {
  north: { emoji: "↑", color: "#34d399", bg: "rgba(52,211,153,0.08)", border: "rgba(52,211,153,0.3)" },
  south: { emoji: "↓", color: "#60a5fa", bg: "rgba(96,165,250,0.08)", border: "rgba(96,165,250,0.3)" },
  east: { emoji: "→", color: "#f59e0b", bg: "rgba(245,158,11,0.08)", border: "rgba(245,158,11,0.3)" },
  west: { emoji: "←", color: "#a78bfa", bg: "rgba(167,139,250,0.08)", border: "rgba(167,139,250,0.3)" },
}

function Delta({ prev, curr, unit = "" }: { prev?: number; curr: number; unit?: string }) {
  if (prev === undefined || prev === curr) return null
  const diff = curr - prev
  const up = diff > 0
  return (
    <span style={{ fontSize: 10, fontWeight: 700, color: up ? "#f87171" : "#4ade80", marginLeft: 4 }}>
      {up ? "▲" : "▼"}{Math.abs(diff).toFixed(unit === "s" ? 0 : 1)}{unit}
    </span>
  )
}

function ScoreBar({ score, max, color }: { score: number; max: number; color: string }) {
  const pct = Math.min(100, (score / max) * 100)
  return (
    <div style={{ width: "100%", height: 6, borderRadius: 3, background: "rgba(255,255,255,0.07)", overflow: "hidden" }}>
      <motion.div
        initial={{ width: 0 }}
        animate={{ width: `${pct}%` }}
        transition={{ duration: 0.6 }}
        style={{ height: "100%", background: color }}
      />
    </div>
  )
}

// 🧠 NEW: PER-LANE AI REASONING FUNCTION
function getLaneReason(
  lane: DecisionLane,
  winner: DecisionLane,
  isAdaptive: boolean
): string {
  if (!isAdaptive) {
    return `Fixed rule: ${lane.vehicle_count} vehicles → ${lane.green_time}s`
  }

  const parts: string[] = []

  if (lane.queue_length > 0)
    parts.push(`${lane.queue_length} queue`)

  if (lane.avg_wait_time > 0)
    parts.push(`${lane.avg_wait_time.toFixed(0)}s wait`)

  if (lane.vehicle_count > 0)
    parts.push(`${lane.vehicle_count} vehicles`)

  const base = parts.length ? parts.join(" + ") : "low traffic"

  if (lane.lane === winner.lane) {
    return `✅ Selected: highest priority due to ${base}`
  }

  const diff = (winner.raw_score - lane.raw_score).toFixed(1)

  return `⬇ Lower priority (${diff} pts behind) due to ${base}`
}

function FormulaTooltip({ qw, ww }: { qw: number; ww: number }) {
  const [open, setOpen] = useState(false)
  return (
    <div style={{ position: "relative" }}>
      <button onClick={() => setOpen(v => !v)} style={{ fontSize: 10 }}>ℹ️</button>
      {open && (
        <div style={{
          position: "absolute", top: 20, right: 0,
          background: "#0f172a", padding: 10, borderRadius: 8
        }}>
          <code>score = 8 + queue×{qw} + wait×{ww}</code>
        </div>
      )}
    </div>
  )
}
// ── AI Reasoning Summary (UPGRADED) ───────────────────────────

function ReasoningSummary({ decisionData, mode }: { decisionData: DecisionLane[]; mode: string }) {
  const isAdaptive = mode === "adaptive"
  const winner = decisionData[0]
  const others = decisionData.slice(1)

  const legacyGreenTime = Math.min(60, Math.max(10, winner.vehicle_count * 3))
  const adaptiveGreenTime = winner.green_time
  const timeDiff = adaptiveGreenTime - legacyGreenTime

  // 🧠 IMPROVED EXPLANATION
  function buildReason(): string {
    if (!isAdaptive) {
      return `Legacy mode assigns signal time only using vehicle count. It ignores queue buildup and waiting delays, which can lead to inefficient traffic handling and longer congestion periods.`
    }

    const reasons: string[] = []

    if (winner.queue_length > 0)
      reasons.push(`largest queue (${winner.queue_length})`)

    if (winner.avg_wait_time > 0)
      reasons.push(`longest wait (${winner.avg_wait_time.toFixed(0)}s)`)

    if (winner.vehicle_count > 0)
      reasons.push(`high vehicle density (${winner.vehicle_count})`)

    const second = others[0]

    return `AI prioritised ${winner.lane.toUpperCase()} because it has ${reasons.join(" and ")}. 
This maximizes congestion reduction by targeting the most critical lane first. 
It outperformed ${second?.lane ?? "other lanes"} by ${(
        winner.raw_score - (second?.raw_score ?? 0)
      ).toFixed(1)} points.`
  }

  // 🚀 STRONGER TIME SAVING LOGIC
  function buildTimeSavedLine(): string | null {
    if (!isAdaptive) return null

    const vehiclesCleared = winner.green_time / 3
    const legacyVehicles = legacyGreenTime / 3

    if (timeDiff > 0) {
      return `🚀 Clears ~${vehiclesCleared.toFixed(0)} vehicles vs ${legacyVehicles.toFixed(0)} in legacy → faster congestion removal`
    }

    if (timeDiff < 0) {
      return `⚖️ Shorter green time allows other lanes to clear earlier, preventing future congestion buildup`
    }

    return `⚖️ Balanced allocation across lanes with equal priority`
  }

  const timeSavedLine = buildTimeSavedLine()

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      style={{
        background: "rgba(96,165,250,0.05)",
        border: "1px solid rgba(96,165,250,0.15)",
        borderRadius: 10,
        padding: "12px 14px",
        marginBottom: 14,
      }}
    >
      <div style={{
        fontSize: 10,
        fontWeight: 700,
        color: "#60a5fa",
        marginBottom: 4,
        letterSpacing: "0.05em"
      }}>
        💬 AI REASONING ENGINE
      </div>

      <p style={{
        fontSize: 12,
        color: "#94a3b8",
        lineHeight: 1.7,
        margin: 0
      }}>
        {buildReason()}
      </p>

      {timeSavedLine && (
        <p style={{
          fontSize: 11,
          color: "#4ade80",
          marginTop: 6,
          fontWeight: 600
        }}>
          {timeSavedLine}
        </p>
      )}
    </motion.div>
  )
}
function PanelContent({
  decisionData,
  mode,
  prevMap,
}: {
  decisionData: DecisionLane[]
  mode: string
  prevMap: React.MutableRefObject<Record<string, DecisionLane>>
}) {
  const isAdaptive = mode === "adaptive"
  const maxScore = Math.max(...decisionData.map(d => d.raw_score ?? d.green_time))

  const winner = decisionData[0]
  const winnerMeta = LANE_META[winner.lane] ?? LANE_META.north

  return (
    <>
      {/* Header */}
      <div style={{
        display: "flex",
        justifyContent: "space-between",
        marginBottom: 12
      }}>
        <span style={{
          fontSize: 10,
          fontWeight: 700,
          color: isAdaptive ? "#60a5fa" : "#a78bfa"
        }}>
          {isAdaptive ? "ADAPTIVE AI" : "LEGACY"}
        </span>

        {isAdaptive && <FormulaTooltip qw={2.5} ww={0.4} />}
      </div>

      {/* Winner */}
      <div style={{
        background: winnerMeta.bg,
        border: `1px solid ${winnerMeta.border}`,
        borderRadius: 10,
        padding: 12,
        marginBottom: 12,
        display: "flex",
        justifyContent: "space-between"
      }}>
        <div>
          <div style={{ fontSize: 10, color: "#64748b" }}>SELECTED</div>
          <div style={{ fontSize: 18, fontWeight: 800, color: winnerMeta.color }}>
            {winnerMeta.emoji} {winner.lane.toUpperCase()}
          </div>
        </div>

        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 10, color: "#64748b" }}>GREEN</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: "#4ade80" }}>
            {winner.green_time}s
          </div>
        </div>
      </div>

      {/* AI Summary */}
      <ReasoningSummary decisionData={decisionData} mode={mode} />

      {/* Lanes */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {decisionData.map((lane, i) => {
          const meta = LANE_META[lane.lane] ?? LANE_META.north
          const prev = prevMap.current[lane.lane]
          const isWinner = i === 0

          return (
            <div key={lane.lane} style={{
              background: isWinner ? meta.bg : "rgba(255,255,255,0.02)",
              border: `1px solid ${isWinner ? meta.border : "rgba(255,255,255,0.05)"}`,
              borderRadius: 10,
              padding: 10
            }}>
              {/* Top Row */}
              <div style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                marginBottom: 6
              }}>
                <span style={{
                  width: 24,
                  height: 24,
                  borderRadius: 6,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  background: meta.bg,
                  color: meta.color,
                  fontWeight: 700
                }}>
                  {meta.emoji}
                </span>

                <span style={{
                  flex: 1,
                  fontSize: 13,
                  fontWeight: 700
                }}>
                  {lane.lane}
                  {isWinner && (
                    <span style={{
                      marginLeft: 6,
                      fontSize: 9,
                      background: meta.color,
                      color: "#000",
                      padding: "1px 4px",
                      borderRadius: 4
                    }}>
                      WINNER
                    </span>
                  )}
                </span>

                <span style={{ fontSize: 12, color: meta.color }}>
                  {lane.raw_score?.toFixed(1)}
                </span>

                <span style={{ fontSize: 12 }}>
                  {lane.green_time}s
                  <Delta prev={prev?.green_time} curr={lane.green_time} unit="s" />
                </span>
              </div>

              {/* Score Bar */}
              {isAdaptive && (
                <div style={{ marginBottom: 6 }}>
                  <ScoreBar
                    score={lane.raw_score ?? lane.green_time}
                    max={maxScore}
                    color={meta.color}
                  />
                </div>
              )}

              {/* Metrics */}
              {isAdaptive && (
                <div style={{
                  display: "flex",
                  gap: 12,
                  fontSize: 10,
                  color: "#94a3b8"
                }}>
                  <span>Q: {lane.queue_length}</span>
                  <span>W: {lane.avg_wait_time}s</span>
                  <span>V: {lane.vehicle_count}</span>
                </div>
              )}

              {/* 🧠 NEW: AI Reason per lane */}
              <div style={{
                marginTop: 6,
                fontSize: 10,
                color: "#64748b",
                lineHeight: 1.5
              }}>
                {getLaneReason(lane, winner, isAdaptive)}
              </div>

            </div>
          )
        })}
      </div>

      {/* Footer */}
      <div style={{
        marginTop: 10,
        fontSize: 10,
        color: "#475569"
      }}>
        {isAdaptive
          ? "AI prioritizes lanes using queue + wait + vehicles"
          : "Legacy uses only vehicle count"}
      </div>
    </>
  )
}
export default function AIDecisionPanel({
  decisionData,
  mode,
  prevData,
  embedded = false
}: Props) {

  const prevMap = useRef<Record<string, DecisionLane>>({})

  // Store previous values (for delta indicators)
  useEffect(() => {
    if (prevData) {
      const map: Record<string, DecisionLane> = {}
      for (const d of prevData) {
        map[d.lane] = d
      }
      prevMap.current = map
    }
  }, [prevData])

  // Nothing to show
  if (!decisionData || decisionData.length === 0) {
    return null
  }

  // Embedded version (used inside sidebar)
  if (embedded) {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.3 }}
        style={{
          padding: "12px 14px"
        }}
      >
        <PanelContent
          decisionData={decisionData}
          mode={mode}
          prevMap={prevMap}
        />
      </motion.div>
    )
  }

  // Standalone full card
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      style={{
        background: "rgba(15,23,42,0.9)",
        border: "1px solid rgba(255,255,255,0.08)",
        borderRadius: 14,
        padding: "16px 18px",
        backdropFilter: "blur(10px)"
      }}
    >
      {/* Header */}
      <div style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        marginBottom: 12
      }}>
        <div style={{
          display: "flex",
          alignItems: "center",
          gap: 6
        }}>
          <span style={{ fontSize: 16 }}>🧠</span>
          <span style={{
            fontWeight: 700,
            fontSize: 13,
            color: "#e2e8f0"
          }}>
            AI Traffic Decision
          </span>

          <span style={{
            fontSize: 9,
            padding: "2px 6px",
            borderRadius: 5,
            fontWeight: 700,
            background: mode === "adaptive"
              ? "rgba(96,165,250,0.15)"
              : "rgba(168,85,247,0.15)",
            color: mode === "adaptive"
              ? "#60a5fa"
              : "#a78bfa",
            border: `1px solid ${mode === "adaptive"
                ? "rgba(96,165,250,0.3)"
                : "rgba(168,85,247,0.3)"
              }`
          }}>
            {mode === "adaptive" ? "ADAPTIVE" : "LEGACY"}
          </span>
        </div>

        {mode === "adaptive" && (
          <FormulaTooltip qw={2.5} ww={0.4} />
        )}
      </div>

      {/* Core Content */}
      <PanelContent
        decisionData={decisionData}
        mode={mode}
        prevMap={prevMap}
      />

    </motion.div>
  )
}