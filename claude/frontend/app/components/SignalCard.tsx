"use client"
import { motion, AnimatePresence } from 'framer-motion'
import { useEffect, useRef, useState } from 'react'

// ── Phase 3 + Emergency additions ────────────────────────────────────────────
// New props:
//   emergencyLane  – the lane currently under emergency (from EMERGENCY_OVERRIDE)
//   emergencyDuration – total seconds of the emergency (default 30)
//   emergencyStartedAt – Date.now() value when emergency was triggered,
//                        used to derive a live countdown inside the card

interface Props {
  lane: string
  greenTime: number
  vehicleCount: number
  isGreen: boolean
  // Phase 3 ———————————————————————————————————————————————
  phaseName?: string
  pedSignals?: Record<string, "WALK" | "STOP">
  isLeftTurnPhase?: boolean
  // Emergency ——————————————————————————————————————————————
  emergencyLane?: string | null      // which lane has the emergency (or null)
  emergencyDuration?: number         // total seconds (default 30)
  emergencyStartedAt?: number | null // ms timestamp (Date.now()) when it fired
}

const LANE_META: Record<string, {
  arrow: string
  color: string
  compass: string
  animDir: 'ltr' | 'rtl' | 'ttb' | 'btt'
  pedCrossing: string
}> = {
  north: { arrow: '↑', color: '#34d399', compass: 'N', animDir: 'btt', pedCrossing: 'NS' },
  south: { arrow: '↓', color: '#60a5fa', compass: 'S', animDir: 'ttb', pedCrossing: 'NS' },
  east: { arrow: '→', color: '#f59e0b', compass: 'E', animDir: 'ltr', pedCrossing: 'EW' },
  west: { arrow: '←', color: '#a78bfa', compass: 'W', animDir: 'rtl', pedCrossing: 'EW' },
  ns: { arrow: '↕', color: '#34d399', compass: 'NS', animDir: 'btt', pedCrossing: 'NS' },
  ew: { arrow: '↔', color: '#60a5fa', compass: 'EW', animDir: 'ltr', pedCrossing: 'EW' },
}

const PHASE_LABELS: Record<string, { label: string; emoji: string; color: string }> = {
  NS_straight: { label: 'NS Straight', emoji: '↕', color: '#34d399' },
  EW_straight: { label: 'EW Straight', emoji: '↔', color: '#60a5fa' },
  left_turns: { label: 'Left Turns', emoji: '↰', color: '#f59e0b' },
  pedestrian: { label: 'Pedestrian', emoji: '🚶', color: '#c084fc' },
}

// ── CSS keyframes ─────────────────────────────────────────────────────────────
const KEYFRAMES = `
@keyframes td-ltr { 0%{transform:translateX(-150%) translateY(-50%)} 100%{transform:translateX(1500%) translateY(-50%)} }
@keyframes td-rtl { 0%{transform:translateX( 150%) translateY(-50%)} 100%{transform:translateX(-1500%) translateY(-50%)} }
@keyframes td-ttb { 0%{transform:translateX(-50%) translateY(-150%)} 100%{transform:translateX(-50%) translateY(1500%)} }
@keyframes td-btt { 0%{transform:translateX(-50%) translateY( 150%)} 100%{transform:translateX(-50%) translateY(-1500%)} }
@keyframes ped-walk-blink { 0%,49%{opacity:1} 50%,100%{opacity:0.25} }
@keyframes emergency-pulse { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:0.7;transform:scale(1.04)} }
@keyframes siren-flash { 0%,49%{background:rgba(239,68,68,0.18)} 50%,100%{background:rgba(239,68,68,0.04)} }
@keyframes countdown-shrink { from{width:100%} to{width:0%} }
`

// ── Car SVG ───────────────────────────────────────────────────────────────────

