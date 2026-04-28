"use client"

/**
 * YOLODetectionPanel.tsx
 * ──────────────────────
 * Drop-in component that integrates with the Smart Traffic System backend.
 *
 * WHAT IT DOES
 *   • Uploads a camera frame to POST /analyze-image (YOLOv8 inference)
 *   • Displays per-quadrant vehicle counts (North / South / East / West)
 *   • Breaks down each lane by vehicle type: cars / bikes / trucks / buses
 *   • Shows a confidence-weighted "density score" per lane
 *   • Listens to the WebSocket (/ws) for live PHASE_UPDATE / CYCLE_UPDATE events
 *     and merges them into the same UI automatically
 *   • Emits an onData callback so your existing dashboard can consume the data
 *
 * HOW TO INTEGRATE
 *   1. Copy this file into  frontend/app/components/YOLODetectionPanel.tsx
 *   2. Import it anywhere:
 *        import YOLODetectionPanel from '../components/YOLODetectionPanel'
 *   3. Drop the JSX tag into your page / dashboard:
 *        <YOLODetectionPanel
 *          backendUrl="http://localhost:8000"   // optional, defaults to localhost:8000
 *          wsUrl="ws://localhost:8000/ws"        // optional
 *          onData={(lanes) => console.log(lanes)} // optional callback
 *        />
 *   4. The component is self-contained — no extra state or providers needed.
 *
 * PROPS
 *   backendUrl  – REST base URL for the FastAPI backend  (default: http://localhost:8000)
 *   wsUrl       – WebSocket URL                          (default: ws://localhost:8000/ws)
 *   onData      – called every time detection data updates, receives LaneResult[]
 *   className   – extra Tailwind classes on the root div
 */

import { useEffect, useRef, useState, useCallback } from "react"
import axios from "axios"

// ── Types ──────────────────────────────────────────────────────────────────────

export interface VehicleCounts {
  cars: number
  bikes: number
  trucks: number
  buses: number
}

export interface LaneResult extends VehicleCounts {
  lane: "north" | "south" | "east" | "west"
  total: number
  /** Weighted density score: trucks/buses count double */
  densityScore: number
  /** Signal state if available from WebSocket */
  signalState?: "GREEN" | "RED" | "YELLOW"
  greenTime?: number
}

export interface YOLODetectionPanelProps {
  backendUrl?: string
  wsUrl?: string
  onData?: (lanes: LaneResult[]) => void
  className?: string
}

// ── Helpers ────────────────────────────────────────────────────────────────────

const DIRECTIONS = ["north", "south", "east", "west"] as const

function computeLaneResult(
  lane: string,
  counts: VehicleCounts
): LaneResult {
  const total = counts.cars + counts.bikes + counts.trucks + counts.buses
  // Heavier vehicles (trucks/buses) get 2× weight in density
  const densityScore = counts.cars + counts.bikes + counts.trucks * 2 + counts.buses * 2
  return {
    lane: lane as LaneResult["lane"],
    ...counts,
    total,
    densityScore,
  }
}

function parseAnalyzeResponse(data: Record<string, VehicleCounts>): LaneResult[] {
  return DIRECTIONS.map((dir) => {
    const counts = data[dir] ?? { cars: 0, bikes: 0, trucks: 0, buses: 0 }
    return computeLaneResult(dir, counts)
  })
}

function mergeSignalState(
  lanes: LaneResult[],
  wsData: {
    active_lanes?: string[]
    data?: Array<{ lane: string; green_time?: number }>
    green_time?: number
  }
): LaneResult[] {
  const activeSet = new Set((wsData.active_lanes ?? []).map((l) => l.toLowerCase()))

  // Build a map of lane → green_time from the data array (CYCLE_UPDATE style)
  const greenMap: Record<string, number> = {}
  if (Array.isArray(wsData.data)) {
    for (const ph of wsData.data) {
      if (ph.lane) greenMap[ph.lane.toLowerCase()] = ph.green_time ?? 0
    }
  }

  return lanes.map((l) => {
    const isActive = activeSet.has(l.lane)
    return {
      ...l,
      signalState: isActive ? "GREEN" : "RED",
      greenTime: isActive
        ? (wsData.green_time ?? greenMap[l.lane] ?? undefined)
        : greenMap[l.lane],
    }
  })
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function VehicleBar({
  label,
  value,
  max,
  color,
}: {
  label: string
  value: number
  max: number
  color: string
}) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-12 text-slate-400 shrink-0">{label}</span>
      <div className="flex-1 bg-slate-700 rounded-full h-1.5 overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ${color}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="w-4 text-right text-slate-300 font-mono">{value}</span>
    </div>
  )
}

