"use client"
import { motion, AnimatePresence } from "framer-motion"
import { useEffect, useRef, useState } from "react"

// ── Types ────────────────────────────────────────────────────────────────────

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
  /** When true, strips the outer card shell so it can nest inside a wrapper */
  embedded?: boolean
}

// ── Helpers ───────────────────────────────────────────────────────────────────

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
        transition={{ duration: 0.6, ease: "easeOut" }}
        style={{ height: "100%", background: color, borderRadius: 3 }}
      />
    </div>
  )
}

function FormulaTooltip({ qw, ww }: { qw: number; ww: number }) {
  const [open, setOpen] = useState(false)
  return (
    <div style={{ position: "relative", display: "inline-block" }}>
      <button
        onClick={() => setOpen(v => !v)}
        style={{
          fontSize: 10, color: "#64748b",
          background: "rgba(255,255,255,0.05)",
          border: "1px solid rgba(255,255,255,0.08)",
          borderRadius: 4, padding: "1px 6px", cursor: "pointer",
        }}
      >
        formula ℹ️
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            style={{
              position: "absolute", top: "calc(100% + 6px)", right: 0, zIndex: 50,
              background: "#0f172a", border: "1px solid rgba(255,255,255,0.12)",
              borderRadius: 10, padding: "10px 14px", width: 260,
              boxShadow: "0 8px 32px rgba(0,0,0,0.6)",
            }}
          >
            <p style={{ fontSize: 11, color: "#94a3b8", marginBottom: 6, fontWeight: 700 }}>
              Adaptive scoring formula
            </p>
            <code style={{ fontSize: 12, color: "#e2e8f0", display: "block", lineHeight: 1.6 }}>
              score = 8 + queue × {qw} + wait × {ww}
            </code>
            <p style={{ fontSize: 10, color: "#64748b", marginTop: 6 }}>
              green_time = clamp(score, 10s, 60s)<br />
              Highest score → Selected lane gets priority
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ── AI Reasoning Summary ───────────────────────────────────────────────────────

function ReasoningSummary({ decisionData, mode }: { decisionData: DecisionLane[]; mode: string }) {
  const isAdaptive = mode === "adaptive"
  const winner = decisionData[0]
  const others = decisionData.slice(1)

  // Estimate time saved vs legacy (vehicles × 3s for the winner lane)
  const legacyGreenTime = Math.min(60, Math.max(10, winner.vehicle_count * 3))
  const adaptiveGreenTime = winner.green_time
  const timeDiff = adaptiveGreenTime - legacyGreenTime

  // Build a human-readable reason sentence
  function buildReason(): string {
    if (!isAdaptive) {
      return `Legacy mode assigns green time based purely on vehicle count (${winner.vehicle_count} vehicles × 3 s = ${legacyGreenTime} s). No queue or wait data is considered.`
    }

    const reasons: string[] = []

    if (winner.queue_length > 0) {
      const queueContrib = (winner.queue_length * 2.5).toFixed(1)
      reasons.push(`queue of ${winner.queue_length} vehicles (+${queueContrib} pts)`)
    }
    if (winner.avg_wait_time > 0) {
      const waitContrib = (winner.avg_wait_time * 0.4).toFixed(1)
      reasons.push(`avg wait of ${winner.avg_wait_time.toFixed(0)} s (+${waitContrib} pts)`)
    }
    if (winner.vehicle_count > 0) {
      reasons.push(`${winner.vehicle_count} vehicles detected`)
    }

    const secondBest = others[0]
    const margin = secondBest
      ? ` It scored ${((winner.raw_score ?? 0) - (secondBest.raw_score ?? 0)).toFixed(1)} pts ahead of ${secondBest.lane}.`
      : ""

    const base = reasons.length > 0
      ? `The AI selected ${winner.lane.toUpperCase()} due to its ${reasons.join(" and ")}.`
      : `The AI selected ${winner.lane.toUpperCase()} as the highest-priority lane.`

    return base + margin
  }

  function buildTimeSavedLine(): string | null {
    if (!isAdaptive) return null
    if (timeDiff === 0) return `Green time matches what legacy mode would assign (${adaptiveGreenTime} s).`
    if (timeDiff > 0) {
      return `⏱ +${timeDiff} s longer than legacy — clearing the backlog faster (${legacyGreenTime} s → ${adaptiveGreenTime} s).`
    }
    // timeDiff < 0: adaptive gave less time than legacy would have
    return `⏱ ${Math.abs(timeDiff)} s shorter than legacy — other lanes need service more urgently (${legacyGreenTime} s → ${adaptiveGreenTime} s).`
  }

  const timeSavedLine = buildTimeSavedLine()

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: 0.15 }}
      style={{
        background: "rgba(96,165,250,0.05)",
        border: "1px solid rgba(96,165,250,0.15)",
        borderRadius: 10,
        padding: "10px 14px",
        marginBottom: 14,
      }}
    >
      <div style={{ fontSize: 10, fontWeight: 700, color: "#60a5fa", marginBottom: 4, letterSpacing: "0.05em" }}>
        💬 AI REASONING
      </div>
      <p style={{ fontSize: 12, color: "#94a3b8", lineHeight: 1.65, margin: 0 }}>
        {buildReason()}
      </p>
      {timeSavedLine && (
        <p style={{
          fontSize: 11, color: "#4ade80", lineHeight: 1.5, margin: "6px 0 0",
          fontWeight: 600,
        }}>
          {timeSavedLine}
        </p>
      )}
    </motion.div>
  )
}

