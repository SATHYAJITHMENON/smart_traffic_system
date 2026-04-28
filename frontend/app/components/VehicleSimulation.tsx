"use client"
import { useEffect, useRef, useState, useCallback } from "react"

type Lane = "north" | "south" | "east" | "west"
type TurnDir = "straight" | "left" | "right"

type Vehicle = {
    id: string
    lane: Lane
    turn: TurnDir
    x: number
    y: number
    crossed: boolean
    offset: number
    queueIdx: number
    turning: boolean
    arcAngle: number
    arcDone: boolean
    exitDx: number
    exitDy: number
    exitLanePos: number
    isAmbulance?: boolean
    // For smooth approach-speed interpolation
    speed?: number
}

type Phase = {
    lane: Lane
    green_time: number
    vehicle_count: number
    sub_lanes?: { straight: number; left: number; right: number }
}

type Props = {
    cycle: Phase[]
    emergencyLane?: Lane | null
    onSimulationEnd?: () => void
    onActiveLaneChange?: (lane: Lane | null) => void
    onEmergencyClear?: () => void
}

const W = 640
const H = 560
const CX = W / 2
const CY = H / 2
const RH = 44           // half road width
const LANE_W = 22       // single lane width
const LANE_OFFSET = 11  // centre of inner lane from road centre

const SPEED = 3.8
const AMBULANCE_SPEED = 9
const SLOW_SPEED = 2.4
const SPACING = 38
const SAFE_DIST = 36
const TICK = 50

const SUB_LANE: Record<TurnDir, number> = { left: -12, straight: 0, right: 12 }

// ─── Lane colours ─────────────────────────────────────────────────────────────
const LANE_COLORS: Record<Lane, string> = {
    north: "#10b981",
    south: "#3b82f6",
    east: "#f59e0b",
    west: "#ec4899",
}
const LANE_GLOW: Record<Lane, string> = {
    north: "#10b98155",
    south: "#3b82f655",
    east: "#f59e0b55",
    west: "#ec489955",
}
const TURN_BADGE: Record<TurnDir, string> = { straight: "↑", left: "←", right: "→" }

// ─── Geometry helpers ─────────────────────────────────────────────────────────
type Pt = { x: number; y: number }

function stopLine(lane: Lane): number {
    if (lane === "north") return CY - RH - 6
    if (lane === "south") return CY + RH + 6
    if (lane === "east") return CX + RH + 6
    return CX - RH - 6
}

function hasCrossed(lane: Lane, x: number, y: number): boolean {
    const B = 55
    if (lane === "north") return y > CY + RH + B
    if (lane === "south") return y < CY - RH - B
    if (lane === "east") return x < CX - RH - B
    return x > CX + RH + B
}

function isOffCanvas(x: number, y: number): boolean {
    return x < -220 || x > W + 220 || y < -220 || y > H + 220
}

function getEntryExit(lane: Lane, turn: TurnDir): { entry: Pt; exit: Pt } | null {
    if (turn === "straight") return null
    const N: Pt = { x: CX - LANE_OFFSET, y: CY - RH - 6 }
    const S: Pt = { x: CX + LANE_OFFSET, y: CY + RH + 6 }
    const E: Pt = { x: CX + RH + 6, y: CY - LANE_OFFSET }
    const W_: Pt = { x: CX - RH - 6, y: CY + LANE_OFFSET }
    const M = RH + 6
    const EN: Pt = { x: CX + LANE_OFFSET, y: CY - M }
    const ES: Pt = { x: CX - LANE_OFFSET, y: CY + M }
    const EE: Pt = { x: CX + M, y: CY + LANE_OFFSET }
    const EW: Pt = { x: CX - M, y: CY - LANE_OFFSET }
    if (lane === "north") return turn === "right" ? { entry: N, exit: EE } : { entry: N, exit: EW }
    if (lane === "south") return turn === "right" ? { entry: S, exit: EW } : { entry: S, exit: EE }
    if (lane === "east") return turn === "right" ? { entry: E, exit: EN } : { entry: E, exit: ES }
    return turn === "right" ? { entry: W_, exit: ES } : { entry: W_, exit: EN }
}

type ArcDef = { cx: number; cy: number; r: number; startA: number; sweepA: number }

function computeArc(lane: Lane, turn: TurnDir): ArcDef | null {
    const pts = getEntryExit(lane, turn)
    if (!pts) return null
    const { entry, exit } = pts
    let acx: number, acy: number
    if (lane === "north" || lane === "south") { acx = entry.x; acy = exit.y }
    else { acx = exit.x; acy = entry.y }
    const r = Math.hypot(entry.x - acx, entry.y - acy)
    const startA = Math.atan2(entry.y - acy, entry.x - acx)
    const cross = (entry.x - acx) * (exit.y - acy) - (entry.y - acy) * (exit.x - acx)
    const sweepA = cross > 0 ? Math.PI / 2 : -Math.PI / 2
    return { cx: acx, cy: acy, r, startA, sweepA }
}

type ExitInfo = { dx: number; dy: number; lanePos: number }