function SignalDot({ state }: { state?: "GREEN" | "RED" | "YELLOW" }) {
  if (!state) return null
  const colors: Record<string, string> = {
    GREEN: "bg-emerald-400",
    RED: "bg-red-500",
    YELLOW: "bg-yellow-400",
  }
  return (
    <span className={`inline-block w-2.5 h-2.5 rounded-full ${colors[state]}`} />
  )
}

function LaneCard({ lane }: { lane: LaneResult }) {
  const maxVehicles = Math.max(lane.cars, lane.bikes, lane.trucks, lane.buses, 1)
  const directionLabel = lane.lane.charAt(0).toUpperCase() + lane.lane.slice(1)

  const directionArrow: Record<string, string> = {
    north: "↑",
    south: "↓",
    east: "→",
    west: "←",
  }

  return (
    <div className="bg-slate-800 border border-slate-700 rounded-xl p-4 flex flex-col gap-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-slate-400 text-lg">{directionArrow[lane.lane]}</span>
          <span className="font-bold text-white text-sm">{directionLabel}</span>
          <SignalDot state={lane.signalState} />
        </div>
        <div className="text-right">
          <div className="text-2xl font-black text-emerald-400">{lane.total}</div>
          <div className="text-xs text-slate-500">vehicles</div>
        </div>
      </div>

      {/* Density bar */}
      <div className="w-full bg-slate-700 rounded-full h-2 overflow-hidden">
        <div
          className="h-full bg-gradient-to-r from-emerald-500 to-blue-500 rounded-full transition-all duration-700"
          style={{ width: `${Math.min(lane.densityScore * 5, 100)}%` }}
        />
      </div>
      <div className="text-xs text-slate-500 -mt-2">
        Density score: {lane.densityScore}
        {lane.greenTime != null && (
          <span className="ml-2 text-emerald-400/80">· {lane.greenTime}s green</span>
        )}
      </div>

      {/* Per-type breakdown */}
      <div className="flex flex-col gap-1.5">
        <VehicleBar label="Cars" value={lane.cars} max={maxVehicles} color="bg-blue-400" />
        <VehicleBar label="Bikes" value={lane.bikes} max={maxVehicles} color="bg-violet-400" />
        <VehicleBar label="Trucks" value={lane.trucks} max={maxVehicles} color="bg-orange-400" />
        <VehicleBar label="Buses" value={lane.buses} max={maxVehicles} color="bg-rose-400" />
      </div>
    </div>
  )
}

// ── Main Component ─────────────────────────────────────────────────────────────

