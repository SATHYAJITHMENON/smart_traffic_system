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

interface SignalState {
  [lane: string]: {
    state: 'GREEN' | 'RED'
    greenTime?: number
  }
}

// 🔥 NEW: AI Decision Interface
interface DecisionData {
  lane: string
  green_time: number
  score: number
}

export default function Dashboard() {
  const [image, setImage] = useState<File | null>(null)
  const [trafficData, setTrafficData] = useState<LaneData[] | null>(null)
  const [annotatedImage, setAnnotatedImage] = useState<string | null>(null)
  const [decision, setDecision] = useState<DecisionData | null>(null) // 🔥 NEW
  const [analyzing, setAnalyzing] = useState(false)
  const [emergency, setEmergency] = useState<EmergencyState>({
    active: false,
    lane: null,
    message: null,
  })
  const [signalState, setSignalState] = useState<SignalState>({})

  // ── WebSocket (UNCHANGED) ─────────────────────────
  useEffect(() => {
    let ws: WebSocket
    let retryDelay = 1000
    let destroyed = false

    const connect = () => {
      if (destroyed) return
      ws = new WebSocket('ws://localhost:8000/ws')

      ws.onmessage = (event) => {
        const data = JSON.parse(event.data)

        if (data.type === 'EMERGENCY_OVERRIDE') {
          setEmergency({ active: true, lane: data.lane, message: data.message })
        }

        if (data.type === 'EMERGENCY_CLEARED') {
          setEmergency({ active: false, lane: null, message: null })
        }

        if ((data.type === 'CYCLE_UPDATE' || data.type === 'PHASE_UPDATE') && Array.isArray(data.data)) {
          const updated: LaneData[] = data.data.map((ph: any) => ({
            lane: ph.lane,
            cars: ph.vehicle_count ?? 0,
            bikes: 0,
            buses: 0,
            trucks: 0,
          }))
          setTrafficData(updated)
        }
      }

      ws.onclose = () => {
        if (!destroyed) {
          setTimeout(connect, retryDelay)
          retryDelay = Math.min(retryDelay * 2, 30000)
        }
      }
    }

    connect()
    return () => { destroyed = true; ws?.close() }
  }, [])

  // ── Upload ───────────────────────────────────────
  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files?.[0]) return

    const file = e.target.files[0]
    setImage(file)

    const formData = new FormData()
    formData.append('file', file)

    setAnalyzing(true)
    try {
      const res = await axios.post('http://localhost:8000/analyze-image', formData)

      setAnnotatedImage(res.data.annotated_image)

      const lanesArray: LaneData[] = ["north", "south", "east", "west"]
        .filter(lane => res.data[lane])
        .map(lane => ({
          lane,
          cars: res.data[lane]?.cars ?? 0,
          bikes: res.data[lane]?.bikes ?? 0,
          trucks: res.data[lane]?.trucks ?? 0,
          buses: res.data[lane]?.buses ?? 0,
        }))

      setTrafficData(lanesArray)

      // 🔥 NEW: AI Decision Extraction
      if (res.data.lanes && res.data.lanes.length > 0) {
        const best = res.data.lanes[0]
        setDecision({
          lane: best.lane,
          green_time: best.green_time,
          score: best.priority_score ?? 0
        })
      }

    } catch (err) {
      console.error(err)
    } finally {
      setAnalyzing(false)
    }
  }
  // 🔥 TOTAL VEHICLES
  const totalVehicles = trafficData
    ? trafficData.reduce(
      (sum, lane) =>
        sum + lane.cars + lane.bikes + lane.trucks + lane.buses,
      0
    )
    : 0

  // 🔥 TYPE TOTALS
  const totals = trafficData
    ? trafficData.reduce(
      (acc, lane) => ({
        cars: acc.cars + lane.cars,
        bikes: acc.bikes + lane.bikes,
        trucks: acc.trucks + lane.trucks,
        buses: acc.buses + lane.buses,
      }),
      { cars: 0, bikes: 0, trucks: 0, buses: 0 }
    )
    : { cars: 0, bikes: 0, trucks: 0, buses: 0 }

  return (
    <div className="max-w-7xl mx-auto space-y-8">

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* Upload */}
        <div className="lg:col-span-1 glass rounded-2xl p-6">
          <h2 className="text-xl font-bold mb-4">Traffic Camera AI</h2>

          <label className="block border-2 border-dashed p-8 text-center cursor-pointer">
            <span>{analyzing ? 'Analyzing...' : 'Upload Camera Image'}</span>
            <input type="file" hidden accept="image/*" onChange={handleImageUpload} />
          </label>

          {annotatedImage && (
            <img
              src={`data:image/jpeg;base64,${annotatedImage}`}
              className="mt-4 rounded-lg border"
            />
          )}
        </div>

        {/* Chart */}
        <div className="lg:col-span-2 glass rounded-2xl p-6">
          <h2 className="text-xl font-bold mb-4">Live Vehicle Distribution</h2>
          {trafficData ? (
            <TrafficChart data={trafficData} />
          ) : (
            <div className="h-40 flex items-center justify-center text-slate-500">
              Upload image to detect vehicles
            </div>
          )}
        </div>
      </div>

      {/* 🔥 AI DECISION PANEL */}
      {decision && (
        <div className="glass rounded-2xl p-6 border border-emerald-500/30">
          <h2 className="text-xl font-bold mb-4 text-emerald-400">
            AI Signal Decision
          </h2>

          <div className="grid grid-cols-3 gap-4 text-center">
            <div>
              <p className="text-sm text-slate-400">Lane</p>
              <p className="text-2xl font-bold capitalize">{decision.lane}</p>
            </div>
            <div>
              <p className="text-sm text-slate-400">Green Time</p>
              <p className="text-2xl text-emerald-400 font-bold">
                {decision.green_time}s
              </p>
            </div>
            <div>
              <p className="text-sm text-slate-400">Score</p>
              <p className="text-2xl text-blue-400 font-bold">
                {decision.score.toFixed(2)}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* SUMMARY */}
      {trafficData && (
        <div className="glass rounded-2xl p-6">
          <h2 className="text-xl font-bold mb-4">Vehicle Summary</h2>

          <div className="text-3xl font-bold text-emerald-400 mb-6">
            Total Vehicles: {totalVehicles}
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <div>Cars: {totals.cars}</div>
            <div>Bikes: {totals.bikes}</div>
            <div>Trucks: {totals.trucks}</div>
            <div>Buses: {totals.buses}</div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {trafficData.map((lane) => {
              const total = lane.cars + lane.bikes + lane.trucks + lane.buses
              return (
                <div key={lane.lane} className="bg-slate-800 p-4 rounded text-center">
                  <div className="capitalize">{lane.lane}</div>
                  <div className="text-xl font-bold">{total}</div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}