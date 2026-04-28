"use client"

type Lane = "north" | "south" | "east" | "west"

type Props = {
    activeLane: Lane | null
}

const LANE_COLORS: Record<Lane, string> = {
    north: "#34d399",
    south: "#60a5fa",
    east: "#f59e0b",
    west: "#a78bfa",
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
        <div style={S.row}>
            {lanes.map(lane => {
                const isGreen = lane === activeLane
                const color = LANE_COLORS[lane]
                return (
                    <div key={lane} style={S.unit}>
                        {/* Housing */}
                        <div style={S.housing}>
                            {/* Red */}
                            <div style={{
                                ...S.bulb,
                                background: isGreen ? "#1a0505" : "#ef4444",
                                boxShadow: !isGreen ? "0 0 7px 2px rgba(239,68,68,0.6)" : "none",
                            }} />
                            {/* Amber — always off */}
                            <div style={{ ...S.bulb, background: "#12100a" }} />
                            {/* Green */}
                            <div style={{
                                ...S.bulb,
                                background: isGreen ? "#22c55e" : "#0a1a0c",
                                boxShadow: isGreen ? `0 0 8px 3px rgba(34,197,94,0.65)` : "none",
                            }} />
                        </div>

                        {/* Label */}
                        <span style={{
                            ...S.label,
                            color: isGreen ? color : "#1f2937",
                            ...(isGreen ? { textShadow: `0 0 8px ${color}99` } : {}),
                        }}>
                            {LANE_LABELS[lane]}
                        </span>
                    </div>
                )
            })}
        </div>
    )
}

const S: Record<string, React.CSSProperties> = {
    row: {
        display: "flex",
        alignItems: "center",
        gap: 10,
    },
    unit: {
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 4,
    },
    housing: {
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 3,
        background: "#0a0a0a",
        border: "1px solid #1a1a1a",
        borderRadius: 6,
        padding: "5px 4px",
    },
    bulb: {
        width: 10,
        height: 10,
        borderRadius: "50%",
        transition: "all 0.25s ease",
        flexShrink: 0,
    },
    label: {
        fontSize: 9,
        fontWeight: 800,
        letterSpacing: "0.06em",
        transition: "color 0.25s ease, text-shadow 0.25s ease",
        lineHeight: 1,
    },
}