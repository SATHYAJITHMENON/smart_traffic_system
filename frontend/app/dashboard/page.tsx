"use client"
import { useState, useEffect } from 'react'
import axios from 'axios'
import TrafficChart from '../components/TrafficChart'
import EmergencyToggle from '../components/EmergencyToggle'
import { motion, AnimatePresence } from 'framer-motion'

interface LaneData {
  lane: string
  cars: number
  bikes: number
  buses: number
  trucks: number
}

interface EmergencyState {
  active: boolean
  lane: string | null
  message: string | null
}

// Signal state merged from WebSocket PHASE_UPDATE
interface SignalState {
  [lane: string]: {
    state: 'GREEN' | 'RED'
    greenTime?: number
  }
}

// ── Small helpers ─────────────────────────────────────────────────────────────

const DIRECTION_ARROW: Record<string, string> = {
  north: '↑', south: '↓', east: '→', west: '←',
}

function VehicleBar({
  label, value, max, color,
}: {
  label: string; value: number; max: number; color: string
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

// ── Main page ─────────────────────────────────────────────────────────────────

export default function Dashboard() {
  const [image, setImage] = useState<File | null>(null)
  const [trafficData, setTrafficData] = useState<LaneData[] | null>(null)
  const [analyzing, setAnalyzing] = useState(false)
  const [emergency, setEmergency] = useState<EmergencyState>({
    active: false,
    lane: null,
    message: null,
  })
  const [signalState, setSignalState] = useState<SignalState>({})

  // ── WebSocket (unchanged logic, extended to capture signal states) ──────────
  useEffect(() => {
    let ws: WebSocket
    let retryDelay = 1000
    let destroyed = false

    const connect = () => {
      if (destroyed) return
      ws = new WebSocket('ws://localhost:8000/ws')

      ws.onopen = () => {
        retryDelay = 1000
      }

      ws.onmessage = (event) => {
        const data = JSON.parse(event.data)

        if (data.type === 'EMERGENCY_OVERRIDE') {
          setEmergency({ active: true, lane: data.lane, message: data.message })
          // Mark the emergency lane as GREEN, rest RED
          if (data.lane) {
            setSignalState({
              north: { state: data.lane === 'north' ? 'GREEN' : 'RED', greenTime: data.lane === 'north' ? 60 : undefined },
              south: { state: data.lane === 'south' ? 'GREEN' : 'RED', greenTime: data.lane === 'south' ? 60 : undefined },
              east: { state: data.lane === 'east' ? 'GREEN' : 'RED', greenTime: data.lane === 'east' ? 60 : undefined },
              west: { state: data.lane === 'west' ? 'GREEN' : 'RED', greenTime: data.lane === 'west' ? 60 : undefined },
            })
          }
        }

        if (data.type === 'EMERGENCY_CLEARED') {
          setEmergency({ active: false, lane: null, message: null })

          if (data.last_cycle?.data && Array.isArray(data.last_cycle.data)) {
            const restored: LaneData[] = data.last_cycle.data.map((ph: any) => ({
              lane: ph.lane,
              cars: ph.vehicle_count ?? 0,
              bikes: 0,
              buses: 0,
              trucks: 0,
            }))
            setTrafficData(restored)
          }
        }

        if (
          (data.type === 'CYCLE_UPDATE' || data.type === 'PHASE_UPDATE') &&
          Array.isArray(data.data)
        ) {
          const updated: LaneData[] = data.data.map((ph: any) => ({
            lane: ph.lane,
            cars: ph.vehicle_count ?? 0,
            bikes: 0,
            buses: 0,
            trucks: 0,
          }))
          setTrafficData(updated)
        }

        // Capture active signal states from PHASE_UPDATE
        if (data.type === 'PHASE_UPDATE' && Array.isArray(data.active_lanes)) {
          const activeSet = new Set<string>(data.active_lanes.map((l: string) => l.toLowerCase()))
          const greenTime: number | undefined = data.green_time
          const newSignals: SignalState = {}
            ;['north', 'south', 'east', 'west'].forEach((lane) => {
              newSignals[lane] = {
                state: activeSet.has(lane) ? 'GREEN' : 'RED',
                greenTime: activeSet.has(lane) ? greenTime : undefined,
              }
            })
          setSignalState(newSignals)
        }

        // Capture signal states from CYCLE_UPDATE (data array has green_time per lane)
        if (data.type === 'CYCLE_UPDATE' && Array.isArray(data.data)) {
          // The first item in the sorted list is the active (GREEN) lane
          const newSignals: SignalState = {}
          data.data.forEach((ph: any, idx: number) => {
            const lane = ph.lane?.toLowerCase()
            if (lane) {
              newSignals[lane] = {
                state: idx === 0 ? 'GREEN' : 'RED',
                greenTime: ph.green_time,
              }
            }
          })
          setSignalState(newSignals)
        }
      }

      ws.onclose = () => {
        if (!destroyed) {
          setTimeout(connect, retryDelay)
          retryDelay = Math.min(retryDelay * 2, 30_000)
        }
      }

      ws.onerror = () => {
        ws.close()
      }
    }

    connect()
    return () => {
      destroyed = true
      ws?.close()
    }
  }, [])

  // ── Image upload (unchanged logic) ─────────────────────────────────────────
  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0]
      setImage(file)

      const formData = new FormData()
      formData.append('file', file)

      setAnalyzing(true)
      try {
        const res = await axios.post('http://localhost:8000/analyze-image', formData)
        // /analyze-image returns { north: {cars,bikes,trucks,buses}, south: … }
        const lanesArray: LaneData[] = Object.keys(res.data).map(lane => ({
          lane,
          cars: res.data[lane].cars ?? 0,
          bikes: res.data[lane].bikes ?? 0,
          trucks: res.data[lane].trucks ?? 0,
          buses: res.data[lane].buses ?? 0,
        }))
        setTrafficData(lanesArray)
      } catch (err) {
        console.error(err)
      } finally {
        setAnalyzing(false)
      }
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="max-w-7xl mx-auto space-y-8 animate-in fade-in duration-500">

      {/* ── Header (unchanged) ──────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold bg-gradient-to-r from-blue-400 to-emerald-400 bg-clip-text text-transparent">
          Live Dashboard
        </h1>

        <AnimatePresence>
          {emergency.active && (
            <motion.div
              key="emergency-banner"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              className="px-4 py-2 bg-red-500/20 text-red-400 border border-red-500/50 rounded-lg animate-pulse font-semibold"
            >
              ⚠️ {emergency.message}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* ── Upload + Chart row (unchanged layout) ──────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        <div className="lg:col-span-1 glass rounded-2xl p-6">
          <h2 className="text-xl font-bold mb-4">Traffic Camera AI</h2>
          <label className="block w-full cursor-pointer border-2 border-dashed border-slate-600 hover:border-slate-400 bg-slate-800/50 rounded-xl p-8 text-center transition-all">
            <span className="text-slate-300 font-medium">
              {analyzing ? 'Analyzing Frame...' : 'Upload Camera Image'}
            </span>
            <input type="file" className="hidden" accept="image/*" onChange={handleImageUpload} />
          </label>

          {image && (
            <div className="mt-4 break-words">
              <p className="text-xs text-slate-400">Latest feed: {image.name}</p>
            </div>
          )}
        </div>

        <div className="lg:col-span-2 glass rounded-2xl p-6">
          <h2 className="text-xl font-bold mb-4">Live Vehicle Distribution</h2>
          {trafficData ? (
            <TrafficChart data={trafficData} />
          ) : (
            <div className="h-64 flex items-center justify-center text-slate-500 border border-dashed border-slate-700 rounded-xl">
              Upload an image to see detection data
            </div>
          )}
        </div>

      </div>

      {/* ── Current Densities (unchanged) ───────────────────────────────────── */}
      {trafficData && (
        <div className="glass rounded-2xl p-6">
          <h2 className="text-xl font-bold mb-4">Current Densities</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {trafficData.map((d) => (
              <div
                key={d.lane}
                className="bg-slate-800 p-4 rounded-xl border border-slate-700 flex flex-col items-center"
              >
                <span className="text-lg font-bold capitalize text-emerald-400">{d.lane}</span>
                <span className="text-3xl font-black">{d.cars + d.bikes + d.buses + d.trucks}</span>
                <span className="text-xs text-slate-400">Total detected</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── NEW: YOLO Detection Breakdown ──────────────────────────────────── */}
      {trafficData && (
        <div className="glass rounded-2xl p-6">
          <h2 className="text-xl font-bold mb-1">YOLO Detection Breakdown</h2>
          <p className="text-xs text-slate-500 mb-5">
            YOLOv8n · per-quadrant vehicle type counts · signal state from live WebSocket
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
            {trafficData.map((d) => {
              const total = d.cars + d.bikes + d.trucks + d.buses
              const maxCount = Math.max(d.cars, d.bikes, d.trucks, d.buses, 1)
              const densityScore = d.cars + d.bikes + d.trucks * 2 + d.buses * 2
              const sig = signalState[d.lane]

              return (
                <div
                  key={d.lane}
                  className="bg-slate-800 border border-slate-700 rounded-xl p-4 flex flex-col gap-3"
                >
                  {/* Lane header */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-slate-400 text-base">
                        {DIRECTION_ARROW[d.lane] ?? '•'}
                      </span>
                      <span className="font-bold text-white text-sm capitalize">{d.lane}</span>

                      {/* Signal dot */}
                      {sig && (
                        <span
                          className={`w-2.5 h-2.5 rounded-full ${sig.state === 'GREEN' ? 'bg-emerald-400' : 'bg-red-500'
                            }`}
                        />
                      )}
                    </div>

                    <div className="text-right">
                      <div className="text-2xl font-black text-emerald-400">{total}</div>
                      <div className="text-xs text-slate-500">vehicles</div>
                    </div>
                  </div>

                  {/* Density bar */}
                  <div className="w-full bg-slate-700 rounded-full h-2 overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-emerald-500 to-blue-500 rounded-full transition-all duration-700"
                      style={{ width: `${Math.min(densityScore * 5, 100)}%` }}
                    />
                  </div>
                  <div className="text-xs text-slate-500 -mt-2 flex justify-between">
                    <span>Density: {densityScore}</span>
                    {sig?.greenTime != null && (
                      <span className="text-emerald-400/80">{sig.greenTime}s green</span>
                    )}
                  </div>

                  {/* Per-type bars */}
                  <div className="flex flex-col gap-1.5">
                    <VehicleBar label="Cars" value={d.cars} max={maxCount} color="bg-blue-400" />
                    <VehicleBar label="Bikes" value={d.bikes} max={maxCount} color="bg-violet-400" />
                    <VehicleBar label="Trucks" value={d.trucks} max={maxCount} color="bg-orange-400" />
                    <VehicleBar label="Buses" value={d.buses} max={maxCount} color="bg-rose-400" />
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

    </div>
  )
}