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

interface Props {
  onSimulationRun: (cycle: Phase[]) => void
  onEmergencyChange?: (active: boolean, lane: string | null) => void
}

const LANES: Lane[] = ["north", "south", "east", "west"]

// Per-lane state the user can enter
interface LaneInput {
  vehicle_count: number
  queue_length: number
  avg_wait_time: number
}

const DEFAULT_LANE: LaneInput = { vehicle_count: 0, queue_length: 0, avg_wait_time: 0 }

const INITIAL_LANES: Record<Lane, LaneInput> = {
  north: { vehicle_count: 8, queue_length: 6, avg_wait_time: 12 },
  south: { vehicle_count: 5, queue_length: 3, avg_wait_time: 7 },
  east: { vehicle_count: 12, queue_length: 10, avg_wait_time: 20 },
  west: { vehicle_count: 3, queue_length: 2, avg_wait_time: 4 },
}

// ── Client-side adaptive formula (mirrors traffic_logic.py) ──────────────────
function buildAdaptiveCycle(
  lanes: Record<Lane, LaneInput>,
  queueWeight: number,
  waitWeight: number,
): Phase[] {
  const BASE = 8, MIN = 10, MAX = 60
  return (Object.entries(lanes) as [Lane, LaneInput][])
    .map(([lane, s]) => {
      const raw = BASE + s.queue_length * queueWeight + s.avg_wait_time * waitWeight
      return {
        lane,
        green_time: Math.max(MIN, Math.min(MAX, Math.round(raw))),
        vehicle_count: s.vehicle_count,
      }
    })
    // NOTE: do NOT filter zero-count lanes here — the backend always returns
    // all 4 directions (each gets at least MIN_GREEN). Filtering here would
    // cause a mismatch when the client falls back to offline mode.
    .sort((a, b) => b.green_time - a.green_time)
}

