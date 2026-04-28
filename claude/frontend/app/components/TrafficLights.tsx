"use client"

type Lane = "north" | "south" | "east" | "west"

type Props = {
    activeLane: Lane | null
}

const LANE_COLORS: Record<Lane, string> = {
    north: "#1D9E75",
    south: "#378ADD",
    east: "#BA7517",
    west: "#D4537E",
}

const LANE_LABELS: Record<Lane, string> = {
    north: "N",
    south: "S",
    east: "E",
    west: "W",
}

export default function TrafficLights({ activeLane }: Props) {
    const lanes: Lane[] = ["north", "south", "east", "west"]

    return (
        <div className="flex gap-3 justify-center flex-wrap">
            {lanes.map(lane => {
                const isGreen = lane === activeLane
                return (
                    <div
                        key={lane}
                        className="flex flex-col items-center gap-1"
                    >
                        {/* Signal housing */}
                        <div
                            className="flex flex-col items-center gap-1.5 rounded-lg px-2 py-2"
                            style={{ background: "#111", border: "1px solid #333" }}
                        >
                            {/* Red bulb */}
                            <div
                                className="rounded-full transition-all duration-300"
                                style={{
                                    width: 16,
                                    height: 16,
                                    background: isGreen ? "#3d1212" : "#ef4444",
                                    boxShadow: !isGreen ? "0 0 8px 2px rgba(239,68,68,0.7)" : "none",
                                }}
                            />
                            {/* Amber (always off in this simplified model) */}
                            <div
                                className="rounded-full"
                                style={{
                                    width: 16,
                                    height: 16,
                                    background: "#1a1000",
                                }}
                            />
                            {/* Green bulb */}
                            <div
                                className="rounded-full transition-all duration-300"
                                style={{
                                    width: 16,
                                    height: 16,
                                    background: isGreen ? "#22c55e" : "#122a16",
                                    boxShadow: isGreen ? "0 0 8px 2px rgba(34,197,94,0.7)" : "none",
                                }}
                            />
                        </div>

                        {/* Lane label */}
                        <span
                            className="text-xs font-bold transition-colors duration-300"
                            style={{ color: isGreen ? LANE_COLORS[lane] : "#4b5563" }}
                        >
                            {LANE_LABELS[lane]}
                        </span>
                    </div>
                )
            })}
        </div>
    )
}
