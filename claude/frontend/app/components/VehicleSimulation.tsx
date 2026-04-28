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
}

type Phase = {
    lane: Lane
    green_time: number
    vehicle_count: number
    sub_lanes?: { straight: number; left: number; right: number }
}

type Props = {
    cycle: Phase[]
    onSimulationEnd?: () => void
}

const W = 640
const H = 560
const CX = W / 2
const CY = H / 2
const RH = 42
const LANE_OFFSET = 14

const SPEED = 4
const SLOW_SPEED = 2.8
const SPACING = 36
const SAFE_DIST = 35
const TICK = 50

const SUB_LANE: Record<TurnDir, number> = { left: -12, straight: 0, right: 12 }

// ─── Entry / exit points for each lane+turn combination ──────────────────────
// Entry = exact stop-line position (where vehicle snaps before arc)
// Exit  = exact outbound lane position (where arc ends and vehicle drives away)
//
// Approach stop-lines:
//   north (↓): x = CX - LANE_OFFSET, y = CY - RH - 8
//   south (↑): x = CX + LANE_OFFSET, y = CY + RH + 8
//   east  (←): x = CX + RH + 8,      y = CY - LANE_OFFSET
//   west  (→): x = CX - RH - 8,      y = CY + LANE_OFFSET
//
// Outbound lane centres:
//   northbound exit (↑): x = CX + LANE_OFFSET
//   southbound exit (↓): x = CX - LANE_OFFSET
//   eastbound  exit (→): y = CY + LANE_OFFSET
//   westbound  exit (←): y = CY - LANE_OFFSET

type Pt = { x: number; y: number }

function getEntryExit(lane: Lane, turn: TurnDir): { entry: Pt; exit: Pt } | null {
    if (turn === "straight") return null

    // Stop-line entry positions
    const N_ENTRY: Pt = { x: CX - LANE_OFFSET, y: CY - RH - 8 }
    const S_ENTRY: Pt = { x: CX + LANE_OFFSET, y: CY + RH + 8 }
    const E_ENTRY: Pt = { x: CX + RH + 8, y: CY - LANE_OFFSET }
    const W_ENTRY: Pt = { x: CX - RH - 8, y: CY + LANE_OFFSET }

    // Outbound-lane exit positions — placed just past the box edge so arc ends
    // on the correct lane centre and the vehicle can drive straight from there.
    const EXIT_MARGIN = RH + 8

    // Exits: (perpendicular axis locked to outbound lane, along-axis = just past intersection)
    const EXIT_N: Pt = { x: CX + LANE_OFFSET, y: CY - EXIT_MARGIN }  // travelling ↑, exits top
    const EXIT_S: Pt = { x: CX - LANE_OFFSET, y: CY + EXIT_MARGIN }  // travelling ↓, exits bottom
    const EXIT_E: Pt = { x: CX + EXIT_MARGIN, y: CY + LANE_OFFSET }  // travelling →, exits right
    const EXIT_W: Pt = { x: CX - EXIT_MARGIN, y: CY - LANE_OFFSET }  // travelling ←, exits left

    if (lane === "north") {
        // north approaches ↓, right turn → east (→), left turn → west (←)
        return turn === "right"
            ? { entry: N_ENTRY, exit: EXIT_E }
            : { entry: N_ENTRY, exit: EXIT_W }
    }
    if (lane === "south") {
        // south approaches ↑, right turn → west (←), left turn → east (→)
        return turn === "right"
            ? { entry: S_ENTRY, exit: EXIT_W }
            : { entry: S_ENTRY, exit: EXIT_E }
    }
    if (lane === "east") {
        // east approaches ←, right turn → north (↑), left turn → south (↓)
        return turn === "right"
            ? { entry: E_ENTRY, exit: EXIT_N }
            : { entry: E_ENTRY, exit: EXIT_S }
    }
    // west approaches →, right turn → south (↓), left turn → north (↑)
    return turn === "right"
        ? { entry: W_ENTRY, exit: EXIT_S }
        : { entry: W_ENTRY, exit: EXIT_N }
}

// ─── Arc definition ───────────────────────────────────────────────────────────
type ArcDef = { cx: number; cy: number; r: number; startA: number; sweepA: number }

