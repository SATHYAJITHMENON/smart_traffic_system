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

export default function Dashboard() {
  const [image, setImage] = useState<File | null>(null)
  const [trafficData, setTrafficData] = useState<LaneData[] | null>(null)
  const [analyzing, setAnalyzing] = useState(false)
  const [emergency, setEmergency] = useState<EmergencyState>({
    active: false,
    lane: null,
    message: null,
  })

  useEffect(() => {
    let ws: WebSocket
    let retryDelay = 1000
    let destroyed = false

    const connect = () => {
      if (destroyed) return
      ws = new WebSocket('ws://localhost:8000/ws')

      ws.onopen = () => {
        retryDelay = 1000 // reset backoff on successful connect
      }

      ws.onmessage = (event) => {
        const data = JSON.parse(event.data)

        if (data.type === 'EMERGENCY_OVERRIDE') {
          setEmergency({ active: true, lane: data.lane, message: data.message })
        }

        if (data.type === 'EMERGENCY_CLEARED') {
          // Clear the emergency banner immediately.
          setEmergency({ active: false, lane: null, message: null })

          // Restore traffic display from last_cycle if the image-upload path
          // hasn't already populated trafficData. last_cycle is always the
          // last real CYCLE_UPDATE / PHASE_UPDATE — never an emergency payload —
          // because broadcast() no longer writes _current_cycle.
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

        // Keep the chart live on normal cycle ticks (CYCLE_UPDATE / PHASE_UPDATE).
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
      }

      ws.onclose = () => {
        if (!destroyed) {
          setTimeout(connect, retryDelay)
          retryDelay = Math.min(retryDelay * 2, 30_000) // cap at 30s
        }
      }

      ws.onerror = () => {
        ws.close() // triggers onclose → retry
      }
    }

    connect()
    return () => {
      destroyed = true
      ws?.close()
    }
  }, [])

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0]
      setImage(file)

      const formData = new FormData()
      formData.append('file', file)

      setAnalyzing(true)
      try {
        const res = await axios.post('http://localhost:8000/analyze-image', formData)
        const lanesArray: LaneData[] = Object.keys(res.data).map(lane => ({
          lane,
          ...res.data[lane],
        }))
        setTrafficData(lanesArray)
      } catch (err) {
        console.error(err)
      } finally {
        setAnalyzing(false)
      }
    }
  }

  return (
    <div className="max-w-7xl mx-auto space-y-8 animate-in fade-in duration-500">

      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold bg-gradient-to-r from-blue-400 to-emerald-400 bg-clip-text text-transparent">
          Live Dashboard
        </h1>

        {/* Emergency banner — appears on EMERGENCY_OVERRIDE, clears on EMERGENCY_CLEARED */}
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

    </div>
  )
}