export default function YOLODetectionPanel({
  backendUrl = "http://localhost:8000",
  wsUrl = "ws://localhost:8000/ws",
  onData,
  className = "",
}: YOLODetectionPanelProps) {
  const [lanes, setLanes] = useState<LaneResult[]>([])
  const [analyzing, setAnalyzing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fileName, setFileName] = useState<string | null>(null)
  const [wsConnected, setWsConnected] = useState(false)
  const [emergency, setEmergency] = useState<string | null>(null)

  // Keep a ref to the latest lanes so the WebSocket handler can merge without stale closure
  const lanesRef = useRef<LaneResult[]>([])
  lanesRef.current = lanes

  // ── WebSocket ──────────────────────────────────────────────────────────────
  useEffect(() => {
    let ws: WebSocket
    let destroyed = false
    let retryDelay = 1000

    const connect = () => {
      if (destroyed) return
      ws = new WebSocket(wsUrl)

      ws.onopen = () => {
        setWsConnected(true)
        retryDelay = 1000
      }

      ws.onclose = () => {
        setWsConnected(false)
        if (!destroyed) {
          setTimeout(connect, retryDelay)
          retryDelay = Math.min(retryDelay * 2, 30_000)
        }
      }

      ws.onerror = () => ws.close()

      ws.onmessage = (evt) => {
        try {
          const msg = JSON.parse(evt.data)

          if (msg.type === "EMERGENCY_OVERRIDE") {
            setEmergency(msg.message ?? `Emergency on ${msg.lane}`)
          } else if (msg.type === "EMERGENCY_CLEARED") {
            setEmergency(null)
          }

          // Merge signal states into existing lane cards (if we have detection data)
          if (
            (msg.type === "PHASE_UPDATE" || msg.type === "CYCLE_UPDATE" || msg.type === "EMERGENCY_OVERRIDE") &&
            lanesRef.current.length > 0
          ) {
            setLanes((prev) => {
              const merged = mergeSignalState(prev, msg)
              onData?.(merged)
              return merged
            })
          }
        } catch {
          // ignore malformed messages
        }
      }
    }

    connect()
    return () => {
      destroyed = true
      ws?.close()
    }
  }, [wsUrl, onData])

  // ── Image upload → YOLO inference ─────────────────────────────────────────
  const handleUpload = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      if (!file) return

      setFileName(file.name)
      setError(null)
      setAnalyzing(true)

      const form = new FormData()
      form.append("file", file)

      try {
        const res = await axios.post<Record<string, VehicleCounts>>(
          `${backendUrl}/analyze-image`,
          form
        )
        const parsed = parseAnalyzeResponse(res.data)
        setLanes(parsed)
        lanesRef.current = parsed
        onData?.(parsed)
      } catch (err: any) {
        const msg =
          err?.response?.data?.detail ??
          err?.message ??
          "Failed to contact backend."
        setError(msg)
      } finally {
        setAnalyzing(false)
      }
    },
    [backendUrl, onData]
  )

  // ── Render ─────────────────────────────────────────────────────────────────
  const totalVehicles = lanes.reduce((s, l) => s + l.total, 0)
  const busiestLane = lanes.reduce<LaneResult | null>(
    (best, l) => (!best || l.densityScore > best.densityScore ? l : best),
    null
  )

  return (
    <div className={`flex flex-col gap-6 ${className}`}>
      {/* Header row */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-xl font-bold text-white">YOLO Vehicle Detection</h2>
          <p className="text-xs text-slate-500 mt-0.5">YOLOv8n · quadrant analysis · 4 vehicle types</p>
        </div>
        <div className="flex items-center gap-3 text-xs">
          <span className={`flex items-center gap-1 ${wsConnected ? "text-emerald-400" : "text-slate-500"}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${wsConnected ? "bg-emerald-400" : "bg-slate-600"}`} />
            {wsConnected ? "WS live" : "WS offline"}
          </span>
          {totalVehicles > 0 && (
            <span className="text-slate-400">{totalVehicles} total detected</span>
          )}
        </div>
      </div>

      {/* Emergency banner */}
      {emergency && (
        <div className="px-4 py-2 bg-red-500/20 border border-red-500/50 rounded-lg text-red-400 text-sm font-semibold">
          ⚠️ {emergency}
        </div>
      )}

      {/* Upload zone */}
      <label className="block cursor-pointer border-2 border-dashed border-slate-600 hover:border-emerald-500/60 bg-slate-800/50 rounded-xl px-6 py-5 text-center transition-all">
        <div className="text-slate-300 font-medium text-sm">
          {analyzing ? (
            <span className="text-emerald-400">Analyzing frame with YOLOv8…</span>
          ) : (
            <>
              <span className="text-emerald-400 font-semibold">Upload camera frame</span>
              <span className="text-slate-500"> — JPEG, PNG, BMP</span>
            </>
          )}
        </div>
        {fileName && !analyzing && (
          <p className="text-xs text-slate-500 mt-1">{fileName}</p>
        )}
        <input
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handleUpload}
          disabled={analyzing}
        />
      </label>

      {/* Error */}
      {error && (
        <div className="text-red-400 text-sm bg-red-500/10 border border-red-500/30 rounded-lg px-4 py-2">
          {error}
        </div>
      )}

      {/* Summary strip */}
      {busiestLane && (
        <div className="flex items-center gap-2 text-sm text-slate-400">
          <span className="text-white font-semibold capitalize">{busiestLane.lane}</span>
          lane has highest density
          <span className="text-emerald-400 font-bold">(score: {busiestLane.densityScore})</span>
        </div>
      )}

      {/* Lane cards grid */}
      {lanes.length > 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {lanes.map((l) => (
            <LaneCard key={l.lane} lane={l} />
          ))}
        </div>
      ) : (
        <div className="h-48 flex items-center justify-center border border-dashed border-slate-700 rounded-xl text-slate-600 text-sm">
          Upload an image to see detection output
        </div>
      )}
    </div>
  )
}
