"use client"
import { useState, useEffect, useRef } from "react"

type Lane = "north" | "south" | "east" | "west"

interface Phase {
  lane: Lane
  green_time: number
  vehicle_count: number
}

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
  onSimulationRun: (cycle: Phase[]) => void
  onEmergencyChange?: (active: boolean, lane: string | null) => void
  onDecisionData?: (data: DecisionLane[], mode: string) => void
}

const LANES: Lane[] = ["north", "south", "east", "west"]

const LANE_ICONS: Record<Lane, string> = {
  north: "↑",
  south: "↓",
  east: "→",
  west: "←",
}

const LANE_COLORS: Record<Lane, string> = {
  north: "#34d399",
  south: "#60a5fa",
  east: "#f59e0b",
  west: "#a78bfa",
}

interface LaneInput {
  vehicle_count: number
  queue_length: number
  avg_wait_time: number
}

const INITIAL_LANES: Record<Lane, LaneInput> = {
  north: { vehicle_count: 8, queue_length: 6, avg_wait_time: 12 },
  south: { vehicle_count: 5, queue_length: 3, avg_wait_time: 7 },
  east: { vehicle_count: 12, queue_length: 10, avg_wait_time: 20 },
  west: { vehicle_count: 3, queue_length: 2, avg_wait_time: 4 },
}

function buildAdaptiveCycle(lanes: Record<Lane, LaneInput>, queueWeight: number, waitWeight: number): Phase[] {
  const BASE = 8, MIN = 10, MAX = 60
  return (Object.entries(lanes) as [Lane, LaneInput][])
    .map(([lane, s]) => ({
      lane,
      green_time: Math.max(MIN, Math.min(MAX, Math.round(
        BASE + s.queue_length * queueWeight + s.avg_wait_time * waitWeight
      ))),
      vehicle_count: s.vehicle_count,
    }))
    .sort((a, b) => b.green_time - a.green_time)
}

function buildLegacyCycle(lanes: Record<Lane, LaneInput>): Phase[] {
  const MIN = 10, MAX = 60, SPV = 3
  return (Object.entries(lanes) as [Lane, LaneInput][])
    .map(([lane, s]) => ({
      lane,
      green_time: Math.max(MIN, Math.min(MAX, s.vehicle_count * SPV)),
      vehicle_count: s.vehicle_count,
    }))
    .sort((a, b) => b.vehicle_count - a.vehicle_count)
}

