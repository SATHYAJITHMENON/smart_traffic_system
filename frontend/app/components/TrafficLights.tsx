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
                                background: isGreen ? "#2a0a0a" : "#ef4444",
                                boxShadow: !isGreen ? "0 0 12px 4px rgba(239,68,68,0.7)" : "none",
                            }} />

                            {/* Amber */}
                            <div style={{
                                ...S.bulb,
                                background: "#1a1605"
                            }} />

                            {/* Green */}
                            <div style={{
                                ...S.bulb,
                                background: isGreen ? "#22c55e" : "#0a1a0c",
                                boxShadow: isGreen ? `0 0 14px 5px rgba(34,197,94,0.7)` : "none",
                            }} />

                        </div>

                        {/* Label */}
                        <span style={{
                            ...S.label,
                            color: isGreen ? color : "#1f2937",
                            ...(isGreen ? { textShadow: `0 0 10px ${color}aa` } : {}),
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
        gap: 18,   // 🔥 increased spacing between lanes
    },

    unit: {
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 6,
    },

    housing: {
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 6,                 // 🔥 more spacing between lights
        background: "#050505",
        border: "1px solid #1a1a1a",
        borderRadius: 10,
        padding: "10px 8px",    // 🔥 bigger container
        boxShadow: "0 4px 20px rgba(0,0,0,0.6)"
    },

    bulb: {
        width: 22,              // 🔥 BIGGER (was 10)
        height: 22,             // 🔥 BIGGER
        borderRadius: "50%",
        transition: "all 0.25s ease",
        flexShrink: 0,
    },

    label: {
        fontSize: 12,           // 🔥 bigger text
        fontWeight: 900,
        letterSpacing: "0.08em",
        transition: "all 0.25s ease",
        lineHeight: 1,
    },
}