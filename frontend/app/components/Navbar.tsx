"use client"
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { motion } from 'framer-motion'

export default function Navbar() {
  const pathname = usePathname()

  return (
    <nav className="fixed top-0 w-full z-50 glass border-b border-white/10 px-6 py-4">
      <div className="max-w-7xl mx-auto flex items-center justify-between">
        <Link href="/">
          <motion.div whileHover={{ scale: 1.05 }} className="text-2xl font-bold bg-gradient-to-r from-blue-400 to-emerald-400 bg-clip-text text-transparent">
            TrafficAI
          </motion.div>
        </Link>
        <div className="flex gap-6">
          <Link href="/dashboard" className={`hover:text-blue-400 transition-colors ${pathname === '/dashboard' ? 'text-blue-400' : 'text-slate-300'}`}>
            Dashboard
          </Link>
          <Link href="/simulation" className={`hover:text-blue-400 transition-colors ${pathname === '/simulation' ? 'text-blue-400' : 'text-slate-300'}`}>
            Simulation
          </Link>
        </div>
      </div>
    </nav>
  )
}
