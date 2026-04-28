"use client"
import { useState, useEffect } from 'react'
import axios from 'axios'
import TrafficChart from '../components/TrafficChart'
import EmergencyToggle from '../components/EmergencyToggle'
import { motion } from 'framer-motion'

export default function Dashboard() {
  const [image, setImage] = useState<File | null>(null)
  const [trafficData, setTrafficData] = useState<any>(null)
  const [analyzing, setAnalyzing] = useState(false)
  const [wsMessage, setWsMessage] = useState<any>(null)
  
  const [activePhase, setActivePhase] = useState<string | null>(null)

  useEffect(() => {
    const ws = new WebSocket('ws://localhost:8000/ws')
    ws.onmessage = (event) => {
      const data = JSON.parse(event.data)
      setWsMessage(data)
      if (data.type === 'EMERGENCY_OVERRIDE') {
        setActivePhase(data.lane.toUpperCase())
      }
    }
    return () => ws.close()
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
        const lanesArray = Object.keys(res.data).map(lane => ({
          lane,
          ...res.data[lane]
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
        <h1 className="text-3xl font-bold bg-gradient-to-r from-blue-400 to-emerald-400 bg-clip-text text-transparent">Live Dashboard</h1>
        {wsMessage && wsMessage.type === 'EMERGENCY_OVERRIDE' && (
          <motion.div 
            initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }}
            className="px-4 py-2 bg-red-500/20 text-red-400 border border-red-500/50 rounded-lg animate-pulse font-semibold"
          >
            ⚠️ {wsMessage.message}
          </motion.div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        <div className="lg:col-span-1 glass rounded-2xl p-6">
          <h2 className="text-xl font-bold mb-4">Traffic Camera AI</h2>
          <label className="block w-full cursor-pointer border-2 border-dashed border-slate-600 hover:border-slate-400 bg-slate-800/50 rounded-xl p-8 text-center transition-all">
            <span className="text-slate-300 font-medium">{analyzing ? 'Analyzing Frame...' : 'Upload Camera Image'}</span>
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
            {trafficData.map((d: any) => (
              <div key={d.lane} className="bg-slate-800 p-4 rounded-xl border border-slate-700 flex flex-col items-center">
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