/**
 * Compute a 90° circular arc from `entry` to `exit`.
 *
 * For a right-angle turn the arc center lies at the corner formed by the two
 * road-centre lines. Given entry point P and exit point Q, the center C is the
 * unique point that is equidistant from both AND lies on the perpendicular from
 * P (in the approach direction) AND on the perpendicular from Q (in the exit
 * direction). For a 90° turn this simplifies to:
 *
 *   C = (entry.x aligned to exit.x axis, exit.y aligned to entry.y axis)
 *   — which is just the corner of the axis-aligned rectangle spanned by P and Q.
 *
 * The sign of sweepA encodes CW (positive) vs CCW (negative).
 */
function computeArc(lane: Lane, turn: TurnDir): ArcDef | null {
    const pts = getEntryExit(lane, turn)
    if (!pts) return null
    const { entry, exit } = pts

    // The arc centre is the axis-aligned corner between entry and exit.
    // For north/south lanes (vertical approach), entry moves vertically so
    // the centre shares entry's x and exit's y. For east/west (horizontal
    // approach) it shares entry's y and exit's x.
    let cx: number, cy: number
    if (lane === "north" || lane === "south") {
        cx = entry.x
        cy = exit.y
    } else {
        cx = exit.x
        cy = entry.y
    }

    const r = Math.hypot(entry.x - cx, entry.y - cy)
    const startA = Math.atan2(entry.y - cy, entry.x - cx)
    const endA = Math.atan2(exit.y - cy, exit.x - cx)

    // Determine the sweep. We always want a 90° turn in the correct rotational
    // direction. Cross-product of (entry−C) × (exit−C) tells us orientation:
    //   positive → CCW, negative → CW
    const cross = (entry.x - cx) * (exit.y - cy) - (entry.y - cy) * (exit.x - cx)
    // Normalise to ±π/2 (always a 90° arc)
    const sweepA = cross > 0 ? Math.PI / 2 : -Math.PI / 2

    return { cx, cy, r, startA, sweepA }
}

// ─── Exit info after completing a turn ───────────────────────────────────────
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

// ─── Stop line position ───────────────────────────────────────────────────────
function stopLine(lane: Lane): number {
    if (lane === "north") return CY - RH - 8
    if (lane === "south") return CY + RH + 8
    if (lane === "east") return CX + RH + 8
    return CX - RH - 8
}

function hasCrossed(lane: Lane, x: number, y: number): boolean {
    const B = 55
    if (lane === "north") return y > CY + RH + B
    if (lane === "south") return y < CY - RH - B
    if (lane === "east") return x < CX - RH - B
    return x > CX + RH + B
}

function isOffCanvas(x: number, y: number): boolean {
    return x < -200 || x > W + 200 || y < -200 || y > H + 200
}

function aheadDist(v: Vehicle, others: Vehicle[]): number {
    let minD = Infinity
    for (const f of others) {
        if (f.id === v.id || f.lane !== v.lane || f.crossed) continue
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
        for (let i = 0; i < sub.left; i++)     turns.push("left")
        for (let i = 0; i < sub.right; i++)    turns.push("right")
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
            if (lane === "north") { x = CX - LANE_OFFSET + lateralOffset; y = CY - RH - 8 - dist }
            if (lane === "south") { x = CX + LANE_OFFSET + lateralOffset; y = CY + RH + 8 + dist }
            if (lane === "east") { x = CX + RH + 8 + dist; y = CY - LANE_OFFSET + lateralOffset }
            if (lane === "west") { x = CX - RH - 8 - dist; y = CY + LANE_OFFSET + lateralOffset }

            const ei = getExitInfo(lane, "straight")
            all.push({
                id: `${lane}-${i}`,
                lane, turn, x, y,
                crossed: false,
                offset: lateralOffset,
                queueIdx: rankInGroup,
                turning: false,
                arcAngle: 0,
                arcDone: false,
                exitDx: ei.dx,
                exitDy: ei.dy,
                exitLanePos: ei.lanePos,
            })
        }
    }
    return all
}