// ── Client-side legacy formula (fallback) ────────────────────────────────────
function buildLegacyCycle(lanes: Record<Lane, LaneInput>): Phase[] {
  const MIN = 10, MAX = 60, SPV = 3
  return (Object.entries(lanes) as [Lane, LaneInput][])
    .map(([lane, s]) => ({
      lane,
      green_time: Math.max(MIN, Math.min(MAX, s.vehicle_count * SPV)),
      vehicle_count: s.vehicle_count,
    }))
    // Same as above — keep all lanes so offline output matches backend shape.
    .sort((a, b) => b.vehicle_count - a.vehicle_count)
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function ControlPanel({ onSimulationRun, onEmergencyChange }: Props) {
  const [lanes, setLanes] = useState<Record<Lane, LaneInput>>(INITIAL_LANES)
  const [mode, setMode] = useState<"adaptive" | "legacy">("adaptive")
  const [queueWeight, setQueueWeight] = useState(2.5)
  const [waitWeight, setWaitWeight] = useState(0.4)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastMode, setLastMode] = useState<string>("—")

  // Emergency state (tracked here so Cancel button can appear)
  const [emergencyActive, setEmergencyActive] = useState(false)
  const [emergencyLane, setEmergencyLane] = useState<string | null>(null)
  const [emergencySeconds, setEmergencySeconds] = useState(0)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // ── WebSocket listener for emergency events ───────────────────────────────
  useEffect(() => {
    let ws: WebSocket
    const connect = () => {
      ws = new WebSocket("ws://localhost:8000/ws")
      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data)
          if (msg.type === "EMERGENCY_OVERRIDE") {
            setEmergencyActive(true)
            setEmergencyLane(msg.lane)
            setEmergencySeconds(msg.duration ?? 30)
            onEmergencyChange?.(true, msg.lane)
            // start countdown
            if (timerRef.current) clearInterval(timerRef.current)
            timerRef.current = setInterval(() => {
              setEmergencySeconds(s => {
                if (s <= 1) {
                  clearInterval(timerRef.current!)
                  return 0
                }
                return s - 1
              })
            }, 1000)
          }
          if (msg.type === "EMERGENCY_CLEARED") {
            setEmergencyActive(false)
            setEmergencyLane(null)
            setEmergencySeconds(0)
            if (timerRef.current) clearInterval(timerRef.current)
            onEmergencyChange?.(false, null)
          }
        } catch { }
      }
      ws.onclose = () => setTimeout(connect, 2000)
    }
    connect()
    return () => { ws?.close(); if (timerRef.current) clearInterval(timerRef.current) }
  }, [])

  // ── Input handlers ────────────────────────────────────────────────────────

  const setLaneField = (lane: Lane, field: keyof LaneInput, raw: string) => {
    const maxes: Record<keyof LaneInput, number> = {
      vehicle_count: 50, queue_length: 50, avg_wait_time: 300,
    }
    const val = Math.max(0, Math.min(maxes[field], parseFloat(raw) || 0))
    setLanes(prev => ({ ...prev, [lane]: { ...prev[lane], [field]: val } }))
  }

  // ── Simulate ──────────────────────────────────────────────────────────────

  const handleSimulate = async () => {
    setLoading(true)
    setError(null)

    const endpoint = mode === "adaptive" ? "/simulate/adaptive" : "/simulate"

    // Build payload: adaptive sends full LaneInput, legacy sends flat counts
    const payload = mode === "adaptive"
      ? {
        north: lanes.north,
        south: lanes.south,
        east: lanes.east,
        west: lanes.west,
        queue_weight: queueWeight,
        wait_weight: waitWeight,
      }
      : {
        north: lanes.north.vehicle_count,
        south: lanes.south.vehicle_count,
        east: lanes.east.vehicle_count,
        west: lanes.west.vehicle_count,
      }

    try {
      const res = await axios.post(`http://localhost:8000${endpoint}`, payload)

      if (res.data?.cycle && Array.isArray(res.data.cycle)) {
        const cycle: Phase[] = res.data.cycle.map((ph: any) => ({
          lane: ph.lane,
          green_time: ph.green_time,
          vehicle_count: ph.vehicle_count > 0
            ? ph.vehicle_count
            : lanes[ph.lane as Lane]?.vehicle_count ?? 0,
        }))
        const active = cycle.filter(ph => ph.vehicle_count > 0)
        if (active.length === 0) {
          setError("No vehicles to simulate. Enter at least 1 vehicle.")
          return
        }
        setLastMode(mode)
        onSimulationRun(active)
      }
    } catch (err) {
      console.warn("Backend unavailable — running client-side fallback")
      const cycle = mode === "adaptive"
        ? buildAdaptiveCycle(lanes, queueWeight, waitWeight)
        : buildLegacyCycle(lanes)

      if (cycle.length === 0) {
        setError("No vehicles to simulate. Enter at least 1 vehicle.")
        return
      }
      setLastMode(`${mode} (offline)`)
      onSimulationRun(cycle)
    } finally {
      setLoading(false)
    }
  }

  // ── Cancel emergency ──────────────────────────────────────────────────────

  const handleCancelEmergency = async () => {
    try {
      await axios.post("http://localhost:8000/emergency/clear")
      // WebSocket EMERGENCY_CLEARED event will update state
    } catch {
      // backend unreachable — clear locally
      setEmergencyActive(false)
      setEmergencyLane(null)
      setEmergencySeconds(0)
      if (timerRef.current) clearInterval(timerRef.current)
      onEmergencyChange?.(false, null)
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="glass rounded-xl p-6 flex flex-col gap-6">

      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-emerald-400">Traffic Controller</h2>
        {lastMode !== "—" && (
          <span className="text-xs text-slate-500 bg-slate-800 px-2 py-1 rounded">
            last: {lastMode}
          </span>
        )}
      </div>

      {/* ── Mode toggle ── */}
      <div className="flex rounded-lg overflow-hidden border border-slate-700 text-sm font-semibold">
        {(["adaptive", "legacy"] as const).map(m => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={`flex-1 py-2 transition-colors capitalize ${mode === m
              ? "bg-blue-600 text-white"
              : "bg-slate-900 text-slate-400 hover:bg-slate-800"
              }`}
          >
            {m === "adaptive" ? "⚡ Adaptive" : "📊 Legacy"}
          </button>
        ))}
      </div>

      {/* ── Adaptive weight sliders ── */}
      {mode === "adaptive" && (
        <div className="bg-slate-900/60 rounded-xl p-4 flex flex-col gap-3">
          <p className="text-xs text-slate-400 uppercase tracking-wider mb-1">Signal weights</p>

          <div className="flex flex-col gap-1">
            <div className="flex justify-between text-xs text-slate-400">
              <span>Queue weight</span>
              <span className="text-blue-400 font-mono">{queueWeight.toFixed(1)} s/vehicle</span>
            </div>
            <input
              type="range" min={0} max={10} step={0.1}
              value={queueWeight}
              onChange={e => setQueueWeight(parseFloat(e.target.value))}
              className="w-full accent-blue-500"
            />
            <p className="text-xs text-slate-600">
              Extra green time per queued vehicle
            </p>
          </div>

          <div className="flex flex-col gap-1">
            <div className="flex justify-between text-xs text-slate-400">
              <span>Wait weight</span>
              <span className="text-purple-400 font-mono">{waitWeight.toFixed(2)} s/s</span>
            </div>
            <input
              type="range" min={0} max={5} step={0.05}
              value={waitWeight}
              onChange={e => setWaitWeight(parseFloat(e.target.value))}
              className="w-full accent-purple-500"
            />
            <p className="text-xs text-slate-600">
              Extra green time per second of avg wait
            </p>
          </div>
        </div>
      )}

      {/* ── Lane inputs ── */}
      <div className="flex flex-col gap-3">
        {LANES.map(lane => (
          <div key={lane} className="bg-slate-900/60 rounded-xl p-3">
            <p className="text-sm font-semibold capitalize text-slate-300 mb-2">
              {lane} lane
            </p>
            <div className={`grid gap-2 ${mode === "adaptive" ? "grid-cols-3" : "grid-cols-1"}`}>

              {/* Vehicle count — always shown */}
              <div className="flex flex-col gap-1">
                <label className="text-xs text-slate-500">Vehicles</label>
                <input
                  type="number"
                  value={lanes[lane].vehicle_count}
                  min={0} max={50}
                  onChange={e => setLaneField(lane, "vehicle_count", e.target.value)}
                  className="px-2 py-1.5 bg-slate-800 border border-slate-700 rounded text-slate-100 text-sm focus:outline-none focus:border-blue-500 transition-colors"
                />
              </div>

              {/* Queue + wait — adaptive mode only */}
              {mode === "adaptive" && (
                <>
                  <div className="flex flex-col gap-1">
                    <label className="text-xs text-slate-500">Queue</label>
                    <input
                      type="number"
                      value={lanes[lane].queue_length}
                      min={0} max={50}
                      onChange={e => setLaneField(lane, "queue_length", e.target.value)}
                      className="px-2 py-1.5 bg-slate-800 border border-slate-700 rounded text-slate-100 text-sm focus:outline-none focus:border-blue-500 transition-colors"
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-xs text-slate-500">Avg wait (s)</label>
                    <input
                      type="number"
                      value={lanes[lane].avg_wait_time}
                      min={0} max={300}
                      onChange={e => setLaneField(lane, "avg_wait_time", e.target.value)}
                      className="px-2 py-1.5 bg-slate-800 border border-slate-700 rounded text-slate-100 text-sm focus:outline-none focus:border-blue-500 transition-colors"
                    />
                  </div>
                </>
              )}

            </div>

            {/* Adaptive green time preview */}
            {mode === "adaptive" && lanes[lane].vehicle_count > 0 && (
              <div className="mt-2 flex items-center gap-2">
                <div className="flex-1 bg-slate-800 rounded-full h-1.5">
                  <div
                    className="h-full bg-blue-500 rounded-full transition-all duration-300"
                    style={{
                      width: `${Math.min(100, ((
                        8 +
                        lanes[lane].queue_length * queueWeight +
                        lanes[lane].avg_wait_time * waitWeight
                      ) / 60) * 100)}%`
                    }}
                  />
                </div>
                <span className="text-xs text-blue-400 font-mono w-10 text-right">
                  {Math.max(10, Math.min(60, Math.round(
                    8 +
                    lanes[lane].queue_length * queueWeight +
                    lanes[lane].avg_wait_time * waitWeight
                  )))}s
                </span>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* ── Error ── */}
      {error && <p className="text-red-400 text-sm">{error}</p>}

      {/* ── Run button ── */}
      <button
        onClick={handleSimulate}
        disabled={loading}
        className="w-full py-3 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-lg font-bold shadow-lg shadow-blue-500/30 transition-all"
      >
        {loading ? "Calculating…" : mode === "adaptive" ? "⚡ Run Adaptive" : "Run Simulation"}
      </button>

    </div>
  )
}