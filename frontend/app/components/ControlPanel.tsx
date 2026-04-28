"use client"
import { useState, useEffect, useRef } from "react"
import axios from "axios"
import EmergencyToggle from "./EmergencyToggle"

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

    // 🔥 BUILD AI DECISION DATA (THIS WAS MISSING)
    const decisionData: DecisionLane[] = cycle.map((lane) => ({
      lane: lane.lane,
      green_time: lane.green_time,
      vehicle_count: lane.vehicle_count,
      queue_length: lanes[lane.lane].queue_length,
      avg_wait_time: lanes[lane.lane].avg_wait_time,
      raw_score:
        mode === "adaptive"
          ? 8 +
          lanes[lane.lane].queue_length * queueWeight +
          lanes[lane.lane].avg_wait_time * waitWeight
          : lane.vehicle_count * 3,
      mode: mode,
    }))

    // 🔥 SORT (IMPORTANT for winner display)
    decisionData.sort((a, b) => b.raw_score - a.raw_score)

    // 🔥 SEND TO UI
    onDecisionData?.(decisionData, mode)
  }

  return (
    <div className="glass rounded-xl p-4 flex flex-col gap-4">

      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-base font-bold text-emerald-400">Traffic Controller</h2>
      </div>

      {/* Mode Toggle */}
      <div className="flex rounded-lg overflow-hidden border border-slate-700 text-sm">
        {(["adaptive", "legacy"] as const).map(m => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={`flex-1 py-1.5 capitalize font-medium transition-colors ${mode === m ? "bg-blue-600 text-white" : "bg-slate-800 text-slate-400 hover:text-slate-200"
              }`}
          >
            {m}
          </button>
        ))}
      </div>

      {/* Adaptive Sliders */}
      {mode === "adaptive" && (
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <label>Queue Weight</label>
            <span className="font-mono text-blue-400">{queueWeight.toFixed(1)}</span>
          </div>
          <input
            type="range" min={0} max={10} step={0.1}
            value={queueWeight}
            onChange={e => setQueueWeight(parseFloat(e.target.value))}
            className="w-full accent-blue-500 h-1"
          />
          <div className="flex items-center justify-between text-xs text-slate-400 mt-2">
            <label>Wait Weight</label>
            <span className="font-mono text-blue-400">{waitWeight.toFixed(2)}</span>
          </div>
          <input
            type="range" min={0} max={5} step={0.05}
            value={waitWeight}
            onChange={e => setWaitWeight(parseFloat(e.target.value))}
            className="w-full accent-blue-500 h-1"
          />
        </div>
      )}

      {/* Lane Inputs — compact grid */}
      <div className="space-y-2">
        {/* Column headers */}
        <div
          className="grid text-xs font-semibold text-slate-500 uppercase tracking-wide px-1"
          style={{ gridTemplateColumns: mode === "adaptive" ? "80px 1fr 1fr 1fr" : "80px 1fr" }}
        >
          <span>Lane</span>
          <span className="text-center">Vehicles</span>
          {mode === "adaptive" && <span className="text-center">Queue</span>}
          {mode === "adaptive" && <span className="text-center">Avg Wait</span>}
        </div>

        {LANES.map(lane => (
          <div
            key={lane}
            className="grid items-center gap-1.5 px-1"
            style={{ gridTemplateColumns: mode === "adaptive" ? "80px 1fr 1fr 1fr" : "80px 1fr" }}
          >
            {/* Lane label */}
            <div className="flex items-center gap-1.5">
              <span
                className="w-5 h-5 rounded flex items-center justify-center text-xs font-bold flex-shrink-0"
                style={{ background: `${LANE_COLORS[lane]}20`, color: LANE_COLORS[lane], border: `1px solid ${LANE_COLORS[lane]}40` }}
              >
                {LANE_ICONS[lane]}
              </span>
              <span className="text-xs text-slate-300 capitalize">{lane}</span>
            </div>

            {/* Vehicles */}
            <input
              type="number"
              value={lanes[lane].vehicle_count}
              onChange={e => setLaneField(lane, "vehicle_count", e.target.value)}
              title="Vehicle count"
              className="w-full px-2 py-1 bg-slate-800 border border-slate-700 rounded text-white text-xs text-center focus:border-blue-500 focus:outline-none"
            />

            {/* Queue (adaptive only) */}
            {mode === "adaptive" && (
              <input
                type="number"
                value={lanes[lane].queue_length}
                onChange={e => setLaneField(lane, "queue_length", e.target.value)}
                title="Queue length"
                className="w-full px-2 py-1 bg-slate-800 border border-slate-700 rounded text-white text-xs text-center focus:border-blue-500 focus:outline-none"
              />
            )}

            {/* Avg Wait (adaptive only) */}
            {mode === "adaptive" && (
              <input
                type="number"
                value={lanes[lane].avg_wait_time}
                onChange={e => setLaneField(lane, "avg_wait_time", e.target.value)}
                title="Avg wait time (s)"
                className="w-full px-2 py-1 bg-slate-800 border border-slate-700 rounded text-white text-xs text-center focus:border-blue-500 focus:outline-none"
              />
            )}
          </div>
        ))}

        {/* Sub-labels under columns for clarity */}
        {mode === "adaptive" && (
          <div
            className="grid text-xs text-slate-600 px-1"
            style={{ gridTemplateColumns: "80px 1fr 1fr 1fr" }}
          >
            <span />
            <span className="text-center"># cars</span>
            <span className="text-center"># cars</span>
            <span className="text-center">seconds</span>
          </div>
        )}
      </div>

      {error && <p className="text-red-400 text-xs">{error}</p>}

      {/* Run Button */}
      <button
        onClick={handleSimulate}
        disabled={loading}
        className="bg-emerald-500 hover:bg-emerald-400 active:bg-emerald-600 text-white py-2.5 rounded-lg font-semibold text-sm transition-colors disabled:opacity-50"
      >
        {loading ? "Running…" : "▶ Run Simulation"}
      </button>
    </div>
  )
}