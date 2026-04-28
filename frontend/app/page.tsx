"use client"
import Link from 'next/link'
import { motion } from 'framer-motion'

export default function Home() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[calc(100vh-100px)] text-center">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8 }}
      >
        <h1 className="text-6xl font-extrabold mb-6 tracking-tight">
          Smart <span className="bg-gradient-to-r from-blue-500 to-emerald-500 bg-clip-text text-transparent">Traffic Control</span>
        </h1>
        <p className="text-xl text-slate-400 max-w-2xl mx-auto mb-10">
          AI-powered dynamic traffic management system. Optimize traffic flow, detect vehicles using computer vision, and handle emergencies in real-time.
        </p>
        <Link href="/dashboard">
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            className="px-8 py-4 bg-blue-600 hover:bg-blue-500 text-white rounded-full font-bold text-lg shadow-lg shadow-blue-500/30 transition-all"
          >
            Launch Dashboard
          </motion.button>
        </Link>
      </motion.div>
    </div>
  )
}