function CarTopDown({ color, isHorizontal }: { color: string; isHorizontal: boolean }) {
  if (isHorizontal) {
    return (
      <svg width="26" height="13" viewBox="0 0 26 13" fill="none">
        <rect x="0.5" y="1.5" width="25" height="10" rx="2" fill={color} />
        <rect x="3" y="2.5" width="8" height="8" rx="1" fill={color} opacity="0.45" />
        <rect x="15" y="2.5" width="7" height="8" rx="1" fill={color} opacity="0.45" />
        <rect x="4" y="3.5" width="5" height="4" rx="0.5" fill="white" opacity="0.2" />
        <rect x="23" y="2.5" width="2" height="2" rx="0.5" fill="#fef08a" opacity="0.95" />
        <rect x="23" y="8.5" width="2" height="2" rx="0.5" fill="#fef08a" opacity="0.95" />
        <rect x="1" y="2.5" width="2" height="2" rx="0.5" fill="#f87171" opacity="0.85" />
        <rect x="1" y="8.5" width="2" height="2" rx="0.5" fill="#f87171" opacity="0.85" />
      </svg>
    )
  }
  return (
    <svg width="13" height="26" viewBox="0 0 13 26" fill="none">
      <rect x="1.5" y="0.5" width="10" height="25" rx="2" fill={color} />
      <rect x="2.5" y="3" width="8" height="8" rx="1" fill={color} opacity="0.45" />
      <rect x="2.5" y="15" width="8" height="7" rx="1" fill={color} opacity="0.45" />
      <rect x="3.5" y="4" width="4" height="5" rx="0.5" fill="white" opacity="0.2" />
      <rect x="2.5" y="23" width="2" height="2" rx="0.5" fill="#fef08a" opacity="0.95" />
      <rect x="8.5" y="23" width="2" height="2" rx="0.5" fill="#fef08a" opacity="0.95" />
      <rect x="2.5" y="1" width="2" height="2" rx="0.5" fill="#f87171" opacity="0.85" />
      <rect x="8.5" y="1" width="2" height="2" rx="0.5" fill="#f87171" opacity="0.85" />
    </svg>
  )
}

// ── Ambulance SVG (shown on the emergency lane only) ──────────────────────────

function AmbulanceSVG({ isHorizontal }: { isHorizontal: boolean }) {
  if (isHorizontal) {
    return (
      <svg width="34" height="16" viewBox="0 0 34 16" fill="none">
        <rect x="0.5" y="2" width="33" height="12" rx="2.5" fill="#ef4444" />
        <rect x="2" y="3" width="10" height="10" rx="1" fill="#fca5a5" opacity="0.5" />
        <rect x="14" y="3" width="8" height="10" rx="1" fill="#fca5a5" opacity="0.5" />
        {/* Cross */}
        <rect x="16" y="5.5" width="4" height="5" rx="0.5" fill="white" opacity="0.9" />
        <rect x="17.5" y="4" width="1" height="8" rx="0.5" fill="white" opacity="0.9" />
        {/* Lights */}
        <rect x="31" y="3" width="2" height="2" rx="0.5" fill="#fef08a" opacity="0.95" />
        <rect x="31" y="11" width="2" height="2" rx="0.5" fill="#fef08a" opacity="0.95" />
        <rect x="1" y="3" width="2" height="2" rx="0.5" fill="#60a5fa" opacity="0.9" />
        <rect x="1" y="11" width="2" height="2" rx="0.5" fill="#60a5fa" opacity="0.9" />
      </svg>
    )
  }
  return (
    <svg width="16" height="34" viewBox="0 0 16 34" fill="none">
      <rect x="2" y="0.5" width="12" height="33" rx="2.5" fill="#ef4444" />
      <rect x="3" y="2" width="10" height="10" rx="1" fill="#fca5a5" opacity="0.5" />
      <rect x="3" y="14" width="10" height="8" rx="1" fill="#fca5a5" opacity="0.5" />
      {/* Cross */}
      <rect x="5.5" y="16" width="5" height="4" rx="0.5" fill="white" opacity="0.9" />
      <rect x="7" y="14.5" width="2" height="7" rx="0.5" fill="white" opacity="0.9" />
      {/* Lights */}
      <rect x="3" y="31" width="2" height="2" rx="0.5" fill="#fef08a" opacity="0.95" />
      <rect x="11" y="31" width="2" height="2" rx="0.5" fill="#fef08a" opacity="0.95" />
      <rect x="3" y="1" width="2" height="2" rx="0.5" fill="#60a5fa" opacity="0.9" />
      <rect x="11" y="1" width="2" height="2" rx="0.5" fill="#60a5fa" opacity="0.9" />
    </svg>
  )
}

