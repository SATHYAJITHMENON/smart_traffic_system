"use client"

/**
 * YOLODetectionPanel.tsx
 * ──────────────────────
 * Shows YOLO detection results including:
 *   • The annotated image with bounding boxes + confidence scores
 *   • Per-quadrant vehicle counts (North / South / East / West)
 *   • A full list of every detected object
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

export interface DetectionBox {
  label: string
  confidence: number
  x1: number
  y1: number
  x2: number
  y2: number
}

export interface LaneResult extends VehicleCounts {
  lane: "north" | "south" | "east" | "west"
  total: number
  densityScore: number
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

function computeLaneResult(lane: string, counts: VehicleCounts): LaneResult {
  const total = counts.cars + counts.bikes + counts.trucks + counts.buses
  const densityScore = counts.cars + counts.bikes + counts.trucks * 2 + counts.buses * 2
  return { lane: lane as LaneResult["lane"], ...counts, total, densityScore }
}

function parseAnalyzeResponse(data: Record<string, VehicleCounts>): LaneResult[] {
  return DIRECTIONS.map((dir) => {
    const counts = data[dir] ?? { cars: 0, bikes: 0, trucks: 0, buses: 0 }
    return computeLaneResult(dir, counts)
  })
}

function mergeSignalState(
  lanes: LaneResult[],
  wsData: { active_lanes?: string[]; data?: Array<{ lane: string; green_time?: number }>; green_time?: number }
): LaneResult[] {
  const activeSet = new Set((wsData.active_lanes ?? []).map((l) => l.toLowerCase()))
  const greenMap: Record<string, number> = {}
  if (Array.isArray(wsData.data)) {
    for (const ph of wsData.data) {
      if (ph.lane) greenMap[ph.lane.toLowerCase()] = ph.green_time ?? 0
    }
  }
  return lanes.map((l) => ({
    ...l,
    signalState: activeSet.has(l.lane) ? "GREEN" : "RED",
    greenTime: activeSet.has(l.lane)
      ? (wsData.green_time ?? greenMap[l.lane] ?? undefined)
      : greenMap[l.lane],
  }))
}

// ── Colour map ─────────────────────────────────────────────────────────────────

const LABEL_COLORS: Record<string, string> = {
  car: "bg-amber-400 text-black",
  bike: "bg-violet-400 text-white",
  bus: "bg-cyan-400 text-black",
  truck: "bg-emerald-400 text-black",
}

const LABEL_BORDER: Record<string, string> = {
  car: "border-amber-400",
  bike: "border-violet-400",
  bus: "border-cyan-400",
  truck: "border-emerald-400",
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function VehicleBar({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-12 text-slate-400 shrink-0">{label}</span>
      <div className="flex-1 bg-slate-700 rounded-full h-1.5 overflow-hidden">
        <div className={`h-full rounded-full transition-all duration-500 ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="w-4 text-right text-slate-300 font-mono">{value}</span>
    </div>
  )
}

function SignalDot({ state }: { state?: "GREEN" | "RED" | "YELLOW" }) {
  if (!state) return null
  const colors: Record<string, string> = { GREEN: "bg-emerald-400", RED: "bg-red-500", YELLOW: "bg-yellow-400" }
  return <span className={`inline-block w-2.5 h-2.5 rounded-full ${colors[state]}`} />
}

function LaneCard({ lane }: { lane: LaneResult }) {
  const maxVehicles = Math.max(lane.cars, lane.bikes, lane.trucks, lane.buses, 1)
  const arrow: Record<string, string> = { north: "↑", south: "↓", east: "→", west: "←" }
  return (
    <div className="bg-slate-800 border border-slate-700 rounded-xl p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-slate-400 text-lg">{arrow[lane.lane]}</span>
          <span className="font-bold text-white text-sm capitalize">{lane.lane}</span>
          <SignalDot state={lane.signalState} />
        </div>
        <div className="text-right">
          <div className="text-2xl font-black text-emerald-400">{lane.total}</div>
          <div className="text-xs text-slate-500">vehicles</div>
        </div>
      </div>
      <div className="w-full bg-slate-700 rounded-full h-2 overflow-hidden">
        <div
          className="h-full bg-gradient-to-r from-emerald-500 to-blue-500 rounded-full transition-all duration-700"
          style={{ width: `${Math.min(lane.densityScore * 5, 100)}%` }}
        />
      </div>
      <div className="text-xs text-slate-500 -mt-2">
        Density score: {lane.densityScore}
        {lane.greenTime != null && <span className="ml-2 text-emerald-400/80">· {lane.greenTime}s green</span>}
      </div>
      <div className="flex flex-col gap-1.5">
        <VehicleBar label="Cars" value={lane.cars} max={maxVehicles} color="bg-amber-400" />
        <VehicleBar label="Bikes" value={lane.bikes} max={maxVehicles} color="bg-violet-400" />
        <VehicleBar label="Trucks" value={lane.trucks} max={maxVehicles} color="bg-emerald-400" />
        <VehicleBar label="Buses" value={lane.buses} max={maxVehicles} color="bg-cyan-400" />
      </div>
    </div>
  )
}

function DetectionList({ detections }: { detections: DetectionBox[] }) {
  if (detections.length === 0) return null

  // Sort by confidence desc
  const sorted = [...detections].sort((a, b) => b.confidence - a.confidence)

  // Count per label
  const counts = sorted.reduce<Record<string, number>>((acc, d) => {
    acc[d.label] = (acc[d.label] ?? 0) + 1
    return acc
  }, {})

  return (
    <div className="flex flex-col gap-3">
      {/* Summary chips */}
      <div className="flex flex-wrap gap-2">
        {Object.entries(counts).map(([label, count]) => (
          <span
            key={label}
            className={`px-2.5 py-0.5 rounded-full text-xs font-bold ${LABEL_COLORS[label] ?? "bg-slate-600 text-white"}`}
          >
            {count} {label}{count !== 1 ? "s" : ""}
          </span>
        ))}
        <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-slate-700 text-slate-300">
          {detections.length} total
        </span>
      </div>

      {/* Per-detection rows */}
      <div className="max-h-56 overflow-y-auto flex flex-col gap-1 pr-1">
        {sorted.map((det, i) => (
          <div
            key={i}
            className={`flex items-center gap-3 bg-slate-800/70 border ${LABEL_BORDER[det.label] ?? "border-slate-600"} rounded-lg px-3 py-1.5`}
          >
            {/* Colour dot */}
            <span
              className={`w-2 h-2 rounded-full shrink-0 ${det.label === "car" ? "bg-amber-400" :
                  det.label === "bike" ? "bg-violet-400" :
                    det.label === "bus" ? "bg-cyan-400" :
                      det.label === "truck" ? "bg-emerald-400" : "bg-slate-500"
                }`}
            />
            {/* Label */}
            <span className="text-xs font-semibold text-white capitalize w-10 shrink-0">{det.label}</span>
            {/* Confidence bar */}
            <div className="flex-1 bg-slate-700 rounded-full h-1.5 overflow-hidden">
              <div
                className={`h-full rounded-full ${det.confidence >= 0.8 ? "bg-emerald-400" :
                    det.confidence >= 0.5 ? "bg-yellow-400" : "bg-orange-400"
                  }`}
                style={{ width: `${Math.round(det.confidence * 100)}%` }}
              />
            </div>
            {/* Confidence value */}
            <span className="text-xs font-mono text-slate-300 w-9 text-right shrink-0">
              {Math.round(det.confidence * 100)}%
            </span>
          </div>
        ))}
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
  const [detections, setDetections] = useState<DetectionBox[]>([])
  const [annotatedImg, setAnnotatedImg] = useState<string | null>(null)
  const [analyzing, setAnalyzing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fileName, setFileName] = useState<string | null>(null)
  const [wsConnected, setWsConnected] = useState(false)
  const [emergency, setEmergency] = useState<string | null>(null)

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
      ws.onopen = () => { setWsConnected(true); retryDelay = 1000 }
      ws.onclose = () => {
        setWsConnected(false)
        if (!destroyed) { setTimeout(connect, retryDelay); retryDelay = Math.min(retryDelay * 2, 30_000) }
      }
      ws.onerror = () => ws.close()
      ws.onmessage = (evt) => {
        try {
          const msg = JSON.parse(evt.data)
          if (msg.type === "EMERGENCY_OVERRIDE") setEmergency(msg.message ?? `Emergency on ${msg.lane}`)
          else if (msg.type === "EMERGENCY_CLEARED") setEmergency(null)
          if (
            (msg.type === "PHASE_UPDATE" || msg.type === "CYCLE_UPDATE" || msg.type === "EMERGENCY_OVERRIDE") &&
            lanesRef.current.length > 0
          ) {
            setLanes((prev) => { const merged = mergeSignalState(prev, msg); onData?.(merged); return merged })
          }
        } catch { /* ignore malformed */ }
      }
    }

    connect()
    return () => { destroyed = true; ws?.close() }
  }, [wsUrl, onData])

  // ── Upload handler ─────────────────────────────────────────────────────────
  const handleUpload = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      if (!file) return

      setFileName(file.name)
      setError(null)
      setAnalyzing(true)
      setAnnotatedImg(null)
      setDetections([])

      const form = new FormData()
      form.append("file", file)

      try {
        const res = await axios.post<{
          north: VehicleCounts; south: VehicleCounts; east: VehicleCounts; west: VehicleCounts
          annotated_image?: string
          detections?: DetectionBox[]
        }>(`${backendUrl}/analyze-image`, form)

        const parsed = parseAnalyzeResponse(res.data as any)
        setLanes(parsed)
        lanesRef.current = parsed
        onData?.(parsed)

        if (res.data.annotated_image) setAnnotatedImg(res.data.annotated_image)
        if (res.data.detections) setDetections(res.data.detections)
      } catch (err: any) {
        const msg = err?.response?.data?.detail ?? err?.message ?? "Failed to contact backend."
        setError(msg)
      } finally {
        setAnalyzing(false)
      }
    },
    [backendUrl, onData]
  )

  // ── Derived values ─────────────────────────────────────────────────────────
  const totalVehicles = lanes.reduce((s, l) => s + l.total, 0)
  const busiestLane = lanes.reduce<LaneResult | null>(
    (best, l) => (!best || l.densityScore > best.densityScore ? l : best),
    null
  )

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className={`flex flex-col gap-6 ${className}`}>

      {/* ── Header ── */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-xl font-bold text-white">YOLO Vehicle Detection</h2>
          <p className="text-xs text-slate-500 mt-0.5">YOLOv8n · quadrant analysis · bounding boxes + confidence</p>
        </div>
        <div className="flex items-center gap-3 text-xs">
          <span className={`flex items-center gap-1 ${wsConnected ? "text-emerald-400" : "text-slate-500"}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${wsConnected ? "bg-emerald-400" : "bg-slate-600"}`} />
            {wsConnected ? "WS live" : "WS offline"}
          </span>
          {totalVehicles > 0 && <span className="text-slate-400">{totalVehicles} total detected</span>}
        </div>
      </div>

      {/* ── Emergency banner ── */}
      {emergency && (
        <div className="px-4 py-2 bg-red-500/20 border border-red-500/50 rounded-lg text-red-400 text-sm font-semibold">
          ⚠️ {emergency}
        </div>
      )}

      {/* ── Upload zone ── */}
      <label className="block cursor-pointer border-2 border-dashed border-slate-600 hover:border-emerald-500/60 bg-slate-800/50 rounded-xl px-6 py-5 text-center transition-all">
        <div className="text-slate-300 font-medium text-sm">
          {analyzing ? (
            <span className="text-emerald-400">Analyzing with YOLOv8… detecting vehicles…</span>
          ) : (
            <>
              <span className="text-emerald-400 font-semibold">Upload camera frame</span>
              <span className="text-slate-500"> — JPEG, PNG, BMP</span>
            </>
          )}
        </div>
        {fileName && !analyzing && <p className="text-xs text-slate-500 mt-1">{fileName}</p>}
        <input type="file" accept="image/*" className="hidden" onChange={handleUpload} disabled={analyzing} />
      </label>

      {/* ── Error ── */}
      {error && (
        <div className="text-red-400 text-sm bg-red-500/10 border border-red-500/30 rounded-lg px-4 py-2">
          {error}
        </div>
      )}

      {/* ── Annotated image ── */}
      {annotatedImg && (
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold text-slate-300">Detection Output</h3>
          <div className="rounded-xl overflow-hidden border border-slate-700">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`data:image/jpeg;base64,${annotatedImg}`}
              alt="YOLO annotated detection"
              className="w-full object-contain"
            />
          </div>
          <p className="text-xs text-slate-500">
            Bounding boxes drawn by the backend · colours:
            <span className="text-amber-400 ml-1">car</span>
            <span className="text-violet-400 ml-2">bike</span>
            <span className="text-cyan-400 ml-2">bus</span>
            <span className="text-emerald-400 ml-2">truck</span>
          </p>
        </div>
      )}

      {/* ── Detection list ── */}
      {detections.length > 0 && (
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold text-slate-300">All Detections</h3>
          <DetectionList detections={detections} />
        </div>
      )}

      {/* ── Busiest lane summary ── */}
      {busiestLane && (
        <div className="flex items-center gap-2 text-sm text-slate-400">
          <span className="text-white font-semibold capitalize">{busiestLane.lane}</span>
          lane has highest density
          <span className="text-emerald-400 font-bold">(score: {busiestLane.densityScore})</span>
        </div>
      )}

      {/* ── Lane cards grid ── */}
      {lanes.length > 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {lanes.map((l) => <LaneCard key={l.lane} lane={l} />)}
        </div>
      ) : !annotatedImg ? (
        <div className="h-48 flex items-center justify-center border border-dashed border-slate-700 rounded-xl text-slate-600 text-sm">
          Upload an image to see detection output
        </div>
      ) : null}
    </div>
  )
}
