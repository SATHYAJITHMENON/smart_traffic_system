"use client"
import { useState } from "react"
import axios from "axios"
import { motion } from "framer-motion"

interface Props {
  lane: string
  disabled?: boolean   // NEW: true when a different lane's emergency is active
}

export default function EmergencyToggle({ lane, disabled = false }: Props) {
  const [active, setActive] = useState(false)

  const triggerEmergency = async () => {
    if (disabled) return
    try {
      // Use the new /emergency endpoint which triggers the full freeze flow
      await axios.post("http://localhost:8000/emergency", { lane })
      setActive(true)
      // Visual stays on until WebSocket EMERGENCY_CLEARED resets it
      // We don't need a local setTimeout anymore — the WS event handles it
    } catch (err) {
      console.error("Emergency trigger failed:", err)
      // Still give visual feedback even if backend is down
      setActive(true)
      setTimeout(() => setActive(false), 5000)
    }
  }

  return (
    <motion.button
      whileHover={disabled ? {} : { scale: 1.05 }}
      whileTap={disabled ? {} : { scale: 0.95 }}
      onClick={triggerEmergency}
      disabled={disabled}
      className={`
        px-4 py-2 rounded-lg font-bold text-sm transition-all shadow-lg
        ${disabled
          ? "bg-slate-800/60 border border-slate-700/40 text-slate-600 cursor-not-allowed"
          : active
            ? "bg-red-500 shadow-[0_0_20px_rgba(239,68,68,0.7)] animate-pulse border border-red-400 text-white"
            : "bg-red-900/40 hover:bg-red-600/60 border border-red-500/30 text-red-100"
        }
      `}
    >
      {active ? "🚨" : "🔴"} {lane.toUpperCase()} SOS
    </motion.button>
  )
}