function getExitInfo(lane: Lane, turn: TurnDir): ExitInfo {
    if (turn === "straight") {
        if (lane === "north") return { dx: 0, dy: 1, lanePos: CX - LANE_OFFSET }
        if (lane === "south") return { dx: 0, dy: -1, lanePos: CX + LANE_OFFSET }
        if (lane === "east") return { dx: -1, dy: 0, lanePos: CY - LANE_OFFSET }
        return { dx: 1, dy: 0, lanePos: CY + LANE_OFFSET }
    }
    if (lane === "north" && turn === "right") return { dx: 1, dy: 0, lanePos: CY + LANE_OFFSET }
    if (lane === "north" && turn === "left") return { dx: -1, dy: 0, lanePos: CY - LANE_OFFSET }
    if (lane === "south" && turn === "right") return { dx: -1, dy: 0, lanePos: CY - LANE_OFFSET }
    if (lane === "south" && turn === "left") return { dx: 1, dy: 0, lanePos: CY + LANE_OFFSET }
    if (lane === "east" && turn === "right") return { dx: 0, dy: -1, lanePos: CX + LANE_OFFSET }
    if (lane === "east" && turn === "left") return { dx: 0, dy: 1, lanePos: CX - LANE_OFFSET }
    if (lane === "west" && turn === "right") return { dx: 0, dy: 1, lanePos: CX - LANE_OFFSET }
    return { dx: 0, dy: -1, lanePos: CX + LANE_OFFSET }
}

// ─── aheadDist: considers lateral offset (sub-lane) so cars in adjacent
//     sub-lanes don't ghost-brake each other                               ──────
function aheadDist(v: Vehicle, others: Vehicle[]): number {
    let minD = Infinity
    const LATERAL_THRESHOLD = 8
    for (const f of others) {
        if (f.id === v.id || f.lane !== v.lane || f.crossed) continue
        // Only consider vehicles in roughly the same sub-lane
        const lateralDiff =
            (v.lane === "north" || v.lane === "south")
                ? Math.abs(f.x - v.x)
                : Math.abs(f.y - v.y)
        if (lateralDiff > LATERAL_THRESHOLD) continue

        let d = Infinity
        if (v.lane === "north" && f.y > v.y) d = f.y - v.y
        if (v.lane === "south" && f.y < v.y) d = v.y - f.y
        if (v.lane === "east" && f.x < v.x) d = v.x - f.x
        if (v.lane === "west" && f.x > v.x) d = f.x - v.x
        if (d < minD) minD = d
    }
    return minD
}

function assignTurns(count: number, sub?: Phase["sub_lanes"]): TurnDir[] {
    const turns: TurnDir[] = []
    if (sub) {
        for (let i = 0; i < sub.straight; i++) turns.push("straight")
        for (let i = 0; i < sub.left; i++) turns.push("left")
        for (let i = 0; i < sub.right; i++) turns.push("right")
        while (turns.length < count) turns.push("straight")
        return turns.slice(0, count)
    }
    for (let i = 0; i < count; i++) {
        const r = Math.random()
        turns.push(r < 0.60 ? "straight" : r < 0.85 ? "left" : "right")
    }
    return turns
}

function spawnAll(cycle: Phase[]): Vehicle[] {
    const all: Vehicle[] = []
    for (const ph of cycle) {
        const { lane, vehicle_count } = ph
        const turns = assignTurns(vehicle_count, ph.sub_lanes)
        const byTurn: Record<TurnDir, number[]> = { left: [], straight: [], right: [] }
        turns.forEach((t, i) => byTurn[t].push(i))
        for (let i = 0; i < vehicle_count; i++) {
            const turn = turns[i]
            const lateralOffset = SUB_LANE[turn]
            const rankInGroup = byTurn[turn].indexOf(i)
            const dist = (rankInGroup + 1) * SPACING
            let x = 0, y = 0
            if (lane === "north") { x = CX - LANE_OFFSET + lateralOffset; y = CY - RH - 6 - dist }
            if (lane === "south") { x = CX + LANE_OFFSET + lateralOffset; y = CY + RH + 6 + dist }
            if (lane === "east") { x = CX + RH + 6 + dist; y = CY - LANE_OFFSET + lateralOffset }
            if (lane === "west") { x = CX - RH - 6 - dist; y = CY + LANE_OFFSET + lateralOffset }
            const ei = getExitInfo(lane, "straight")
            all.push({
                id: `${lane}-${i}`, lane, turn, x, y,
                crossed: false, offset: lateralOffset, queueIdx: rankInGroup,
                turning: false, arcAngle: 0, arcDone: false,
                exitDx: ei.dx, exitDy: ei.dy, exitLanePos: ei.lanePos,
                speed: SPEED,
            })
        }
    }
    return all
}

function spawnAmbulance(lane: Lane): Vehicle {
    const ei = getExitInfo(lane, "straight")
    const DIST = SPACING * 10
    let x = 0, y = 0
    if (lane === "north") { x = CX - LANE_OFFSET; y = CY - RH - 6 - DIST }
    if (lane === "south") { x = CX + LANE_OFFSET; y = CY + RH + 6 + DIST }
    if (lane === "east") { x = CX + RH + 6 + DIST; y = CY - LANE_OFFSET }
    if (lane === "west") { x = CX - RH - 6 - DIST; y = CY + LANE_OFFSET }
    return {
        id: `ambulance-${lane}`, lane, turn: "straight", x, y,
        crossed: false, offset: 0, queueIdx: 0,
        turning: false, arcAngle: 0, arcDone: false,
        exitDx: ei.dx, exitDy: ei.dy, exitLanePos: ei.lanePos,
        isAmbulance: true, speed: AMBULANCE_SPEED,
    }
}

// ─── Canvas draw helpers ──────────────────────────────────────────────────────
function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
    ctx.beginPath()
    ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y)
    ctx.arcTo(x + w, y, x + w, y + r, r); ctx.lineTo(x + w, y + h - r)
    ctx.arcTo(x + w, y + h, x + w - r, y + h, r); ctx.lineTo(x + r, y + h)
    ctx.arcTo(x, y + h, x, y + h - r, r); ctx.lineTo(x, y + r)
    ctx.arcTo(x, y, x + r, y, r); ctx.closePath()
}

