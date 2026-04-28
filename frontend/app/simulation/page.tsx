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

const LANES = ["north", "south", "east", "west"] as const

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
  const [simComplete, setSimComplete] = useState(false)

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

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
                if (s <= 1) { clearInterval(timerRef.current!); return 0 }
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
      ws.onclose = () => { if (!destroyed) { setTimeout(connect, retryDelay); retryDelay = Math.min(retryDelay * 2, 30000) } }
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
    setSimComplete(false)
  }

  const handleDecisionData = (data: DecisionLane[], mode: string) => {
    setPrevDecisionData(decisionData)
    setDecisionData(data)
    setDecisionMode(mode)
  }

  const handleEmergencyClear = () => {
    setEmergencyLane(null)
    setEmergencySeconds(0)
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null }
    fetch("http://localhost:8000/emergency/clear", { method: "POST" }).catch(() => { })
  }

  return (
    <div style={S.root}>

      {/* ── TOPBAR ───────────────── */}
      <header style={S.topbar}>

        <div style={S.brand}>
          <div style={S.brandBadge}>SIM</div>
          <div>
            <div style={S.brandTitle}>Intersection Simulation</div>
            <div style={S.brandSub}>AI-powered adaptive traffic control</div>
          </div>
        </div>

        <div style={S.topCenter}>
          <TrafficLights activeLane={emergencyLane ?? activeLane} />
          <div style={S.statusChip}>
            {cycle.length === 0
              ? <span style={S.statusIdle}>● Idle</span>
              : simComplete
                ? <span style={S.statusDone}>✓ Cleared</span>
                : <><span style={S.pulseDot} /><span style={S.statusRun}>Running</span></>
            }
          </div>
        </div>

        <div style={S.emgPanel}>
          <span style={S.emgHeading}>EMERGENCY</span>
          <div style={S.emgRow}>
            {LANES.map(lane => {
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
                  style={{
                    ...S.emgBtn,
                    ...(isDisabled ? S.emgDisabled : isActive ? S.emgActive : S.emgIdle),
                  }}
                >
                  {lane.charAt(0).toUpperCase()}
                </button>
              )
            })}
          </div>
          {emergencyLane && (
            <button onClick={handleEmergencyClear} style={S.emgClear}>
              ✕ {emergencySeconds}s
            </button>
          )}
        </div>

      </header>

      {/* ── BODY ───────────────── */}
      <div style={S.body}>

        {/* SIDEBAR */}
        <aside style={S.sidebar}>

          {/* AI Decision FIXED */}
          {decisionData && (
            <div style={{ ...S.card, flexShrink: 0 }}>
              <button onClick={() => setAiCollapsed(v => !v)} style={S.cardHeader}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={S.cardIcon}>🧠</span>
                  <span style={S.cardTitle}>AI Decision</span>
                  <span style={{
                    ...S.modeBadge,
                    ...(decisionMode === "adaptive" ? S.badgeAdaptive : S.badgeLegacy),
                  }}>
                    {decisionMode === "adaptive" ? "ADAPTIVE" : "LEGACY"}
                  </span>
                </div>
                <span style={S.collapseArrow}>{aiCollapsed ? "▲" : "▼"}</span>
              </button>

              {!aiCollapsed && (
                <div style={{
                  ...S.cardBody,
                  maxHeight: 320,
                  overflowY: "auto"
                }}>
                  <AIDecisionPanel
                    decisionData={decisionData}
                    mode={decisionMode}
                    prevData={prevDecisionData}
                    embedded={true}
                  />
                </div>
              )}
            </div>
          )}

          {/* CONTROL PANEL FULL HEIGHT */}
          <div style={{
            ...S.card,
            flex: 1,
            overflowY: "auto"
          }}>
            <ControlPanel
              onSimulationRun={handleSimulate}
              onDecisionData={handleDecisionData}
            />
          </div>

        </aside>
        {/* MAIN CANVAS AREA */}
        <main style={S.main}>
          <div style={S.canvas}>
            {cycle.length > 0 ? (
              <VehicleSimulation
                key={simKey}
                cycle={cycle}
                emergencyLane={emergencyLane}
                onActiveLaneChange={setActiveLane}
                onEmergencyClear={handleEmergencyClear}
                onSimulationEnd={() => setSimComplete(true)}
              />
            ) : (
              <div style={S.empty}>
                <div style={S.emptyIcon}>🚦</div>
                <p style={S.emptyTitle}>No simulation running</p>
                <p style={S.emptySub}>
                  Configure lanes in the control panel and click{" "}
                  <span style={{ color: "#10b981", fontWeight: 600 }}>Run Simulation</span>
                </p>
              </div>
            )}
          </div>
        </main>

      </div>
    </div>
  )
}