export default function ControlPanel({ onSimulationRun, onEmergencyChange, onDecisionData }: Props) {
  const [lanes, setLanes] = useState<Record<Lane, LaneInput>>(INITIAL_LANES)
  const [mode, setMode] = useState<"adaptive" | "legacy">("adaptive")
  const [queueWeight, setQueueWeight] = useState(2.5)
  const [waitWeight, setWaitWeight] = useState(0.4)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    let ws: WebSocket | null = null
    const connect = () => {
      ws = new WebSocket("ws://localhost:8000/ws")
      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data)
          if (msg.type === "EMERGENCY_OVERRIDE") onEmergencyChange?.(true, msg.lane)
          if (msg.type === "EMERGENCY_CLEARED") onEmergencyChange?.(false, null)
        } catch { }
      }
      ws.onclose = () => setTimeout(connect, 2000)
    }
    connect()
    return () => { ws?.close(); if (timerRef.current) clearInterval(timerRef.current) }
  }, [])

  const setLaneField = (lane: Lane, field: keyof LaneInput, raw: string) => {
    const maxes = { vehicle_count: 50, queue_length: 50, avg_wait_time: 300 }
    const parsed = Number(raw)
    const val = Math.max(0, Math.min(maxes[field], isNaN(parsed) ? 0 : parsed))
    setLanes(prev => ({ ...prev, [lane]: { ...prev[lane], [field]: val } }))
  }

  const handleSimulate = () => {
    const cycle = mode === "adaptive"
      ? buildAdaptiveCycle(lanes, queueWeight, waitWeight)
      : buildLegacyCycle(lanes)

    onSimulationRun(cycle)

    const decisionData: DecisionLane[] = cycle.map((phase) => ({
      lane: phase.lane,
      green_time: phase.green_time,
      vehicle_count: phase.vehicle_count,
      queue_length: lanes[phase.lane].queue_length,
      avg_wait_time: lanes[phase.lane].avg_wait_time,
      raw_score:
        mode === "adaptive"
          ? 8 + lanes[phase.lane].queue_length * queueWeight + lanes[phase.lane].avg_wait_time * waitWeight
          : phase.vehicle_count * 3,
      mode,
    }))

    decisionData.sort((a, b) => b.raw_score - a.raw_score)
    onDecisionData?.(decisionData, mode)
  }

  return (
    <div style={S.wrap}>

      {/* Header */}
      <div style={S.header}>
        <span style={S.headerIcon}>⚙️</span>
        <span style={S.headerTitle}>Traffic Controller</span>
      </div>

      <div style={S.inner}>

        {/* Mode Toggle */}
        <div style={S.section}>
          <div style={S.sectionLabel}>Algorithm Mode</div>
          <div style={S.modeToggle}>
            {(["adaptive", "legacy"] as const).map(m => (
              <button
                key={m}
                onClick={() => setMode(m)}
                style={{
                  ...S.modeBtn,
                  ...(mode === m ? S.modeBtnActive : S.modeBtnIdle),
                }}
              >
                {m === "adaptive" ? "🧠 Adaptive" : "⏱ Legacy"}
              </button>
            ))}
          </div>
        </div>

        {/* Adaptive Sliders */}
        {mode === "adaptive" && (
          <div style={S.section}>
            <div style={S.sectionLabel}>Weights</div>
            <div style={S.sliders}>
              {[
                { label: "Queue", value: queueWeight, min: 0, max: 10, step: 0.1, set: setQueueWeight, decimals: 1 },
                { label: "Wait", value: waitWeight, min: 0, max: 5, step: 0.05, set: setWaitWeight, decimals: 2 },
              ].map(({ label, value, min, max, step, set, decimals }) => (
                <div key={label} style={S.sliderRow}>
                  <span style={S.sliderLabel}>{label}</span>
                  <input
                    type="range" min={min} max={max} step={step}
                    value={value}
                    onChange={e => set(parseFloat(e.target.value))}
                    style={S.sliderInput}
                  />
                  <span style={S.sliderVal}>{value.toFixed(decimals)}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Lane Table */}
        <div style={S.section}>
          <div style={S.sectionLabel}>Lane Configuration</div>

          {/* Column headers */}
          <div style={{ ...S.tableRow, ...S.tableHead }}>
            <div style={S.colLane}>Lane</div>
            <div style={S.colNum}>Veh</div>
            {mode === "adaptive" && <div style={S.colNum}>Queue</div>}
            {mode === "adaptive" && <div style={S.colNum}>Wait</div>}
          </div>

          {/* Lane rows */}
          <div style={S.laneRows}>
            {LANES.map(lane => (
              <div key={lane} style={S.tableRow}>

                {/* Lane label */}
                <div style={S.colLane}>
                  <div style={{
                    ...S.laneIcon,
                    background: `${LANE_COLORS[lane]}18`,
                    color: LANE_COLORS[lane],
                    borderColor: `${LANE_COLORS[lane]}35`,
                  }}>
                    {LANE_ICONS[lane]}
                  </div>
                  <span style={S.laneName}>{lane}</span>
                </div>

                <div style={S.colNum}>
                  <input
                    type="number"
                    value={lanes[lane].vehicle_count}
                    onChange={e => setLaneField(lane, "vehicle_count", e.target.value)}
                    style={{ ...S.numInput, borderColor: `${LANE_COLORS[lane]}30` }}
                  />
                </div>

                {mode === "adaptive" && (
                  <div style={S.colNum}>
                    <input
                      type="number"
                      value={lanes[lane].queue_length}
                      onChange={e => setLaneField(lane, "queue_length", e.target.value)}
                      style={{ ...S.numInput, borderColor: `${LANE_COLORS[lane]}30` }}
                    />
                  </div>
                )}

                {mode === "adaptive" && (
                  <div style={S.colNum}>
                    <input
                      type="number"
                      value={lanes[lane].avg_wait_time}
                      onChange={e => setLaneField(lane, "avg_wait_time", e.target.value)}
                      style={{ ...S.numInput, borderColor: `${LANE_COLORS[lane]}30` }}
                    />
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Sublabels */}
          {mode === "adaptive" && (
            <div style={{ ...S.tableRow, ...S.tableSubLabel }}>
              <div style={S.colLane} />
              <div style={S.colNum}># cars</div>
              <div style={S.colNum}># cars</div>
              <div style={S.colNum}>secs</div>
            </div>
          )}
        </div>

        {error && <p style={S.error}>{error}</p>}

        {/* Run Button */}
        <button onClick={handleSimulate} disabled={loading} style={S.runBtn}>
          {loading ? "Running…" : "▶  Run Simulation"}
        </button>

      </div>
    </div>
  )
}

const S: Record<string, React.CSSProperties> = {
  wrap: {
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
  },
  header: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "11px 14px 10px",
    borderBottom: "1px solid rgba(255,255,255,0.06)",
  },
  headerIcon: { fontSize: 13 },
  headerTitle: { fontSize: 12, fontWeight: 700, color: "#10b981", letterSpacing: "0.01em" },

  inner: {
    display: "flex",
    flexDirection: "column",
    gap: 16,
    padding: "14px",
  },

  section: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
  },
  sectionLabel: {
    fontSize: 9,
    fontWeight: 700,
    letterSpacing: "0.1em",
    color: "#374151",
    textTransform: "uppercase" as const,
    paddingBottom: 2,
  },

  /* Mode toggle */
  modeToggle: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: 6,
  },
  modeBtn: {
    padding: "7px 0",
    borderRadius: 8,
    fontSize: 11,
    fontWeight: 600,
    border: "1px solid transparent",
    cursor: "pointer",
    transition: "all 0.15s",
    letterSpacing: "0.01em",
  },
  modeBtnActive: {
    background: "#1d4ed8",
    color: "#fff",
    borderColor: "#1d4ed8",
  },
  modeBtnIdle: {
    background: "rgba(255,255,255,0.03)",
    color: "#475569",
    borderColor: "rgba(255,255,255,0.07)",
  },

  /* Sliders */
  sliders: { display: "flex", flexDirection: "column", gap: 8 },
  sliderRow: {
    display: "grid",
    gridTemplateColumns: "48px 1fr 36px",
    alignItems: "center",
    gap: 8,
  },
  sliderLabel: { fontSize: 11, color: "#64748b", fontWeight: 500 },
  sliderInput: { accentColor: "#3b82f6", height: 2, width: "100%" },
  sliderVal: {
    fontSize: 11,
    fontFamily: "monospace",
    color: "#60a5fa",
    textAlign: "right" as const,
  },

  /* Lane table */
  tableRow: {
    display: "grid",
    gridTemplateColumns: "1fr 52px 52px 52px",
    alignItems: "center",
    gap: 6,
  },
  tableHead: {
    marginBottom: 2,
  },
  tableSubLabel: {
    marginTop: 2,
  },
  colLane: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    fontSize: 9,
    fontWeight: 700,
    color: "#475569",
    letterSpacing: "0.08em",
    textTransform: "uppercase" as const,
    textAlign: "center" as const,
  },
  colNum: {
    fontSize: 9,
    fontWeight: 700,
    color: "#374151",
    letterSpacing: "0.08em",
    textTransform: "uppercase" as const,
    textAlign: "center" as const,
  },

  laneRows: { display: "flex", flexDirection: "column", gap: 5 },

  laneIcon: {
    width: 22,
    height: 22,
    borderRadius: 6,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 11,
    fontWeight: 800,
    border: "1px solid transparent",
    flexShrink: 0,
  },
  laneName: {
    fontSize: 11,
    color: "#94a3b8",
    fontWeight: 500,
    textTransform: "capitalize" as const,
  },

  numInput: {
    width: "100%",
    padding: "5px 4px",
    background: "rgba(255,255,255,0.04)",
    border: "1px solid rgba(255,255,255,0.09)",
    borderRadius: 6,
    color: "#e2e8f0",
    fontSize: 12,
    textAlign: "center" as const,
    outline: "none",
    fontFamily: "monospace",
    boxSizing: "border-box" as const,
  },

  error: { fontSize: 11, color: "#f87171", margin: 0 },

  runBtn: {
    background: "linear-gradient(135deg,#059669,#10b981)",
    color: "#fff",
    border: "none",
    borderRadius: 9,
    padding: "10px 0",
    fontSize: 13,
    fontWeight: 700,
    cursor: "pointer",
    letterSpacing: "0.02em",
    transition: "opacity 0.15s",
    width: "100%",
  },
}