// ── Pedestrian Signal ─────────────────────────────────────────────────────────

function PedestrianSignal({ state }: { state: 'WALK' | 'STOP' }) {
  const isWalk = state === 'WALK'
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
      padding: '4px 3px', borderRadius: 6, background: '#0f1c2e',
      border: `1px solid ${isWalk ? 'rgba(74,222,128,0.35)' : 'rgba(248,113,113,0.25)'}`,
      minWidth: 28,
    }}>
      {isWalk ? (
        <svg width="16" height="26" viewBox="0 0 16 26" fill="none"
          style={{ animation: 'ped-walk-blink 0.9s step-start infinite' }}>
          <circle cx="8" cy="3" r="2.5" fill="#4ade80" />
          <line x1="8" y1="5.5" x2="8" y2="14" stroke="#4ade80" strokeWidth="2" strokeLinecap="round" />
          <line x1="8" y1="9" x2="2" y2="12" stroke="#4ade80" strokeWidth="1.8" strokeLinecap="round" />
          <line x1="8" y1="9" x2="14" y2="7" stroke="#4ade80" strokeWidth="1.8" strokeLinecap="round" />
          <line x1="8" y1="14" x2="3" y2="22" stroke="#4ade80" strokeWidth="1.8" strokeLinecap="round" />
          <line x1="8" y1="14" x2="13" y2="22" stroke="#4ade80" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      ) : (
        <svg width="16" height="26" viewBox="0 0 16 26" fill="none">
          <rect x="4" y="8" width="8" height="10" rx="2" fill="#f87171" />
          <rect x="4" y="4" width="2.2" height="7" rx="1.1" fill="#f87171" />
          <rect x="6.9" y="3" width="2.2" height="8" rx="1.1" fill="#f87171" />
          <rect x="9.8" y="4" width="2.2" height="7" rx="1.1" fill="#f87171" />
          <rect x="2" y="9" width="2.2" height="5" rx="1.1" fill="#f87171" />
          <rect x="6" y="17" width="4" height="6" rx="1.5" fill="#f87171" opacity="0.75" />
        </svg>
      )}
      <span style={{
        fontSize: 7, fontWeight: 800, letterSpacing: 0.5, fontFamily: 'monospace',
        color: isWalk ? '#4ade80' : '#f87171', lineHeight: 1
      }}>
        {isWalk ? 'WALK' : 'STOP'}
      </span>
    </div>
  )
}

// ── Emergency countdown hook ───────────────────────────────────────────────────
// Derives remaining seconds from a start timestamp, ticks every 250ms.

function useEmergencyCountdown(
  startedAt: number | null | undefined,
  totalDuration: number,
): number {
  const [remaining, setRemaining] = useState(totalDuration)

  useEffect(() => {
    if (!startedAt) {
      setRemaining(totalDuration)
      return
    }
    const tick = () => {
      const elapsed = (Date.now() - startedAt) / 1000
      setRemaining(Math.max(0, Math.round(totalDuration - elapsed)))
    }
    tick()
    const id = setInterval(tick, 250)
    return () => clearInterval(id)
  }, [startedAt, totalDuration])

  return remaining
}

// ── Intersection view ─────────────────────────────────────────────────────────