// ── Inner content (reused whether embedded or standalone) ─────────────────────

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
      {/* ── Header (only shown when embedded, since standalone wraps its own) ── */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{
            fontSize: 10, fontWeight: 700,
            background: isAdaptive ? "rgba(96,165,250,0.15)" : "rgba(168,85,247,0.15)",
            color: isAdaptive ? "#60a5fa" : "#a78bfa",
            border: `1px solid ${isAdaptive ? "rgba(96,165,250,0.3)" : "rgba(168,85,247,0.3)"}`,
            borderRadius: 6, padding: "2px 7px",
          }}>
            {isAdaptive ? "ADAPTIVE" : "LEGACY"}
          </span>
        </div>
        {isAdaptive && <FormulaTooltip qw={2.5} ww={0.4} />}
      </div>

      {/* ── Winner banner ── */}
      <motion.div
        key={winner.lane}
        initial={{ scale: 0.97, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.35 }}
        style={{
          background: winnerMeta.bg,
          border: `1px solid ${winnerMeta.border}`,
          borderRadius: 12,
          padding: "12px 16px",
          marginBottom: 14,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
        }}
      >
        <div>
          <div style={{ fontSize: 11, color: "#64748b", fontWeight: 600, marginBottom: 2 }}>SELECTED LANE</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: winnerMeta.color }}>
            {winnerMeta.emoji} {winner.lane.toUpperCase()}
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 11, color: "#64748b", fontWeight: 600, marginBottom: 2 }}>GREEN TIME</div>
          <div style={{ fontSize: 28, fontWeight: 800, color: "#4ade80", lineHeight: 1 }}>
            {winner.green_time}<span style={{ fontSize: 14, fontWeight: 500, color: "#64748b" }}>s</span>
          </div>
        </div>
        {isAdaptive && (
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 11, color: "#64748b", fontWeight: 600, marginBottom: 2 }}>TOTAL SCORE</div>
            <div style={{ fontSize: 24, fontWeight: 800, color: winnerMeta.color, lineHeight: 1 }}>
              {winner.raw_score?.toFixed(1) ?? "—"}
            </div>
          </div>
        )}
      </motion.div>

      {/* ── AI Reasoning Summary ── */}
      <ReasoningSummary decisionData={decisionData} mode={mode} />

      {/* ── Per-lane breakdown ── */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {decisionData.map((lane, i) => {
          const meta = LANE_META[lane.lane] ?? LANE_META.north
          const prev = prevMap.current[lane.lane]
          const isWinner = i === 0

          return (
            <motion.div
              key={lane.lane}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.06 }}
              style={{
                background: isWinner ? meta.bg : "rgba(255,255,255,0.02)",
                border: `1px solid ${isWinner ? meta.border : "rgba(255,255,255,0.05)"}`,
                borderRadius: 10,
                padding: "10px 12px",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                <span style={{
                  width: 26, height: 26, borderRadius: 6,
                  background: meta.bg, border: `1px solid ${meta.border}`,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 13, fontWeight: 700, color: meta.color, flexShrink: 0,
                }}>
                  {meta.emoji}
                </span>
                <span style={{ fontWeight: 700, fontSize: 13, color: "#e2e8f0", flex: 1, textTransform: "capitalize" }}>
                  {lane.lane}
                  {isWinner && (
                    <span style={{
                      marginLeft: 6, fontSize: 9, fontWeight: 700,
                      background: meta.color, color: "#0f172a",
                      borderRadius: 4, padding: "1px 5px",
                    }}>SELECTED</span>
                  )}
                </span>
                {isAdaptive && (
                  <span style={{ fontSize: 12, fontWeight: 700, color: meta.color }}>
                    {lane.raw_score?.toFixed(1) ?? "—"}
                    <span style={{ color: "#64748b", fontWeight: 400 }}> pts</span>
                  </span>
                )}
                <span style={{ fontSize: 12, fontWeight: 700, color: isWinner ? "#4ade80" : "#94a3b8" }}>
                  {lane.green_time}s
                  <Delta prev={prev?.green_time} curr={lane.green_time} unit="s" />
                </span>
              </div>

              {isAdaptive && (
                <div style={{ marginBottom: 8 }}>
                  <ScoreBar score={lane.raw_score ?? lane.green_time} max={maxScore} color={meta.color} />
                </div>
              )}

              {isAdaptive && (
                <div style={{ display: "flex", gap: 16 }}>
                  {[
                    { label: "QUEUE", val: lane.queue_length, prev: prev?.queue_length },
                    { label: "AVG WAIT", val: lane.avg_wait_time, prev: prev?.avg_wait_time, unit: "s" },
                    { label: "VEHICLES", val: lane.vehicle_count, prev: prev?.vehicle_count },
                    { label: "SCORE", val: lane.raw_score, color: meta.color },
                  ].map(({ label, val, prev: p, unit, color }) => (
                    <div key={label}>
                      <div style={{ fontSize: 9, color: "#475569", fontWeight: 600 }}>{label}</div>
                      <div style={{ fontSize: 12, fontWeight: 700, color: color ?? "#94a3b8" }}>
                        {typeof val === "number" ? (label === "SCORE" ? val?.toFixed(1) ?? "—" : val) : "—"}
                        {p !== undefined && <Delta prev={p} curr={val as number} unit={unit} />}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {!isAdaptive && (
                <div>
                  <div style={{ fontSize: 9, color: "#475569", fontWeight: 600 }}>VEHICLES</div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "#94a3b8" }}>
                    {lane.vehicle_count}
                    <Delta prev={prevMap.current[lane.lane]?.vehicle_count} curr={lane.vehicle_count} />
                  </div>
                </div>
              )}
            </motion.div>
          )
        })}
      </div>

      {/* ── Footer ── */}
      <div style={{
        marginTop: 12, paddingTop: 10,
        borderTop: "1px solid rgba(255,255,255,0.06)",
        fontSize: 10, color: "#475569", lineHeight: 1.6,
      }}>
        {isAdaptive
          ? <>Lane with highest priority score gets the longest green time. Score = <code style={{ color: "#64748b" }}>8 + queue×2.5 + wait×0.4</code>, clamped to [10s, 60s].</>
          : <>Green time = <code style={{ color: "#64748b" }}>vehicles × 3s</code>, clamped to [10s, 60s]. Switch to Adaptive mode for queue + wait-based reasoning.</>
        }
      </div>
    </>
  )
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function AIDecisionPanel({ decisionData, mode, prevData, embedded = false }: Props) {
  const prevMap = useRef<Record<string, DecisionLane>>({})

  useEffect(() => {
    if (prevData) {
      const m: Record<string, DecisionLane> = {}
      for (const d of prevData) m[d.lane] = d
      prevMap.current = m
    }
  }, [prevData])

  if (!decisionData || decisionData.length === 0) return null

  // When embedded, render just the content with padding — no outer card shell
  if (embedded) {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.3 }}
        style={{ padding: "14px 16px" }}
      >
        <PanelContent decisionData={decisionData} mode={mode} prevMap={prevMap} />
      </motion.div>
    )
  }

  // Standalone: render with its own card shell
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, ease: "easeOut" }}
      style={{
        background: "rgba(15,23,42,0.85)",
        border: "1px solid rgba(255,255,255,0.08)",
        borderRadius: 16,
        padding: "18px 20px",
        backdropFilter: "blur(12px)",
      }}
    >
      {/* Standalone header includes the 🧠 title */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 18 }}>🧠</span>
          <span style={{ fontWeight: 700, fontSize: 14, color: "#e2e8f0" }}>AI Decision Reasoning</span>
          <span style={{
            fontSize: 10, fontWeight: 700,
            background: mode === "adaptive" ? "rgba(96,165,250,0.15)" : "rgba(168,85,247,0.15)",
            color: mode === "adaptive" ? "#60a5fa" : "#a78bfa",
            border: `1px solid ${mode === "adaptive" ? "rgba(96,165,250,0.3)" : "rgba(168,85,247,0.3)"}`,
            borderRadius: 6, padding: "2px 7px",
          }}>
            {mode === "adaptive" ? "ADAPTIVE" : "LEGACY"}
          </span>
        </div>
        {mode === "adaptive" && <FormulaTooltip qw={2.5} ww={0.4} />}
      </div>
      <PanelContent decisionData={decisionData} mode={mode} prevMap={prevMap} />
    </motion.div>
  )
}