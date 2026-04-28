"use client"
import { useState } from "react"
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
  const [simKey, setSimKey] = useState(0)   // forces VehicleSimulation remount on new run

  const handleSimulate = (newCycle: Phase[]) => {
    setCycle(newCycle)
    setSimKey(k => k + 1)
  }

  return (
    <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-3 gap-8">
      <div className="lg:col-span-1">
        <ControlPanel onSimulationRun={handleSimulate} />

        {/* Traffic lights panel */}
        {cycle.length > 0 && (
          <div className="glass rounded-xl p-4 mt-6">
            <h3 className="text-sm font-semibold text-slate-400 mb-3 uppercase tracking-wider">
              Signal State
            </h3>
            <TrafficLights activeLane={null} />
            <p className="text-xs text-slate-500 text-center mt-2">
              Lights update live in the simulation below
            </p>
          </div>
        )}
      </div>

      <div className="lg:col-span-2">
        <h1 className="text-3xl font-bold mb-6">Intersection Simulation</h1>

        {cycle.length > 0 ? (
          <VehicleSimulation
            key={simKey}
            cycle={cycle}
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