interface IntersectionProps {
  meta: typeof LANE_META[string]
  isGreen: boolean
  vehicleCount: number
  greenTime: number
  pedState?: 'WALK' | 'STOP'
  isLeftTurnPhase?: boolean
  isEmergencyLane: boolean   // this lane IS the emergency lane
  emergencyActive: boolean   // any emergency is active (used to freeze other lanes)
}

function IntersectionView({
  meta, isGreen, vehicleCount, greenTime, pedState, isLeftTurnPhase,
  isEmergencyLane, emergencyActive,
}: IntersectionProps) {
  const isHorizontal = meta.animDir === 'ltr' || meta.animDir === 'rtl'

  const duration = greenTime
  const delayStep = vehicleCount > 0 ? greenTime / vehicleCount : 0

  const W = 220, H = 160
  const roadW = 58
  const roadX = (W - roadW) / 2
  const roadY = (H - roadW) / 2

  const subLane: Record<string, number> = {
    ltr: roadY + roadW * 0.28,
    rtl: roadY + roadW * 0.72,
    ttb: roadX + roadW * 0.72,
    btt: roadX + roadW * 0.28,
  }
  const crossPx = subLane[meta.animDir]

  const leftArrowColor = isGreen && isLeftTurnPhase ? meta.color : 'transparent'

  // Effective green: during emergency, only the emergency lane shows green.
  const effectiveGreen = emergencyActive ? isEmergencyLane : isGreen

  return (
    <div style={{
      position: 'relative', width: W, height: H, borderRadius: 12,
      overflow: 'hidden', background: '#07101e', margin: '0 auto',
      // Siren flash on blocked lanes during emergency
      animation: emergencyActive && !isEmergencyLane ? 'siren-flash 1s step-start infinite' : 'none',
    }}>
      <style>{KEYFRAMES}</style>

      {/* Roads */}
      <div style={{ position: 'absolute', left: 0, right: 0, top: roadY, height: roadW, background: '#182840' }} />
      <div style={{ position: 'absolute', top: 0, bottom: 0, left: roadX, width: roadW, background: '#182840' }} />
      <div style={{ position: 'absolute', left: roadX, top: roadY, width: roadW, height: roadW, background: '#1e3050' }} />

      {/* Left-turn arrow overlay */}
      {isLeftTurnPhase && effectiveGreen && (
        <div style={{
          position: 'absolute', left: roadX + 6, top: roadY + 6,
          fontSize: 20, color: leftArrowColor, fontWeight: 900,
          lineHeight: 1, pointerEvents: 'none',
          textShadow: `0 0 8px ${meta.color}`, zIndex: 10,
        }}>↰</div>
      )}

      {/* Ambulance on the emergency lane */}
      {isEmergencyLane && emergencyActive && (
        <div style={{
          position: 'absolute',
          top: isHorizontal ? crossPx : roadY - 20,
          left: isHorizontal ? roadX - 40 : crossPx,
          transform: isHorizontal ? 'translateY(-50%)' : 'translateX(-50%)',
          animation: 'emergency-pulse 0.8s ease-in-out infinite',
          zIndex: 10,
        }}>
          <AmbulanceSVG isHorizontal={isHorizontal} />
        </div>
      )}

      {/* Moving vehicles (green and not emergency blocked) */}
      {effectiveGreen && !isLeftTurnPhase && Array.from({ length: vehicleCount }).map((_, i) => {
        const delay = i * delayStep
        const style: React.CSSProperties = isHorizontal
          ? {
            position: 'absolute', top: crossPx, left: 0,
            animation: `td-${meta.animDir} ${duration}s linear forwards`,
            animationDelay: `${delay}s`
          }
          : {
            position: 'absolute', left: crossPx, top: 0,
            animation: `td-${meta.animDir} ${duration}s linear forwards`,
            animationDelay: `${delay}s`
          }
        return (
          <div key={i} style={style}>
            <CarTopDown color={meta.color} isHorizontal={isHorizontal} />
          </div>
        )
      })}

      {/* Queued vehicles */}
      {(!effectiveGreen || isLeftTurnPhase) && Array.from({ length: Math.min(vehicleCount, 6) }).map((_, i) => {
        const GAP = 30
        const style: React.CSSProperties = isHorizontal
          ? {
            position: 'absolute', top: crossPx,
            left: meta.animDir === 'ltr'
              ? roadX - 14 - i * GAP
              : roadX + roadW + 14 + i * GAP,
            transform: 'translateY(-50%)', zIndex: 5,
          }
          : {
            position: 'absolute', left: crossPx,
            top: meta.animDir === 'ttb'
              ? roadY - 14 - i * GAP
              : roadY + roadW + 14 + i * GAP,
            transform: 'translateX(-50%)', zIndex: 5,
          }
        return (
          <div key={`q${i}`} style={style}>
            <CarTopDown color="#334155" isHorizontal={isHorizontal} />
          </div>
        )
      })}

      {/* Traffic signal dots — forced red on blocked lanes during emergency */}
      {[
        { x: roadX - 11, y: roadY - 11 },
        { x: roadX + roadW + 3, y: roadY - 11 },
        { x: roadX - 11, y: roadY + roadW + 3 },
        { x: roadX + roadW + 3, y: roadY + roadW + 3 },
      ].map((pos, i) => (
        <div key={i} style={{
          position: 'absolute', left: pos.x, top: pos.y,
          width: 8, height: 8, borderRadius: '50%',
          background: effectiveGreen ? '#22c55e' : '#ef4444',
          boxShadow: effectiveGreen
            ? '0 0 8px 3px rgba(34,197,94,0.75)'
            : '0 0 8px 3px rgba(239,68,68,0.75)',
        }} />
      ))}

      {/* Pedestrian signal inset */}
      {pedState && (
        <div style={{ position: 'absolute', left: 4, bottom: 4, zIndex: 20 }}>
          <PedestrianSignal state={pedState} />
        </div>
      )}

      {/* Compass label */}
      <div style={{
        position: 'absolute', bottom: 5, right: 7,
        fontSize: 9, fontWeight: 800, letterSpacing: 1.5,
        color: effectiveGreen ? meta.color : '#475569',
        fontFamily: 'monospace',
      }}>
        {meta.compass} {meta.arrow}
      </div>
    </div>
  )
}

