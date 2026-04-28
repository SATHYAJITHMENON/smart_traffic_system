"use client"
import { useState, useEffect, useRef } from "react"
import ControlPanel from "../components/ControlPanel"
import VehicleSimulation from "../components/VehicleSimulation"
import TrafficLights from "../components/TrafficLights"
import AIDecisionPanel, { DecisionLane } from "../components/AIDecisionPanel"

interface Phase {
  lane: "north" | "south" | "east" | "west"
  green_time: number
  vehicle_count: number
}

export default function Simulation() {
  const [cycle, setCycle] = useState<Phase[]>([])
  const [simKey, setSimKey] = useState(0)
  const [activeLane, setActiveLane] = useState<"north" | "south" | "east" | "west" | null>(null)

  const [decisionData, setDecisionData] = useState<DecisionLane[] | null>(null)
  const [decisionMode, setDecisionMode] = useState<string>("adaptive")
  const [prevDecisionData, setPrevDecisionData] = useState<DecisionLane[] | null>(null)
  const [aiCollapsed, setAiCollapsed] = useState(false)

  const [emergencyLane, setEmergencyLane] = useState<"north" | "south" | "east" | "west" | null>(null)
  const [emergencySeconds, setEmergencySeconds] = useState(0)

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // WebSocket
  useEffect(() => {
    let ws: WebSocket | null = null
    let retryDelay = 1000
    let destroyed = false

    const connect = () => {
      if (destroyed) return

      ws = new WebSocket("ws://localhost:8000/ws")

      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data)

          if (msg.type === "EMERGENCY_OVERRIDE") {
            setEmergencyLane(msg.lane)
            setEmergencySeconds(msg.duration ?? 30)

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
            setEmergencyLane(null)
            setEmergencySeconds(0)
            if (timerRef.current) clearInterval(timerRef.current)
          }

        } catch { }
      }

      ws.onclose = () => {
        if (!destroyed) {
          setTimeout(connect, retryDelay)
          retryDelay = Math.min(retryDelay * 2, 30000)
        }
      }

      ws.onerror = () => ws?.close()
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

  const handleDecisionData = (data: DecisionLane[], mode: string) => {
    setPrevDecisionData(decisionData)
    setDecisionData(data)
    setDecisionMode(mode)
  }

  const handleEmergencyClear = () => {
    setEmergencyLane(null)
    setEmergencySeconds(0)

    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }

    fetch("http://localhost:8000/emergency/clear", { method: "POST" })
      .catch(() => { })
  }

  return (
    <div className="max-w-7xl mx-auto flex gap-6 items-start">

      {/* LEFT SIDEBAR */}
      <div className="w-[380px] flex-shrink-0 sticky top-4 flex flex-col gap-4 pb-4">

        {/* AI PANEL */}
        {decisionData && (
          <div className="glass rounded-xl border border-slate-700/50 p-3">

            <button
              onClick={() => setAiCollapsed(v => !v)}
              className="w-full flex justify-between px-2 py-1 text-sm text-slate-300"
            >
              🧠 AI Decision
              <span>{aiCollapsed ? "▲" : "▼"}</span>
            </button>

            {!aiCollapsed && (
              <AIDecisionPanel
                decisionData={decisionData}
                mode={decisionMode}
                prevData={prevDecisionData}
                embedded={true}
              />
            )}
          </div>
        )}

        {/* CONTROL PANEL */}
        <div className="glass rounded-xl border border-slate-700/40 p-3">
          <ControlPanel
            onSimulationRun={handleSimulate}
            onDecisionData={handleDecisionData}
          />
        </div>

      </div>

      {/* RIGHT SIDE */}
      <div className="flex-1 flex flex-col gap-4">

        <h1 className="text-2xl font-bold text-slate-200">
          Intersection Simulation
        </h1>

        {/* SIGNAL + EMERGENCY */}
        {cycle.length > 0 && (
          <div className="glass rounded-xl px-4 py-2 flex items-center justify-between border border-slate-700">

            {/* SIGNAL */}
            <div className="flex items-center gap-4">
              <div className="flex flex-col items-center">
                <span className="text-[10px] text-slate-500 uppercase">Signal</span>
                <TrafficLights activeLane={emergencyLane ?? activeLane} />
                <span className="text-[10px] text-slate-500">live</span>
              </div>
            </div>

            {/* EMERGENCY */}
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-slate-500 uppercase">Emergency</span>

              {(["north", "south", "east", "west"] as const).map(lane => {
                const isActive = emergencyLane === lane
                const isDisabled = !!emergencyLane && emergencyLane !== lane

                return (
                  <button
                    key={lane}
                    disabled={isDisabled}
                    onClick={async () => {
                      if (isDisabled) return
                      if (isActive) return handleEmergencyClear()

                      await fetch("http://localhost:8000/emergency", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ lane }),
                      })
                    }}
                    className={`px-2 py-1 text-[11px] rounded-full border
                      ${isDisabled
                        ? "bg-slate-800 text-slate-600"
                        : isActive
                          ? "bg-red-500 text-white animate-pulse"
                          : "bg-red-500/10 text-red-400 hover:bg-red-500/20"
                      }`}
                  >
                    ● {lane.charAt(0).toUpperCase()}
                  </button>
                )
              })}

              {emergencyLane && (
                <button
                  onClick={handleEmergencyClear}
                  className="ml-2 text-[10px] px-2 py-1 bg-red-500/20 text-red-300 rounded"
                >
                  ✕ {emergencySeconds}s
                </button>
              )}
            </div>

          </div>
        )}

        {/* SIMULATION */}
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
            Simulation Inactive
          </div>
        )}

      </div>
    </div>
  )
}