/* ─────────────────────────── styles ─────────────────────────── */
const S: Record<string, React.CSSProperties> = {

  root: {
    minHeight: "100vh",
    background: "#060d1a",
    display: "flex",
    flexDirection: "column",
    fontFamily: "'Inter', system-ui, sans-serif",
    color: "#f1f5f9",
  },

  /* Topbar */
  topbar: {
    display: "grid",
    gridTemplateColumns: "1fr auto 1fr",
    alignItems: "center",
    gap: 16,
    padding: "10px 24px",
    background: "rgba(6,13,26,0.97)",
    borderBottom: "1px solid rgba(255,255,255,0.07)",
    backdropFilter: "blur(16px)",
    position: "sticky",
    top: 0,
    zIndex: 40,
    minHeight: 56,
  },

  brand: {
    display: "flex",
    alignItems: "center",
    gap: 10,
  },
  brandBadge: {
    background: "linear-gradient(135deg,#10b981,#059669)",
    color: "#fff",
    fontSize: 8,
    fontWeight: 800,
    letterSpacing: "0.14em",
    padding: "3px 7px",
    borderRadius: 5,
    flexShrink: 0,
  },
  brandTitle: { fontSize: 14, fontWeight: 700, color: "#e2e8f0", lineHeight: 1.2 },
  brandSub: { fontSize: 10, color: "#475569", marginTop: 1 },

  topCenter: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 6,
    justifySelf: "center",
  },
  statusChip: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    fontSize: 11,
    fontWeight: 600,
  },
  statusIdle: { color: "#475569" },
  statusDone: {
    color: "#34d399",
    background: "rgba(16,185,129,0.1)",
    border: "1px solid rgba(16,185,129,0.2)",
    padding: "2px 10px",
    borderRadius: 20,
  },
  statusRun: { color: "#60a5fa" },
  pulseDot: {
    width: 6,
    height: 6,
    borderRadius: "50%",
    background: "#60a5fa",
    boxShadow: "0 0 6px 2px rgba(96,165,250,0.5)",
    flexShrink: 0,
  },

  /* Emergency */
  emgPanel: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    justifySelf: "end",
  },
  emgHeading: {
    fontSize: 8,
    fontWeight: 700,
    letterSpacing: "0.12em",
    color: "#374151",
    textTransform: "uppercase" as const,
  },
  emgRow: { display: "flex", gap: 4 },
  emgBtn: {
    width: 30,
    height: 30,
    borderRadius: 8,
    fontSize: 11,
    fontWeight: 800,
    border: "1px solid transparent",
    cursor: "pointer",
    transition: "all 0.15s",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    letterSpacing: "0.02em",
  },
  emgIdle: {
    background: "rgba(239,68,68,0.07)",
    color: "#f87171",
    borderColor: "rgba(239,68,68,0.2)",
  },
  emgActive: { background: "#ef4444", color: "#fff", borderColor: "#ef4444" },
  emgDisabled: {
    background: "rgba(255,255,255,0.02)",
    color: "#1e293b",
    borderColor: "rgba(255,255,255,0.04)",
    cursor: "not-allowed",
  },
  emgClear: {
    background: "rgba(239,68,68,0.1)",
    color: "#fca5a5",
    border: "1px solid rgba(239,68,68,0.22)",
    borderRadius: 8,
    padding: "4px 10px",
    fontSize: 11,
    fontWeight: 600,
    cursor: "pointer",
    whiteSpace: "nowrap" as const,
  },

  /* Body */
  body: {
    flex: 1,
    display: "flex",
    alignItems: "flex-start",
    overflow: "hidden",
  },

  /* 🔥 UPDATED SIDEBAR FIX */
  sidebar: {
    width: 360,
    flexShrink: 0,
    display: "flex",
    flexDirection: "column",
    gap: 10,
    padding: "16px 14px 16px 18px",
    position: "sticky",
    top: 56,
    height: "calc(100vh - 56px)",   // ✅ FIXED
    borderRight: "1px solid rgba(255,255,255,0.05)",
  },

  card: {
    background: "rgba(10,18,34,0.9)",
    border: "1px solid rgba(255,255,255,0.07)",
    borderRadius: 12,
    overflow: "hidden",
  },
  cardHeader: {
    width: "100%",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "10px 14px",
    background: "transparent",
    border: "none",
    cursor: "pointer",
    color: "#94a3b8",
  },
  cardIcon: { fontSize: 13 },
  cardTitle: { fontSize: 12, fontWeight: 700, color: "#cbd5e1" },
  cardBody: { borderTop: "1px solid rgba(255,255,255,0.05)" },
  collapseArrow: { fontSize: 9, color: "#334155" },

  modeBadge: {
    fontSize: 8,
    fontWeight: 700,
    padding: "2px 6px",
    borderRadius: 4,
    letterSpacing: "0.06em",
  },
  badgeAdaptive: {
    background: "rgba(96,165,250,0.1)",
    color: "#60a5fa",
    border: "1px solid rgba(96,165,250,0.22)",
  },
  badgeLegacy: {
    background: "rgba(168,85,247,0.1)",
    color: "#a78bfa",
    border: "1px solid rgba(168,85,247,0.22)",
  },

  /* Main */
  main: {
    flex: 1,
    padding: "16px 20px",
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
  },

  canvas: {
    flex: 1,
    background: "rgba(10,18,34,0.5)",
    border: "1px solid rgba(255,255,255,0.06)",
    borderRadius: 14,
    overflow: "hidden",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    minHeight: 460,
  },

  empty: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    padding: "64px 32px",
    textAlign: "center" as const,
    gap: 10,
  },
  emptyIcon: { fontSize: 48, opacity: 0.25, marginBottom: 6 },
  emptyTitle: { fontSize: 15, fontWeight: 600, color: "#334155", margin: 0 },
  emptySub: { fontSize: 12, color: "#1e3a5f", margin: 0, maxWidth: 260, lineHeight: 1.7 },
}