// ── Emergency banner (shown at top of the emergency lane's card) ───────────────

function EmergencyBanner({
  lane, remaining, total
}: { lane: string; remaining: number; total: number }) {
  const pct = total > 0 ? (remaining / total) * 100 : 0
  return (
    <div style={{
      borderRadius: 8,
      overflow: 'hidden',
      border: '1px solid rgba(239,68,68,0.5)',
      background: 'rgba(239,68,68,0.1)',
    }}>
      {/* Label row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 8px' }}>
        <span style={{ fontSize: 14, animation: 'emergency-pulse 0.8s ease-in-out infinite' }}>🚑</span>
        <span style={{ fontSize: 11, fontWeight: 800, color: '#f87171', fontFamily: 'monospace', letterSpacing: 0.5 }}>
          EMERGENCY — {lane.toUpperCase()} PRIORITY
        </span>
        <span style={{
          marginLeft: 'auto', fontSize: 11, fontWeight: 700,
          color: remaining <= 5 ? '#fbbf24' : '#f87171', fontFamily: 'monospace',
        }}>
          {remaining}s
        </span>
      </div>
      {/* Countdown bar */}
      <div style={{ height: 3, background: 'rgba(239,68,68,0.15)' }}>
        <div style={{
          height: '100%',
          width: `${pct}%`,
          background: remaining <= 5 ? '#fbbf24' : '#ef4444',
          transition: 'width 0.25s linear, background 0.3s',
        }} />
      </div>
    </div>
  )
}

