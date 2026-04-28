"use client"
import { useState, useEffect, useRef } from "react"
import ControlPanel from "../components/ControlPanel"
import VehicleSimulation from "../components/VehicleSimulation"
import TrafficLights from "../components/TrafficLights"

interface Phase {
  lane: "north" | "south" | "east" | "west"
  green_time: number
  vehicle_count: number
}

export default function Simulation() {
  const [cycle, setCycle] = useState<Phase[]>([])
  const [simKey, setSimKey] = useState(0)
  const [activeLane, setActiveLane] = useState<"north" | "south" | "east" | "west" | null>(null)

  // Emergency state driven by WebSocket
  const [emergencyLane, setEmergencyLane] = useState<"north" | "south" | "east" | "west" | null>(null)
  const [emergencySeconds, setEmergencySeconds] = useState(0)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // WebSocket with reconnect — mirrors dashboard pattern
  useEffect(() => {
    let ws: WebSocket
    let retryDelay = 1000
    let destroyed = false

    const connect = () => {
      if (destroyed) return
      ws = new WebSocket("ws://localhost:8000/ws")

      ws.onopen = () => { retryDelay = 1000 }

      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data)

          if (msg.type === "EMERGENCY_OVERRIDE") {
            setEmergencyLane(msg.lane)
            setEmergencySeconds(msg.duration ?? 30)
            if (timerRef.current) clearInterval(timerRef.current)
            timerRef.current = setInterval(() => {
              setEmergencySeconds(s => {
                if (s <= 1) { clearInterval(timerRef.current!); return 0 }
                return s - 1
              })
            }, 1000)
          }

          if (msg.type === "EMERGENCY_CLEARED") {
            setEmergencyLane(null)
            setEmergencySeconds(0)
            if (timerRef.current) clearInterval(timerRef.current)
          }
        } catch { }
      }

      ws.onclose = () => {
        if (!destroyed) {
          setTimeout(connect, retryDelay)
          retryDelay = Math.min(retryDelay * 2, 30_000)
        }
      }

      ws.onerror = () => { ws.close() }
    }

    connect()
    return () => {
      destroyed = true
      ws?.close()
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [])

  const handleSimulate = (newCycle: Phase[]) => {
    setCycle(newCycle)
    setSimKey(k => k + 1)
  }

  // Called by VehicleSimulation as soon as the ambulance exits the canvas.
  // Clears emergency state immediately on the frontend and notifies the backend
  // so the 30-second server timer is cancelled rather than running to completion.
  const handleEmergencyClear = () => {
    setEmergencyLane(null)
    setEmergencySeconds(0)
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null }
    // Tell the backend to cancel the auto-clear timer
    fetch("http://localhost:8000/emergency/clear", { method: "POST" }).catch(() => { })
  }

  return (
    <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-3 gap-8">
      {/* ── Left sidebar: controls only ── */}
      <div className="lg:col-span-1">
        <ControlPanel onSimulationRun={handleSimulate} />
      </div>

      {/* ── Right: title + overlay bar + simulation ── */}
      <div className="lg:col-span-2 flex flex-col gap-4">
        <h1 className="text-3xl font-bold">Intersection Simulation</h1>

        {/* ── Overlay bar: traffic lights + emergency SOS (always visible once cycle loaded) ── */}
        {cycle.length > 0 && (
          <div className="glass rounded-xl px-4 py-3 flex flex-wrap items-center justify-between gap-4 border border-slate-700">

            {/* Traffic lights */}
            <div className="flex flex-col gap-1">
              <span className="text-xs text-slate-500 uppercase tracking-wider font-semibold">Signal State</span>
              <TrafficLights activeLane={emergencyLane ?? activeLane} />
              {emergencyLane ? (
                <p className="text-xs text-red-400 text-center animate-pulse mt-0.5">
                  🚨 {emergencyLane.toUpperCase()} priority
                </p>
              ) : (
                <p className="text-xs text-slate-600 text-center mt-0.5">live</p>
              )}
            </div>

            {/* Divider */}
            <div className="hidden sm:block w-px self-stretch bg-slate-700" />

            {/* Emergency SOS buttons + status */}
            <div className="flex flex-col gap-2 flex-1 min-w-[200px]">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-slate-500 uppercase tracking-wider font-semibold">Emergency Override</span>
                {emergencyLane && (
                  <button
                    onClick={handleEmergencyClear}
                    className="text-xs px-3 py-1 bg-red-900/50 hover:bg-red-700/60 border border-red-500/40 text-red-300 rounded-lg transition-colors"
                  >
                    Cancel ({emergencySeconds}s)
                  </button>
                )}
              </div>

              {emergencyLane && (
                <div className="px-3 py-2 bg-red-950/60 border border-red-500/40 rounded-lg text-xs animate-pulse">
                  <span className="text-red-400 font-bold">🚨 {emergencyLane.toUpperCase()} lane active — all others frozen</span>
                </div>
              )}

              <div className="grid grid-cols-4 gap-2">
                {(["north", "south", "east", "west"] as const).map(lane => {
                  const isActive = emergencyLane === lane
                  const isDisabled = !!emergencyLane && emergencyLane !== lane
                  return (
                    <button
                      key={lane}
                      disabled={isDisabled}
                      onClick={async () => {
                        if (isDisabled) return
                        if (isActive) { handleEmergencyClear(); return }
                        try {
                          await fetch("http://localhost:8000/emergency", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ lane }),
                          })
                        } catch { }
                      }}
                      className={`px-2 py-1.5 rounded-lg font-bold text-xs transition-all border ${isDisabled
                          ? "bg-slate-800/60 border-slate-700/40 text-slate-600 cursor-not-allowed"
                          : isActive
                            ? "bg-red-500 border-red-400 text-white shadow-[0_0_16px_rgba(239,68,68,0.6)] animate-pulse"
                            : "bg-red-900/40 hover:bg-red-600/60 border-red-500/30 text-red-100"
                        }`}
                    >
                      {isActive ? "🚨" : "🔴"} {lane.charAt(0).toUpperCase()}
                    </button>
                  )
                })}
              </div>
            </div>
          </div>
        )}

        {/* ── Simulation canvas ── */}
        {cycle.length > 0 ? (
          <VehicleSimulation
            key={simKey}
            cycle={cycle}
            emergencyLane={emergencyLane}
            onActiveLaneChange={setActiveLane}
            onEmergencyClear={handleEmergencyClear}
            onSimulationEnd={() => console.log("Simulation finished")}
          />
        ) : (
          <div className="glass rounded-2xl p-12 text-center border-dashed border-2 border-slate-700">
            <div className="text-slate-400 text-lg mb-2">Simulation Inactive</div>
            <p className="text-slate-500 text-sm">
              Configure vehicle counts and run the simulation from the control panel.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}