// ── Canvas helpers ────────────────────────────────────────────────────────────
function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
    ctx.beginPath()
    ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y)
    ctx.arcTo(x + w, y, x + w, y + r, r); ctx.lineTo(x + w, y + h - r)
    ctx.arcTo(x + w, y + h, x + w - r, y + h, r); ctx.lineTo(x + r, y + h)
    ctx.arcTo(x, y + h, x, y + h - r, r); ctx.lineTo(x, y + r)
    ctx.arcTo(x, y, x + r, y, r); ctx.closePath()
}

const LANE_COLORS: Record<Lane, string> = { north: "#1D9E75", south: "#378ADD", east: "#BA7517", west: "#D4537E" }
const TURN_BADGE: Record<TurnDir, string> = { straight: "↑", left: "←", right: "→" }

// Arc cache keyed by vehicle id
const arcCache = new Map<string, ArcDef>()

// ── Component ─────────────────────────────────────────────────────────────────
export default function VehicleSimulation({ cycle, onSimulationEnd }: Props) {
    const canvasRef = useRef<HTMLCanvasElement>(null)
    const vehiclesRef = useRef<Vehicle[]>([])
    const activeLaneRef = useRef<Lane | null>(null)
    const crossedRef = useRef(0)
    const phaseTargetRef = useRef(0)
    const phaseIdxRef = useRef(0)
    const simActiveRef = useRef(false)
    const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
    const smoothScaleRef = useRef(1)
    const smoothCamXRef = useRef(CX)
    const smoothCamYRef = useRef(CY)

    const [displayPhase, setDisplayPhase] = useState(0)
    const [displayCrossed, setDisplayCrossed] = useState(0)
    const [displayTarget, setDisplayTarget] = useState(0)
    const [activeLane, setActiveLane] = useState<Lane | null>(null)
    const [simDone, setSimDone] = useState(false)
    const [simStarted, setSimStarted] = useState(false)

    const draw = useCallback(() => {
        const canvas = canvasRef.current; if (!canvas) return
        const ctx = canvas.getContext("2d"); if (!ctx) return
        const dark = window.matchMedia("(prefers-color-scheme: dark)").matches
        const vehicles = vehiclesRef.current
        const active = activeLaneRef.current

        ctx.clearRect(0, 0, W, H)

        let avgX = CX, avgY = CY
        if (vehicles.length > 0) {
            avgX = vehicles.reduce((s, v) => s + v.x, 0) / vehicles.length
            avgY = vehicles.reduce((s, v) => s + v.y, 0) / vehicles.length
        }
        smoothCamXRef.current = smoothCamXRef.current * 0.92 + avgX * 0.08
        smoothCamYRef.current = smoothCamYRef.current * 0.92 + avgY * 0.08
        let maxDist = 0
        for (const v of vehicles) maxDist = Math.max(maxDist, Math.abs(v.x - smoothCamXRef.current), Math.abs(v.y - smoothCamYRef.current))
        const maxVisible = Math.min(W, H) / 2 - 40
        const targetScale = maxDist > maxVisible ? maxVisible / maxDist : 1
        smoothScaleRef.current = smoothScaleRef.current * 0.92 + targetScale * 0.08

        ctx.save()
        ctx.translate(CX, CY)
        ctx.scale(smoothScaleRef.current, smoothScaleRef.current)
        ctx.translate(-smoothCamXRef.current, -smoothCamYRef.current)

        const INF = 4000
        ctx.fillStyle = dark ? "#0d1117" : "#e8e6df"; ctx.fillRect(CX - INF, CY - INF, INF * 2, INF * 2)
        ctx.fillStyle = dark ? "#21272e" : "#2c2c2a"
        ctx.fillRect(CX - INF, CY - RH, INF * 2, RH * 2)
        ctx.fillRect(CX - RH, CY - INF, RH * 2, INF * 2)
        ctx.fillStyle = dark ? "#2a3140" : "#3d3d3a"; ctx.fillRect(CX - RH, CY - RH, RH * 2, RH * 2)

        ctx.strokeStyle = "rgba(100,200,255,0.12)"; ctx.lineWidth = 1; ctx.setLineDash([8, 10])
        for (const off of [-12, 12]) {
            ctx.beginPath(); ctx.moveTo(CX + off, CY - INF); ctx.lineTo(CX + off, CY - RH); ctx.stroke()
            ctx.beginPath(); ctx.moveTo(CX + off, CY + RH); ctx.lineTo(CX + off, CY + INF); ctx.stroke()
            ctx.beginPath(); ctx.moveTo(CX - INF, CY + off); ctx.lineTo(CX - RH, CY + off); ctx.stroke()
            ctx.beginPath(); ctx.moveTo(CX + RH, CY + off); ctx.lineTo(CX + INF, CY + off); ctx.stroke()
        }
        ctx.setLineDash([])

        ctx.strokeStyle = "rgba(100,200,255,0.28)"; ctx.lineWidth = 2; ctx.setLineDash([18, 14])
        ctx.beginPath(); ctx.moveTo(CX - INF, CY); ctx.lineTo(CX - RH - 2, CY); ctx.stroke()
        ctx.beginPath(); ctx.moveTo(CX + RH + 2, CY); ctx.lineTo(CX + INF, CY); ctx.stroke()
        ctx.beginPath(); ctx.moveTo(CX, CY - INF); ctx.lineTo(CX, CY - RH - 2); ctx.stroke()
        ctx.beginPath(); ctx.moveTo(CX, CY + RH + 2); ctx.lineTo(CX, CY + INF); ctx.stroke()
        ctx.setLineDash([])

        ctx.strokeStyle = "rgba(255,255,255,0.7)"; ctx.lineWidth = 2
        for (const lane of ["north", "south", "east", "west"] as Lane[]) {
            if (lane === active) continue
            ctx.beginPath()
            if (lane === "north") { ctx.moveTo(CX - RH, CY - RH - 3); ctx.lineTo(CX, CY - RH - 3) }
            if (lane === "south") { ctx.moveTo(CX, CY + RH + 3); ctx.lineTo(CX + RH, CY + RH + 3) }
            if (lane === "east") { ctx.moveTo(CX + RH + 3, CY - RH); ctx.lineTo(CX + RH + 3, CY) }
            if (lane === "west") { ctx.moveTo(CX - RH - 3, CY); ctx.lineTo(CX - RH - 3, CY + RH) }
            ctx.stroke()
        }

        const corners: Record<Lane, { x: number; y: number }> = {
            north: { x: CX - RH - 14, y: CY - RH - 16 },
            south: { x: CX + 4, y: CY + RH + 4 },
            east: { x: CX + RH + 4, y: CY - RH - 16 },
            west: { x: CX - RH - 14, y: CY + 4 },
        }
        for (const [lane, pos] of Object.entries(corners) as [Lane, { x: number; y: number }][]) {
            const isGreen = lane === active
            ctx.fillStyle = dark ? "#1a1a2e" : "#111"; roundRect(ctx, pos.x - 2, pos.y - 2, 14, 30, 3); ctx.fill()
            ctx.beginPath(); ctx.arc(pos.x + 5, pos.y + 5, 4, 0, Math.PI * 2); ctx.fillStyle = isGreen ? "#3d1212" : "#ef4444"; ctx.fill()
            ctx.beginPath(); ctx.arc(pos.x + 5, pos.y + 20, 4, 0, Math.PI * 2); ctx.fillStyle = isGreen ? "#22c55e" : "#122a16"; ctx.fill()
        }

        ctx.font = "500 11px sans-serif"; ctx.fillStyle = dark ? "#666" : "#888"
        ctx.textAlign = "center"; ctx.textBaseline = "middle"
        ctx.fillText("N", CX, CY - RH - 60); ctx.fillText("S", CX, CY + RH + 60)
        ctx.textAlign = "left"; ctx.fillText("W", CX - RH - 60, CY)
        ctx.textAlign = "right"; ctx.fillText("E", CX + RH + 60, CY)

        for (const v of vehicles) {
            const isNS = v.lane === "north" || v.lane === "south"
            const isEWExit = v.exitDx !== 0
            const bodyIsNS = isNS ? !v.crossed || !isEWExit : v.crossed && !isEWExit
            const vw = bodyIsNS ? 10 : 16
            const vh = bodyIsNS ? 16 : 10
            const isActive = v.lane === active
            ctx.fillStyle = isActive ? LANE_COLORS[v.lane] : (dark ? "#334155" : "#888780")
            roundRect(ctx, v.x - vw / 2, v.y - vh / 2, vw, vh, 2); ctx.fill()

            if (isActive && v.turn !== "straight") {
                ctx.font = "bold 7px sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle"
                ctx.fillStyle = "rgba(255,255,255,0.92)"; ctx.fillText(TURN_BADGE[v.turn], v.x, v.y)
            }
        }

        ctx.restore()
    }, [])

    const activatePhase = useCallback((idx: number) => {
        if (!cycle[idx]) return
        const ph = cycle[idx]
        activeLaneRef.current = ph.lane
        phaseTargetRef.current = ph.vehicle_count
        crossedRef.current = 0
        setActiveLane(ph.lane); setDisplayPhase(idx); setDisplayTarget(ph.vehicle_count); setDisplayCrossed(0)
    }, [cycle])

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
        smoothScaleRef.current = 1
        smoothCamXRef.current = CX
        smoothCamYRef.current = CY

        setSimDone(false); setSimStarted(true); setDisplayPhase(0); setDisplayCrossed(0); setActiveLane(null)
        setTimeout(() => activatePhase(0), 600)

        intervalRef.current = setInterval(() => {
            if (!simActiveRef.current) return
            const active = activeLaneRef.current
            let newCrossed = 0
            const next: Vehicle[] = []

            for (const v of vehiclesRef.current) {

                // ── Crossed: drive away along exit heading ──────────────────
                if (v.crossed) {
                    let x = v.x + v.exitDx * SPEED
                    let y = v.y + v.exitDy * SPEED
                    if (v.exitDx !== 0) y = v.exitLanePos
                    else x = v.exitLanePos
                    if (!isOffCanvas(x, y)) next.push({ ...v, x, y })
                    continue
                }

                // ── Red lane: creep to queue position ──────────────────────
                if (v.lane !== active) {
                    const sl = stopLine(v.lane)
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

                // ── Green: straight ────────────────────────────────────────
                if (v.turn === "straight") {
                    const gap = aheadDist(v, vehiclesRef.current)
                    let spd = SPEED
                    if (gap < SAFE_DIST) { if (gap < 4) { next.push(v); continue }; spd = SPEED * (gap / SAFE_DIST) * 0.85 }
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

                // ── Green: turning — Phase A: approach stop line ───────────
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
                        if (gap < SAFE_DIST) { if (gap < 4) { next.push(v); continue }; spd = SPEED * (gap / SAFE_DIST) * 0.85 }
                        let { x, y } = v
                        if (v.lane === "north") { y += spd; x = CX - LANE_OFFSET + v.offset }
                        if (v.lane === "south") { y -= spd; x = CX + LANE_OFFSET + v.offset }
                        if (v.lane === "east") { x -= spd; y = CY - LANE_OFFSET + v.offset }
                        if (v.lane === "west") { x += spd; y = CY + LANE_OFFSET + v.offset }
                        next.push({ ...v, x, y })
                    } else {
                        // Compute and cache the geometrically-exact arc
                        if (!arcCache.has(v.id)) {
                            const arc = computeArc(v.lane, v.turn)
                            if (arc) arcCache.set(v.id, arc)
                        }
                        const arc = arcCache.get(v.id)
                        if (arc) {
                            // Snap to the mathematically exact arc entry point
                            const entryX = arc.cx + arc.r * Math.cos(arc.startA)
                            const entryY = arc.cy + arc.r * Math.sin(arc.startA)
                            next.push({ ...v, x: entryX, y: entryY, turning: true, arcAngle: 0 })
                        } else {
                            next.push({ ...v, turn: "straight" })
                        }
                    }
                    continue
                }

                // ── Green: turning — Phase B: execute arc ─────────────────
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
                    // Snap to the mathematically exact arc exit point
                    const exitX = arc.cx + arc.r * Math.cos(arc.startA + arc.sweepA)
                    const exitY = arc.cy + arc.r * Math.sin(arc.startA + arc.sweepA)
                    next.push({
                        ...v, x: exitX, y: exitY, arcAngle: newAngle, arcDone: true, crossed: true,
                        exitDx: ei.dx, exitDy: ei.dy, exitLanePos: ei.lanePos
                    })
                } else {
                    next.push({ ...v, x: nx, y: ny, arcAngle: newAngle })
                }
            }

            vehiclesRef.current = next

            if (newCrossed > 0) {
                crossedRef.current += newCrossed
                setDisplayCrossed(crossedRef.current)
                if (crossedRef.current >= phaseTargetRef.current) {
                    const ni = phaseIdxRef.current + 1
                    phaseIdxRef.current = ni
                    if (ni >= cycle.length) {
                        simActiveRef.current = false; activeLaneRef.current = null
                        setActiveLane(null); setSimDone(true); onSimulationEnd?.()
                    } else {
                        setTimeout(() => { if (simActiveRef.current) activatePhase(ni) }, 400)
                    }
                }
            }
            draw()
        }, TICK)

        return () => { if (intervalRef.current) clearInterval(intervalRef.current) }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [cycle])

    useEffect(() => { draw() }, [draw])

    const currentPhase = cycle?.[displayPhase]
    const activePhaseTurns = vehiclesRef.current
        .filter(v => v.lane === activeLane)
        .reduce<Record<TurnDir, number>>((acc, v) => { acc[v.turn]++; return acc }, { straight: 0, left: 0, right: 0 })

    return (
        <div className="flex flex-col items-center gap-3 w-full">
            {simStarted && !simDone && currentPhase && (
                <div className="flex items-center gap-3 text-sm font-semibold flex-wrap justify-center">
                    <span className="px-3 py-1 rounded-full text-white font-black text-xs tracking-wide"
                        style={{ background: LANE_COLORS[currentPhase.lane] }}>
                        {currentPhase.lane.toUpperCase()} — GREEN
                    </span>
                    <span className="text-slate-400 text-xs">{displayCrossed} / {displayTarget} vehicles crossed</span>
                    <span className="flex gap-1">
                        {(["straight", "left", "right"] as TurnDir[]).map(t => activePhaseTurns[t] > 0 && (
                            <span key={t} className="px-2 py-0.5 rounded text-xs font-mono"
                                style={{ background: "rgba(255,255,255,0.07)", color: "#94a3b8" }}>
                                {TURN_BADGE[t]} {activePhaseTurns[t]}
                            </span>
                        ))}
                    </span>
                </div>
            )}
            {simDone && <div className="text-xs font-semibold text-emerald-400 tracking-wide">✓ Simulation complete — all vehicles cleared</div>}
            <canvas ref={canvasRef} width={W} height={H} className="rounded-xl border border-slate-700" style={{ width: "100%", maxWidth: W }} />
            {cycle?.length > 0 && (
                <div className="flex gap-2 flex-wrap justify-center w-full">
                    {cycle.map((p, i) => {
                        const isActive = i === displayPhase && simStarted && !simDone
                        const done = simDone || i < displayPhase
                        return (
                            <div key={p.lane} className="px-3 py-1 rounded-full text-xs font-bold transition-all"
                                style={{
                                    background: isActive ? LANE_COLORS[p.lane] : done ? "#1e293b" : "#0f172a",
                                    color: isActive ? "#fff" : "#64748b",
                                    border: `1px solid ${isActive || done ? LANE_COLORS[p.lane] + "66" : "#1e293b"}`,
                                    opacity: done && !isActive ? 0.55 : 1
                                }}>
                                {p.lane.toUpperCase()} · {p.vehicle_count} cars
                            </div>
                        )
                    })}
                </div>
            )}
            {cycle?.length > 0 && simStarted && (
                <div className="w-full space-y-2 px-1">
                    {cycle.map((p, i) => {
                        const isActive = i === displayPhase && !simDone
                        const done = simDone || i < displayPhase
                        const cnt = isActive ? displayCrossed : (done ? p.vehicle_count : 0)
                        const pct = p.vehicle_count > 0 ? Math.min(100, Math.round(cnt / p.vehicle_count * 100)) : 100
                        return (
                            <div key={p.lane} className="flex items-center gap-2 text-xs text-slate-400">
                                <span className="w-12 font-medium capitalize">{p.lane}</span>
                                <div className="flex-1 h-1 bg-slate-800 rounded-full overflow-hidden">
                                    <div className="h-full rounded-full transition-all duration-100"
                                        style={{ width: `${pct}%`, background: LANE_COLORS[p.lane] }} />
                                </div>
                                <span className="w-14 text-right tabular-nums">{cnt}/{p.vehicle_count}</span>
                            </div>
                        )
                    })}
                </div>
            )}
        </div>
    )
}