// ── Blocked banner (shown on non-emergency lanes during an emergency) ──────────

function BlockedBanner({ emergencyLane }: { emergencyLane: string }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 6,
      padding: '5px 8px', borderRadius: 8,
      border: '1px solid rgba(239,68,68,0.2)',
      background: 'rgba(239,68,68,0.06)',
    }}>
      <span style={{ fontSize: 12 }}>🔴</span>
      <span style={{ fontSize: 10, fontWeight: 700, color: '#f87171', fontFamily: 'monospace', letterSpacing: 0.4 }}>
        HELD — emergency on {emergencyLane.toUpperCase()}
      </span>
    </div>
  )
}

// ── Main Card ─────────────────────────────────────────────────────────────────

export default function SignalCard({
  lane, greenTime, vehicleCount, isGreen,
  phaseName, pedSignals, isLeftTurnPhase,
  emergencyLane = null,
  emergencyDuration = 30,
  emergencyStartedAt = null,
}: Props) {
  const key = lane.toLowerCase()
  const meta = LANE_META[key] ?? {
    arrow: '•', color: '#94a3b8', compass: lane.toUpperCase(),
    animDir: 'ltr' as const, pedCrossing: 'NS',
  }

  const isEmergencyLane = !!emergencyLane && key === emergencyLane.toLowerCase()
  const emergencyActive = !!emergencyLane

  const remaining = useEmergencyCountdown(emergencyStartedAt, emergencyDuration)

  // During emergency, forced states:
  //   emergency lane  → green
  //   all other lanes → red, ped signals all STOP
  const effectiveIsGreen = emergencyActive ? isEmergencyLane : isGreen
  const effectivePedSignals = emergencyActive
    ? Object.fromEntries(Object.keys(pedSignals ?? { NS: 'STOP', EW: 'STOP' }).map(k => [k, 'STOP' as const]))
    : pedSignals

  const pedState: 'WALK' | 'STOP' | undefined =
    effectivePedSignals ? (effectivePedSignals[meta.pedCrossing] ?? 'STOP') : undefined

  const MAX_DISPLAY = 30
  const displayCount = Math.min(vehicleCount, MAX_DISPLAY)
  const overflow = vehicleCount - MAX_DISPLAY

  const phaseMeta = phaseName ? PHASE_LABELS[phaseName] : undefined

  function MiniCar({ color }: { color: string }) {
    return (
      <svg width="20" height="10" viewBox="0 0 26 13">
        <rect x="0.5" y="1.5" width="25" height="10" rx="2" fill={color} />
      </svg>
    )
  }

  // Border colour: emergency lane → red pulsing, blocked → muted red, normal → green/red
  const borderClass = isEmergencyLane
    ? 'border-t-red-500'
    : !emergencyActive && effectiveIsGreen
      ? 'border-t-emerald-500'
      : 'border-t-red-500'

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{
        opacity: 1,
        scale: 1,
        // Subtle pulse on the emergency lane card itself
        ...(isEmergencyLane ? { boxShadow: ['0 0 0 0 rgba(239,68,68,0)', '0 0 0 6px rgba(239,68,68,0.25)', '0 0 0 0 rgba(239,68,68,0)'] } : {}),
      }}
      transition={isEmergencyLane ? { boxShadow: { repeat: Infinity, duration: 1 } } : undefined}
      className={`glass rounded-2xl p-5 flex flex-col gap-3 border-t-4 ${borderClass}`}
    >
      {/* ── Emergency banners ── */}
      <AnimatePresence>
        {isEmergencyLane && (
          <motion.div
            key="emergency-banner"
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
          >
            <EmergencyBanner lane={lane} remaining={remaining} total={emergencyDuration} />
          </motion.div>
        )}
        {emergencyActive && !isEmergencyLane && (
          <motion.div
            key="blocked-banner"
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
          >
            <BlockedBanner emergencyLane={emergencyLane!} />
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Header ── */}
      <div className="flex items-center gap-3">
        <div
          className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-black text-slate-900"
          style={{ backgroundColor: isEmergencyLane ? '#ef4444' : meta.color }}
        >
          {isEmergencyLane ? '🚑' : meta.compass}
        </div>

        <div className="flex-1">
          <h3 className="text-lg font-bold text-slate-200 capitalize">
            {lane} Lane
          </h3>
          <p className="text-xs text-slate-500">
            {vehicleCount} vehicles · {effectiveIsGreen ? greenTime : 0}s
          </p>
        </div>

        {/* Traffic light + pedestrian signal */}
        <div className="flex items-start gap-2">
          <div className="flex flex-col items-center gap-1">
            <div className="w-5 h-12 bg-slate-900 rounded-full flex flex-col items-center justify-around py-1">
              <div className={`w-3 h-3 rounded-full ${!effectiveIsGreen ? 'bg-red-500' : 'bg-red-900/30'}`} />
              <div className="w-3 h-3 rounded-full bg-yellow-900/30" />
              <div className={`w-3 h-3 rounded-full ${effectiveIsGreen ? 'bg-emerald-500' : 'bg-emerald-900/30'}`} />
            </div>
            <span className="text-slate-600" style={{ fontSize: 7, letterSpacing: 0.5, fontFamily: 'monospace' }}>
              VEH
            </span>
          </div>

          {pedState && (
            <div className="flex flex-col items-center gap-1">
              {/* During emergency all ped signals are forced STOP */}
              <PedestrianSignal state={emergencyActive ? 'STOP' : pedState} />
              <span className="text-slate-600" style={{ fontSize: 7, letterSpacing: 0.5, fontFamily: 'monospace' }}>
                PED
              </span>
            </div>
          )}
        </div>
      </div>

      {/* ── Phase badge (hidden during emergency) ── */}
      {phaseMeta && !emergencyActive && (
        <div
          className="flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs font-bold"
          style={{
            backgroundColor: `${phaseMeta.color}18`,
            border: `1px solid ${phaseMeta.color}40`,
            color: phaseMeta.color,
          }}
        >
          <span>{phaseMeta.emoji}</span>
          <span>{phaseMeta.label}</span>
          {isLeftTurnPhase && (
            <span className="ml-auto text-slate-500 font-normal">Protected</span>
          )}
        </div>
      )}

      {/* ── Intersection simulation ── */}
      <IntersectionView
        meta={meta}
        isGreen={effectiveIsGreen}
        vehicleCount={vehicleCount}
        greenTime={greenTime}
        pedState={pedState}
        isLeftTurnPhase={isLeftTurnPhase}
        isEmergencyLane={isEmergencyLane}
        emergencyActive={emergencyActive}
      />

      {/* ── Vehicle grid ── */}
      <div className="bg-slate-900/60 rounded-xl p-3 min-h-[48px]">
        {vehicleCount === 0 ? (
          <p className="text-slate-600 text-xs text-center">No vehicles</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {Array.from({ length: displayCount }).map((_, i) => (
              <MiniCar key={i} color={effectiveIsGreen ? meta.color : '#475569'} />
            ))}
            {overflow > 0 && (
              <span className="text-xs text-slate-400 ml-1">+{overflow}</span>
            )}
          </div>
        )}
      </div>

      {/* ── Progress bar ── */}
      <div className="w-full bg-slate-800 rounded-full h-1">
        <motion.div
          className="h-full"
          style={{ backgroundColor: isEmergencyLane ? '#ef4444' : meta.color }}
          initial={{ width: 0 }}
          animate={{ width: effectiveIsGreen ? '100%' : '0%' }}
          transition={{ duration: effectiveIsGreen ? greenTime : 0.3 }}
        />
      </div>
    </motion.div>
  )
}