const arcCache = new Map<string, ArcDef>()

// ─── Component ────────────────────────────────────────────────────────────────
export default function VehicleSimulation({
    cycle,
    emergencyLane = null,
    onSimulationEnd,
    onActiveLaneChange,
    onEmergencyClear,
}: Props) {
    const canvasRef = useRef<HTMLCanvasElement>(null)
    const vehiclesRef = useRef<Vehicle[]>([])
    const activeLaneRef = useRef<Lane | null>(null)
    const crossedRef = useRef(0)
    const phaseTargetRef = useRef(0)
    const phaseIdxRef = useRef(0)
    const simActiveRef = useRef(false)
    const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
    const flashRef = useRef(false)
    const emergencyLaneRef = useRef<Lane | null>(emergencyLane)
    const onEmergencyClearRef = useRef(onEmergencyClear)
    useEffect(() => { onEmergencyClearRef.current = onEmergencyClear }, [onEmergencyClear])

    const [displayPhase, setDisplayPhase] = useState(0)
    const [displayCrossed, setDisplayCrossed] = useState(0)
    const [displayTarget, setDisplayTarget] = useState(0)
    const [activeLane, setActiveLane] = useState<Lane | null>(null)
    const [simDone, setSimDone] = useState(false)
    const [simStarted, setSimStarted] = useState(false)

    // ── draw ──────────────────────────────────────────────────────────────────
    const draw = useCallback(() => {
        const canvas = canvasRef.current; if (!canvas) return
        const ctx = canvas.getContext("2d"); if (!ctx) return

        const vehicles = vehiclesRef.current
        const emergency = emergencyLaneRef.current
        const active = emergency ?? activeLaneRef.current

        ctx.clearRect(0, 0, W, H)

        // ── Background ───────────────────────────────────────────────────────
        ctx.fillStyle = "#0a0f1a"
        ctx.fillRect(0, 0, W, H)

        // Subtle grid
        ctx.strokeStyle = "rgba(255,255,255,0.025)"
        ctx.lineWidth = 1
        for (let gx = 0; gx <= W; gx += 40) { ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, H); ctx.stroke() }
        for (let gy = 0; gy <= H; gy += 40) { ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(W, gy); ctx.stroke() }

        // ── Road surface ─────────────────────────────────────────────────────
        const drawRoadSegment = (x: number, y: number, w: number, h: number) => {
            const g = ctx.createLinearGradient(x, y, x + w, y + h)
            g.addColorStop(0, "#1a2235")
            g.addColorStop(0.5, "#1e2a3d")
            g.addColorStop(1, "#1a2235")
            ctx.fillStyle = g
            ctx.fillRect(x, y, w, h)
        }
        drawRoadSegment(0, CY - RH, W, RH * 2) // horizontal
        drawRoadSegment(CX - RH, 0, RH * 2, H)      // vertical

        // Intersection box (slightly lighter)
        ctx.fillStyle = "#202d42"
        ctx.fillRect(CX - RH, CY - RH, RH * 2, RH * 2)

        // ── Curb lines ───────────────────────────────────────────────────────
        ctx.strokeStyle = "rgba(255,255,255,0.18)"
        ctx.lineWidth = 1.5
        // horizontal road edges
        ctx.beginPath(); ctx.moveTo(0, CY - RH); ctx.lineTo(CX - RH, CY - RH); ctx.stroke()
        ctx.beginPath(); ctx.moveTo(CX + RH, CY - RH); ctx.lineTo(W, CY - RH); ctx.stroke()
        ctx.beginPath(); ctx.moveTo(0, CY + RH); ctx.lineTo(CX - RH, CY + RH); ctx.stroke()
        ctx.beginPath(); ctx.moveTo(CX + RH, CY + RH); ctx.lineTo(W, CY + RH); ctx.stroke()
        // vertical road edges
        ctx.beginPath(); ctx.moveTo(CX - RH, 0); ctx.lineTo(CX - RH, CY - RH); ctx.stroke()
        ctx.beginPath(); ctx.moveTo(CX - RH, CY + RH); ctx.lineTo(CX - RH, H); ctx.stroke()
        ctx.beginPath(); ctx.moveTo(CX + RH, 0); ctx.lineTo(CX + RH, CY - RH); ctx.stroke()
        ctx.beginPath(); ctx.moveTo(CX + RH, CY + RH); ctx.lineTo(CX + RH, H); ctx.stroke()

        // ── Centre-line dashes ───────────────────────────────────────────────
        ctx.strokeStyle = "rgba(255,255,255,0.13)"
        ctx.lineWidth = 1
        ctx.setLineDash([12, 14])
        // Horizontal centre line (left of intersection)
        ctx.beginPath(); ctx.moveTo(0, CY); ctx.lineTo(CX - RH, CY); ctx.stroke()
        // Horizontal centre line (right of intersection)
        ctx.beginPath(); ctx.moveTo(CX + RH, CY); ctx.lineTo(W, CY); ctx.stroke()
        // Vertical centre line (above intersection)
        ctx.beginPath(); ctx.moveTo(CX, 0); ctx.lineTo(CX, CY - RH); ctx.stroke()
        // Vertical centre line (below intersection)
        ctx.beginPath(); ctx.moveTo(CX, CY + RH); ctx.lineTo(CX, H); ctx.stroke()
        ctx.setLineDash([])

        // ── Stop lines ───────────────────────────────────────────────────────
        const drawStopLine = (lane: Lane, isGreen: boolean) => {
            const sl = stopLine(lane)
            ctx.strokeStyle = isGreen ? "#22c55e" : "rgba(255,255,255,0.3)"
            ctx.lineWidth = isGreen ? 2.5 : 1.5
            if (lane === "north") { ctx.beginPath(); ctx.moveTo(CX - RH + 2, sl); ctx.lineTo(CX, sl); ctx.stroke() }
            if (lane === "south") { ctx.beginPath(); ctx.moveTo(CX, sl); ctx.lineTo(CX + RH - 2, sl); ctx.stroke() }
            if (lane === "east") { ctx.beginPath(); ctx.moveTo(sl, CY - RH + 2); ctx.lineTo(sl, CY); ctx.stroke() }
            if (lane === "west") { ctx.beginPath(); ctx.moveTo(sl, CY); ctx.lineTo(sl, CY + RH - 2); ctx.stroke() }
        }
            ; (["north", "south", "east", "west"] as Lane[]).forEach(ln =>
                drawStopLine(ln, ln === active && !emergency)
            )

        // ── Zebra crossings ──────────────────────────────────────────────────
        ctx.fillStyle = "rgba(255,255,255,0.07)"
        for (let i = -4; i <= 3; i++) {
            ctx.fillRect(CX - RH - 10, CY + i * 6 + 1, 8, 3)   // west side
            ctx.fillRect(CX + RH + 2, CY + i * 6 + 1, 8, 3)   // east side
            ctx.fillRect(CX + i * 6 + 1, CY - RH - 10, 3, 8)   // north side
            ctx.fillRect(CX + i * 6 + 1, CY + RH + 2, 3, 8)   // south side
        }

        // ── Active-lane road glow ────────────────────────────────────────────
        if (active) {
            ctx.save()
            const col = emergency ? "#ef4444" : LANE_COLORS[active]
            ctx.globalAlpha = 0.06
            ctx.fillStyle = col
            if (active === "north" || active === "south") ctx.fillRect(CX - RH, 0, RH * 2, H)
            else ctx.fillRect(0, CY - RH, W, RH * 2)
            ctx.restore()
        }

        // ── Traffic lights ───────────────────────────────────────────────────
        type LightDef = { lane: Lane; x: number; y: number }
        const lights: LightDef[] = [
            { lane: "north", x: CX - 20, y: CY - RH - 20 },
            { lane: "south", x: CX + 8, y: CY + RH + 4 },
            { lane: "east", x: CX + RH + 4, y: CY - 20 },
            { lane: "west", x: CX - RH - 18, y: CY + 8 },
        ]
        lights.forEach(({ lane: ln, x: lx, y: ly }) => {
            const isGreen = ln === active
            const col = isGreen ? LANE_COLORS[ln] : "#ef4444"

            // Housing
            ctx.fillStyle = "#0d1526"
            ctx.strokeStyle = "rgba(255,255,255,0.12)"
            ctx.lineWidth = 1
            roundRect(ctx, lx, ly, 14, 32, 4)
            ctx.fill(); ctx.stroke()

            // Red light (always shown dimly)
            ctx.beginPath()
            ctx.arc(lx + 7, ly + 9, 4, 0, Math.PI * 2)
            ctx.fillStyle = isGreen ? "rgba(239,68,68,0.25)" : "#ef4444"
            ctx.fill()

            // Green light
            ctx.beginPath()
            ctx.arc(lx + 7, ly + 23, 4, 0, Math.PI * 2)
            ctx.fillStyle = isGreen ? col : "rgba(34,197,94,0.2)"
            ctx.fill()

            // Glow on active light
            if (isGreen) {
                ctx.save()
                ctx.shadowColor = col
                ctx.shadowBlur = 12
                ctx.beginPath()
                ctx.arc(lx + 7, ly + 23, 4, 0, Math.PI * 2)
                ctx.fillStyle = col
                ctx.fill()
                ctx.restore()
            }
        })

        // ── Direction labels ─────────────────────────────────────────────────
        ctx.save()
        ctx.font = "bold 11px 'SF Mono', monospace"
        ctx.textAlign = "center"

        const labelDefs: [string, number, number, Lane][] = [
            ["▲ NORTH", CX, CY - RH - 36, "north"],
            ["▼ SOUTH", CX, CY + RH + 44, "south"],
            ["▶ EAST", CX + RH + 52, CY + 4, "east"],
            ["◀ WEST", CX - RH - 52, CY + 4, "west"],
        ]
        labelDefs.forEach(([label, lx, ly, ln]) => {
            const isActive = ln === active
            ctx.fillStyle = isActive ? LANE_COLORS[ln] : "rgba(148,163,184,0.55)"
            if (isActive) {
                ctx.save()
                ctx.shadowColor = LANE_COLORS[ln]
                ctx.shadowBlur = 8
                ctx.fillText(label, lx, ly)
                ctx.restore()
            } else {
                ctx.fillText(label, lx, ly)
            }
        })
        ctx.restore()

        // ── Vehicles ─────────────────────────────────────────────────────────
        for (const v of vehicles) {
            ctx.save()

            const isActive = v.lane === active || v.isAmbulance
            const VW = 11, VH = 17

            // Determine orientation based on movement direction
            let angle = 0
            if (v.crossed) {
                // Use exit direction
                if (v.exitDx !== 0) angle = v.exitDx > 0 ? Math.PI / 2 : -Math.PI / 2
                else angle = v.exitDy > 0 ? 0 : Math.PI
            } else if (v.turning && !v.arcDone) {
                const arc = arcCache.get(v.id)
                if (arc) {
                    const totalSweep = Math.abs(arc.sweepA)
                    const fraction = Math.min(1, v.arcAngle / totalSweep)
                    const currentA = arc.startA + arc.sweepA * fraction
                    const tangentA = currentA + (arc.sweepA > 0 ? Math.PI / 2 : -Math.PI / 2)
                    angle = tangentA
                }
            } else {
                if (v.lane === "north") angle = 0
                if (v.lane === "south") angle = Math.PI
                if (v.lane === "east") angle = -Math.PI / 2
                if (v.lane === "west") angle = Math.PI / 2
            }

            ctx.translate(v.x, v.y)
            ctx.rotate(angle)

            if (v.isAmbulance) {
                // White ambulance body
                ctx.shadowColor = flashRef.current ? "#ef4444" : "#ff000044"
                ctx.shadowBlur = flashRef.current ? 20 : 8
                ctx.fillStyle = "#f8fafc"
                roundRect(ctx, -VW / 2, -VH / 2, VW, VH, 3)
                ctx.fill()

                // Red cross
                ctx.fillStyle = "#dc2626"
                ctx.fillRect(-1.5, -VH / 2 + 3, 3, VH - 6)
                ctx.fillRect(-VW / 2 + 2, -1.5, VW - 4, 3)

                // Beacon flash
                if (flashRef.current) {
                    ctx.fillStyle = "#ef4444"
                    ctx.shadowColor = "#ef4444"
                    ctx.shadowBlur = 16
                    ctx.beginPath(); ctx.arc(-3, -VH / 2 - 4, 3, 0, Math.PI * 2); ctx.fill()
                    ctx.fillStyle = "#3b82f6"
                    ctx.shadowColor = "#3b82f6"
                    ctx.beginPath(); ctx.arc(3, -VH / 2 - 4, 3, 0, Math.PI * 2); ctx.fill()
                }
            } else {
                const col = LANE_COLORS[v.lane]

                if (isActive) {
                    ctx.shadowColor = col
                    ctx.shadowBlur = 8

                    // Body gradient (top-to-bottom in vehicle space)
                    const g = ctx.createLinearGradient(0, -VH / 2, 0, VH / 2)
                    g.addColorStop(0, col)
                    g.addColorStop(1, "#0f172a")
                    ctx.fillStyle = g
                } else {
                    ctx.shadowBlur = 0
                    ctx.fillStyle = "rgba(100,116,139,0.35)"
                }

                roundRect(ctx, -VW / 2, -VH / 2, VW, VH, 3)
                ctx.fill()

                if (isActive) {
                    // Windscreen highlight
                    ctx.fillStyle = "rgba(255,255,255,0.18)"
                    roundRect(ctx, -VW / 2 + 2, -VH / 2 + 2, VW - 4, 5, 1)
                    ctx.fill()

                    // Headlights
                    ctx.fillStyle = "rgba(255,255,220,0.9)"
                    ctx.beginPath(); ctx.arc(-VW / 2 + 2, VH / 2 - 2, 1.5, 0, Math.PI * 2); ctx.fill()
                    ctx.beginPath(); ctx.arc(VW / 2 - 2, VH / 2 - 2, 1.5, 0, Math.PI * 2); ctx.fill()
                }
            }

            ctx.restore()
        }

    }, [])

    // ── activatePhase ─────────────────────────────────────────────────────────
    const activatePhase = useCallback((idx: number) => {
        if (!cycle[idx]) return
        const ph = cycle[idx]
        activeLaneRef.current = ph.lane
        phaseTargetRef.current = Math.max(ph.vehicle_count, 1)
        crossedRef.current = 0
        setActiveLane(ph.lane)
        onActiveLaneChange?.(ph.lane)
        setDisplayPhase(idx)
        setDisplayTarget(ph.vehicle_count)
        setDisplayCrossed(0)
    }, [cycle, onActiveLaneChange])

    const activatePhaseRef = useRef(activatePhase)
    useEffect(() => { activatePhaseRef.current = activatePhase }, [activatePhase])

    // ── Emergency lane effect ─────────────────────────────────────────────────
    useEffect(() => {
        emergencyLaneRef.current = emergencyLane
        if (emergencyLane) {
            const already = vehiclesRef.current.some(v => v.isAmbulance && v.lane === emergencyLane)
            if (!already) vehiclesRef.current = [...vehiclesRef.current, spawnAmbulance(emergencyLane)]
        } else {
            vehiclesRef.current = vehiclesRef.current.filter(v => !v.isAmbulance)
            if (cycle && cycle.length > 0) {
                const safeIdx = Math.min(phaseIdxRef.current, cycle.length - 1)
                phaseIdxRef.current = safeIdx
                simActiveRef.current = true
                setSimDone(false)
                activatePhaseRef.current(safeIdx)
            }
        }
    }, [emergencyLane])

    // ── Main simulation loop ──────────────────────────────────────────────────
    useEffect(() => {
        if (!cycle || cycle.length === 0) return
        if (intervalRef.current) clearInterval(intervalRef.current)

        arcCache.clear()
        vehiclesRef.current = spawnAll(cycle)
        activeLaneRef.current = null
        crossedRef.current = 0
        phaseTargetRef.current = 0
        phaseIdxRef.current = 0
        simActiveRef.current = true

        setSimDone(false); setSimStarted(true); setDisplayPhase(0); setDisplayCrossed(0); setActiveLane(null)
        onActiveLaneChange?.(null)
        setTimeout(() => activatePhase(0), 600)

        let flashTick = 0

        intervalRef.current = setInterval(() => {
            if (!simActiveRef.current) return

            flashTick++
            if (flashTick % 4 === 0) flashRef.current = !flashRef.current

            const emergency = emergencyLaneRef.current
            const active = emergency ?? activeLaneRef.current
            let newCrossed = 0
            const next: Vehicle[] = []

            for (const v of vehiclesRef.current) {

                // ── Already crossed: drive to canvas edge ─────────────────
                if (v.crossed) {
                    const spd = v.isAmbulance ? AMBULANCE_SPEED : SPEED
                    let x = v.x + v.exitDx * spd
                    let y = v.y + v.exitDy * spd
                    if (v.exitDx !== 0) y = v.exitLanePos
                    else x = v.exitLanePos
                    if (!isOffCanvas(x, y)) next.push({ ...v, x, y })
                    continue
                }

                // ── Ambulance: always runs the signal ─────────────────────
                if (v.isAmbulance) {
                    let { x, y } = v
                    if (v.lane === "north") { y += AMBULANCE_SPEED; x = CX - LANE_OFFSET }
                    if (v.lane === "south") { y -= AMBULANCE_SPEED; x = CX + LANE_OFFSET }
                    if (v.lane === "east") { x -= AMBULANCE_SPEED; y = CY - LANE_OFFSET }
                    if (v.lane === "west") { x += AMBULANCE_SPEED; y = CY + LANE_OFFSET }
                    if (hasCrossed(v.lane, x, y) && !v.crossed) {
                        onEmergencyClearRef.current?.()
                        const ei = getExitInfo(v.lane, "straight")
                        next.push({ ...v, x, y, crossed: true, exitDx: ei.dx, exitDy: ei.dy, exitLanePos: ei.lanePos })
                    } else if (!isOffCanvas(x, y)) {
                        next.push({ ...v, x, y })
                    }
                    continue
                }

                // ── Red / frozen: queue behind stop line or complete arc ───
                const isFrozen = emergency ? v.lane !== emergency : v.lane !== active
                if (isFrozen) {
                    const sl = stopLine(v.lane)
                    let pastStop = false
                    if (v.lane === "north") pastStop = v.y >= sl
                    if (v.lane === "south") pastStop = v.y <= sl
                    if (v.lane === "east") pastStop = v.x <= sl
                    if (v.lane === "west") pastStop = v.x >= sl

                    // Let vehicles that have passed the stop line or are mid-arc continue
                    if (pastStop || v.turning) {
                        if (v.turn === "straight" || (v.turning && !v.arcDone)) {
                            // Continue to complete mid-intersection movement
                            if (v.turning) {
                                // fall through to arc logic below by re-queueing as non-frozen
                                // (handled in the arc section — push as-is, arc will run next tick)
                                next.push(v)
                            } else {
                                let { x, y } = v
                                if (v.lane === "north") { y += SPEED; x = CX - LANE_OFFSET }
                                if (v.lane === "south") { y -= SPEED; x = CX + LANE_OFFSET }
                                if (v.lane === "east") { x -= SPEED; y = CY - LANE_OFFSET }
                                if (v.lane === "west") { x += SPEED; y = CY + LANE_OFFSET }
                                if (!isOffCanvas(x, y)) next.push({ ...v, x, y, crossed: hasCrossed(v.lane, x, y) })
                            }
                        } else {
                            next.push(v)
                        }
                        continue
                    }

                    // Slow creep to queue position
                    let distToStop = Infinity
                    if (v.lane === "north") distToStop = sl - v.y
                    if (v.lane === "south") distToStop = v.y - sl
                    if (v.lane === "east") distToStop = v.x - sl
                    if (v.lane === "west") distToStop = sl - v.x

                    const gap = aheadDist(v, vehiclesRef.current)
                    const targetDist = (v.queueIdx + 1) * SPACING
                    if (distToStop > targetDist && gap > SAFE_DIST) {
                        let { x, y } = v
                        const spd = Math.min(SLOW_SPEED, distToStop - targetDist)
                        if (v.lane === "north") { y += spd; x = CX - LANE_OFFSET + v.offset }
                        if (v.lane === "south") { y -= spd; x = CX + LANE_OFFSET + v.offset }
                        if (v.lane === "east") { x -= spd; y = CY - LANE_OFFSET + v.offset }
                        if (v.lane === "west") { x += spd; y = CY + LANE_OFFSET + v.offset }
                        next.push({ ...v, x, y })
                    } else {
                        next.push(v)
                    }
                    continue
                }

                // ── Green: straight ──────────────────────────────────────
                if (v.turn === "straight") {
                    const gap = aheadDist(v, vehiclesRef.current)
                    let spd = SPEED
                    if (gap < SAFE_DIST) {
                        if (gap < 4) { next.push(v); continue }
                        spd = SPEED * (gap / SAFE_DIST) * 0.85
                    }
                    let { x, y } = v
                    if (v.lane === "north") { y += spd; x = CX - LANE_OFFSET }
                    if (v.lane === "south") { y -= spd; x = CX + LANE_OFFSET }
                    if (v.lane === "east") { x -= spd; y = CY - LANE_OFFSET }
                    if (v.lane === "west") { x += spd; y = CY + LANE_OFFSET }
                    const crossed = hasCrossed(v.lane, x, y) || isOffCanvas(x, y)
                    if (crossed) newCrossed++
                    next.push({ ...v, x, y, crossed })
                    continue
                }

                // ── Green: turning — approach ───────────────────────────
                if (!v.turning) {
                    const sl = stopLine(v.lane)
                    let distToLine = Infinity
                    if (v.lane === "north") distToLine = sl - v.y
                    if (v.lane === "south") distToLine = v.y - sl
                    if (v.lane === "east") distToLine = v.x - sl
                    if (v.lane === "west") distToLine = sl - v.x

                    if (distToLine > 2) {
                        const gap = aheadDist(v, vehiclesRef.current)
                        let spd = SPEED
                        if (gap < SAFE_DIST) {
                            if (gap < 4) { next.push(v); continue }
                            spd = SPEED * (gap / SAFE_DIST) * 0.85
                        }
                        let { x, y } = v
                        if (v.lane === "north") { y += spd; x = CX - LANE_OFFSET + v.offset }
                        if (v.lane === "south") { y -= spd; x = CX + LANE_OFFSET + v.offset }
                        if (v.lane === "east") { x -= spd; y = CY - LANE_OFFSET + v.offset }
                        if (v.lane === "west") { x += spd; y = CY + LANE_OFFSET + v.offset }
                        next.push({ ...v, x, y })
                    } else {
                        // Compute arc once and cache
                        if (!arcCache.has(v.id)) {
                            const arc = computeArc(v.lane, v.turn)
                            if (arc) arcCache.set(v.id, arc)
                        }
                        const arc = arcCache.get(v.id)
                        if (arc) {
                            const entryX = arc.cx + arc.r * Math.cos(arc.startA)
                            const entryY = arc.cy + arc.r * Math.sin(arc.startA)
                            next.push({ ...v, x: entryX, y: entryY, turning: true, arcAngle: 0 })
                        } else {
                            next.push({ ...v, turn: "straight" })
                        }
                    }
                    continue
                }

                // ── Green / mid-intersection turning — execute arc ───────
                // (also handles frozen vehicles mid-arc, since we re-push them above)
                const arc = arcCache.get(v.id)
                if (!arc) { next.push({ ...v, turn: "straight" }); continue }

                const ARC_SPEED = 0.09
                const newAngle = v.arcAngle + ARC_SPEED
                const totalSweep = Math.abs(arc.sweepA)
                const fraction = Math.min(1, newAngle / totalSweep)
                const currentA = arc.startA + arc.sweepA * fraction
                const nx = arc.cx + arc.r * Math.cos(currentA)
                const ny = arc.cy + arc.r * Math.sin(currentA)

                if (fraction >= 1) {
                    newCrossed++
                    const ei = getExitInfo(v.lane, v.turn)
                    const exitX = arc.cx + arc.r * Math.cos(arc.startA + arc.sweepA)
                    const exitY = arc.cy + arc.r * Math.sin(arc.startA + arc.sweepA)
                    next.push({ ...v, x: exitX, y: exitY, arcAngle: newAngle, arcDone: true, crossed: true, exitDx: ei.dx, exitDy: ei.dy, exitLanePos: ei.lanePos })
                } else {
                    next.push({ ...v, x: nx, y: ny, arcAngle: newAngle })
                }
            }

            vehiclesRef.current = next

            // ── Phase advancement (only outside emergency) ────────────────
            if (!emergency) {
                const curLane = activeLaneRef.current
                if (curLane && newCrossed > 0) {
                    crossedRef.current += newCrossed
                    setDisplayCrossed(crossedRef.current)
                }

                const remainingInPhase = curLane
                    ? next.filter(v => v.lane === curLane && !v.crossed && !v.isAmbulance).length
                    : 0

                if (curLane && remainingInPhase === 0 && phaseTargetRef.current > 0) {
                    phaseTargetRef.current = 0
                    activeLaneRef.current = null

                    const ni = phaseIdxRef.current + 1
                    phaseIdxRef.current = ni
                    if (ni >= cycle.length) {
                        simActiveRef.current = false
                        setActiveLane(null)
                        onActiveLaneChange?.(null)
                        setSimDone(true)
                        onSimulationEnd?.()
                    } else {
                        setTimeout(() => {
                            if (simActiveRef.current) activatePhaseRef.current(ni)
                        }, 400)
                    }
                }
            }

            draw()
        }, TICK)

        return () => { if (intervalRef.current) clearInterval(intervalRef.current) }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [cycle])

    useEffect(() => { draw() }, [draw])

    // ─── Derived UI values ────────────────────────────────────────────────────
    const currentPhase = cycle?.[displayPhase]
    const activePhaseTurns = vehiclesRef.current
        .filter(v => v.lane === activeLane && !v.isAmbulance)
        .reduce<Record<TurnDir, number>>(
            (acc, v) => { acc[v.turn]++; return acc },
            { straight: 0, left: 0, right: 0 }
        )

    return (
        <div className="flex flex-col items-center gap-4 w-full select-none">

            {/* ── Status bar ─────────────────────────────────────────────── */}
            <div className="w-full min-h-[36px] flex items-center justify-center">
                {emergencyLane ? (
                    <div className="flex items-center gap-3 px-4 py-2 rounded-xl border border-red-500/40 bg-red-950/40 backdrop-blur animate-pulse">
                        <span className="text-red-400 text-sm">🚨</span>
                        <span className="text-red-300 font-bold text-sm tracking-wide uppercase">
                            Emergency — {emergencyLane} priority
                        </span>
                        <span className="text-red-500 text-xs font-mono">ALL OTHER LANES FROZEN</span>
                    </div>
                ) : simStarted && !simDone && currentPhase ? (
                    <div className="flex items-center gap-3 flex-wrap justify-center">
                        {/* Lane badge */}
                        <div
                            className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold tracking-widest uppercase"
                            style={{
                                background: `${LANE_COLORS[currentPhase.lane]}22`,
                                border: `1px solid ${LANE_COLORS[currentPhase.lane]}55`,
                                color: LANE_COLORS[currentPhase.lane],
                                boxShadow: `0 0 12px ${LANE_COLORS[currentPhase.lane]}33`,
                            }}
                        >
                            <span
                                className="w-2 h-2 rounded-full animate-pulse"
                                style={{ background: LANE_COLORS[currentPhase.lane] }}
                            />
                            {currentPhase.lane} — green
                        </div>

                        {/* Progress */}
                        <span className="text-slate-400 text-xs font-mono tabular-nums">
                            {displayCrossed} / {displayTarget} cleared
                        </span>

                        {/* Turn breakdown */}
                        <div className="flex gap-1">
                            {(["straight", "left", "right"] as TurnDir[]).map(t =>
                                activePhaseTurns[t] > 0 && (
                                    <span
                                        key={t}
                                        className="px-2 py-0.5 rounded text-xs font-mono"
                                        style={{ background: "rgba(255,255,255,0.06)", color: "#64748b" }}
                                    >
                                        {TURN_BADGE[t]} {activePhaseTurns[t]}
                                    </span>
                                )
                            )}
                        </div>
                    </div>
                ) : simDone && !emergencyLane ? (
                    <div className="flex items-center gap-2 px-4 py-2 rounded-xl border border-emerald-500/30 bg-emerald-950/30">
                        <span className="text-emerald-400 text-sm">✓</span>
                        <span className="text-emerald-300 text-sm font-semibold">All vehicles cleared</span>
                    </div>
                ) : null}
            </div>

            {/* ── Canvas ─────────────────────────────────────────────────── */}
            <div
                className="relative rounded-2xl overflow-hidden"
                style={{
                    boxShadow: emergencyLane
                        ? "0 0 0 1px rgba(239,68,68,0.4), 0 0 40px rgba(239,68,68,0.12)"
                        : activeLane
                            ? `0 0 0 1px ${LANE_GLOW[activeLane]}, 0 0 40px ${LANE_GLOW[activeLane]}`
                            : "0 0 0 1px rgba(255,255,255,0.06)",
                    transition: "box-shadow 0.4s ease",
                    width: "100%",
                    maxWidth: W,
                }}
            >
                <canvas
                    ref={canvasRef}
                    width={W}
                    height={H}
                    style={{ width: "100%", display: "block" }}
                />
            </div>

            {/* ── Phase pills ────────────────────────────────────────────── */}
            {cycle?.length > 0 && (
                <div className="flex gap-2 flex-wrap justify-center w-full">
                    {cycle.map((p, i) => {
                        const isActive = i === displayPhase && simStarted && !simDone && !emergencyLane
                        const done = simDone || i < displayPhase
                        return (
                            <div
                                key={p.lane}
                                className="px-3 py-1 rounded-full text-xs font-bold transition-all duration-300"
                                style={{
                                    background: isActive
                                        ? `${LANE_COLORS[p.lane]}22`
                                        : done ? "#1e293b" : "#0d1526",
                                    color: isActive ? LANE_COLORS[p.lane] : done ? "#475569" : "#334155",
                                    border: `1px solid ${isActive ? LANE_COLORS[p.lane] + "55" :
                                            done ? "#1e293b" : "#0d1526"
                                        }`,
                                    boxShadow: isActive ? `0 0 10px ${LANE_COLORS[p.lane]}33` : "none",
                                }}
                            >
                                {done && !isActive ? "✓ " : ""}{p.lane.toUpperCase()} · {p.vehicle_count}
                            </div>
                        )
                    })}
                </div>
            )}

            {/* ── Per-lane progress bars ──────────────────────────────────── */}
            {cycle?.length > 0 && simStarted && !emergencyLane && (
                <div className="w-full space-y-2 px-1">
                    {cycle.map((p, i) => {
                        const isActive = i === displayPhase && !simDone
                        const done = simDone || i < displayPhase
                        const cnt = isActive ? displayCrossed : (done ? p.vehicle_count : 0)
                        const pct = p.vehicle_count > 0
                            ? Math.min(100, Math.round(cnt / p.vehicle_count * 100))
                            : 100

                        return (
                            <div key={p.lane} className="flex items-center gap-3 text-xs">
                                <span
                                    className="w-14 font-mono font-semibold capitalize text-right"
                                    style={{ color: isActive ? LANE_COLORS[p.lane] : "#475569" }}
                                >
                                    {p.lane}
                                </span>
                                <div className="flex-1 h-1.5 rounded-full overflow-hidden bg-slate-800/80">
                                    <div
                                        className="h-full rounded-full transition-all duration-100"
                                        style={{
                                            width: `${pct}%`,
                                            background: isActive
                                                ? `linear-gradient(90deg, ${LANE_COLORS[p.lane]}, ${LANE_COLORS[p.lane]}aa)`
                                                : done ? "#334155" : "#1e293b",
                                            boxShadow: isActive ? `0 0 6px ${LANE_COLORS[p.lane]}88` : "none",
                                        }}
                                    />
                                </div>
                                <span className="w-14 font-mono text-slate-500 tabular-nums">
                                    {cnt}/{p.vehicle_count}
                                </span>
                            </div>
                        )
                    })}
                </div>
            )}
        </div>
    )
}