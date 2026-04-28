"use client"
import { useState, useEffect } from "react"
import axios from "axios"
import { motion } from "framer-motion"

const LANES = ["north", "south", "east", "west"] as const

export default function EmergencyPanel() {
  const [activeLane, setActiveLane] = useState<string | null>(null)
  const [seconds, setSeconds] = useState(0)

  useEffect(() => {
    let ws: WebSocket
    let timer: ReturnType<typeof setInterval>

    const connect = () => {
      ws = new WebSocket("ws://localhost:8000/ws")
      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data)
          if (data.type === "EMERGENCY_OVERRIDE") {
            setActiveLane(data.lane)
            setSeconds(data.duration ?? 30)
            clearInterval(timer)
            timer = setInterval(() => {
              setSeconds(s => {
                if (s <= 1) { clearInterval(timer); return 0 }
                return s - 1
              })
            }, 1000)
          }
          if (data.type === "EMERGENCY_CLEARED") {
            setActiveLane(null)
            setSeconds(0)
            clearInterval(timer)
          }
        } catch { }
      }
      ws.onclose = () => setTimeout(connect, 2000)
    }

    connect()
    return () => { ws?.close(); clearInterval(timer) }
  }, [])

  const trigger = async (lane: string) => {
    if (activeLane && activeLane !== lane) return
    if (activeLane === lane) { await clear(); return }
    try {
      await axios.post("http://localhost:8000/emergency", { lane })
    } catch (err) {
      console.error(err)
    }
  }

  const clear = async () => {
    try { await axios.post("http://localhost:8000/emergency/clear") } catch { }
  }

  return (
    <div className="glass rounded-xl p-4 border border-slate-700 flex flex-col gap-3">

      {/* Header */}
      <div className="flex items-center justify-between">
        <span className="text-xs text-slate-400 uppercase font-semibold tracking-wide">
          Emergency Override
        </span>
        {activeLane && (
          <motion.span
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="text-xs text-red-400 font-semibold tabular-nums"
          >
            {seconds}s
          </motion.span>
        )}
      </div>

      {/* Buttons — even 4-column grid */}
      <div className="grid grid-cols-4 gap-1.5">
        {LANES.map((lane) => {
          const isActive = activeLane === lane
          const isBlocked = !!activeLane && activeLane !== lane

          return (
            <motion.button
              key={lane}
              whileHover={!isBlocked ? { scale: 1.04 } : {}}
              whileTap={!isBlocked ? { scale: 0.95 } : {}}
              onClick={() => trigger(lane)}
              disabled={isBlocked}
              className={`
                flex items-center justify-center gap-1 py-1.5 rounded-lg border
                text-[11px] font-bold tracking-wide uppercase transition-all
                ${isBlocked
                  ? "bg-slate-800 text-slate-600 border-slate-700 cursor-not-allowed"
                  : isActive
                    ? "bg-red-500 text-white border-red-400 animate-pulse"
                    : "bg-red-500/10 text-red-400 border-red-500/30 hover:bg-red-500/20"
                }
              `}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-current opacity-80" />
              {lane.charAt(0).toUpperCase()}
            </motion.button>
          )
        })}
      </div>

      {/* Active Info */}
      {activeLane && (
        <motion.div
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center text-xs text-red-400 animate-pulse"
        >
          🚨 Emergency active on {activeLane.toUpperCase()}
        </motion.div>
      )}

    </div>
  )
}