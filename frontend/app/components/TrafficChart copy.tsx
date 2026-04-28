/**
 * TrafficChart.tsx — Phase 4 Analytics
 * --------------------------------------
 * Extends the Phase 1–3 bar chart with line and area variants.
 * All three variants share the same props interface so callers can toggle
 * between them with a single `variant` prop — nothing else changes.
 *
 * Props
 * -----
 * data      : ChartDatum[]     — one entry per lane per phase tick.
 * variant   : "bar" | "line" | "area"  (default "bar").
 * metric    : keyof ChartDatum — which numeric field to plot (default "green_time").
 * title     : string           — optional panel heading.
 * height    : number           — chart height in px (default 220).
 * animate   : boolean          — disable during live updates (default false).
 *
 * Metric choices: green_time | vehicle_count | queue_length | avg_wait_time
 */

import React from "react";
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  Cell,
} from "recharts";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ChartDatum {
  /** Axis label — typically the lane name or a timestamp string. */
  name: string;
  green_time: number;
  vehicle_count: number;
  queue_length: number;
  avg_wait_time: number;
  /** Optional: whether this lane is active in the current phase. */
  is_active?: boolean;
}

export type ChartVariant = "bar" | "line" | "area";
export type ChartMetric = "green_time" | "vehicle_count" | "queue_length" | "avg_wait_time";

interface Props {
  data: ChartDatum[];
  variant?: ChartVariant;
  metric?: ChartMetric;
  title?: string;
  height?: number;
  animate?: boolean;
}

// ── Palette ───────────────────────────────────────────────────────────────────

const LANE_COLORS: Record<string, string> = {
  north: "#3b82f6",   // blue
  south: "#10b981",   // emerald
  east:  "#f59e0b",   // amber
  west:  "#a855f7",   // purple
};

const METRIC_LABELS: Record<ChartMetric, string> = {
  green_time:    "Green Time (s)",
  vehicle_count: "Vehicles",
  queue_length:  "Queue Length",
  avg_wait_time: "Avg Wait (s)",
};

const METRIC_COLOR = "#6366f1";   // indigo — used when lane colours aren't applicable

// ── Shared axis / tooltip style ───────────────────────────────────────────────

const axisStyle = { fill: "#9ca3af", fontSize: 11 };
const gridStyle = { stroke: "#1f2937" };
const tooltipContentStyle = {
  background: "#111827",
  border: "1px solid #374151",
  borderRadius: 8,
  fontSize: 12,
};

// ── Sub-components ────────────────────────────────────────────────────────────

function BarVariant({ data, metric, animate }: Required<Pick<Props, "data" | "metric" | "animate">>) {
  return (
    <BarChart data={data} margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
      <CartesianGrid vertical={false} stroke={gridStyle.stroke} />
      <XAxis dataKey="name" tick={axisStyle} tickLine={false} axisLine={false} />
      <YAxis tick={axisStyle} tickLine={false} axisLine={false} width={32} />
      <Tooltip
        contentStyle={tooltipContentStyle}
        labelStyle={{ color: "#d1d5db" }}
        itemStyle={{ color: "#d1d5db" }}
        cursor={{ fill: "rgba(255,255,255,0.04)" }}
      />
      <Bar
        dataKey={metric}
        name={METRIC_LABELS[metric]}
        radius={[4, 4, 0, 0]}
        isAnimationActive={animate}
        maxBarSize={48}
      >
        {data.map((entry) => (
          <Cell
            key={entry.name}
            fill={
              LANE_COLORS[entry.name] ??
              (entry.is_active ? "#22d3ee" : METRIC_COLOR)
            }
            opacity={entry.is_active === false ? 0.4 : 1}
          />
        ))}
      </Bar>
    </BarChart>
  );
}

function LineVariant({ data, metric, animate }: Required<Pick<Props, "data" | "metric" | "animate">>) {
  // When data items have a `name` that looks like a lane, colour per-lane.
  // When name is a timestamp label (time-series mode), use a single colour.
  const isLaneMode = data.every((d) => d.name in LANE_COLORS);

  if (isLaneMode) {
    // One line per datum — effectively the same as bar but as dots+line.
    return (
      <LineChart data={data} margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
        <CartesianGrid stroke={gridStyle.stroke} />
        <XAxis dataKey="name" tick={axisStyle} tickLine={false} axisLine={false} />
        <YAxis tick={axisStyle} tickLine={false} axisLine={false} width={32} />
        <Tooltip
          contentStyle={tooltipContentStyle}
          labelStyle={{ color: "#d1d5db" }}
          itemStyle={{ color: "#d1d5db" }}
        />
        {Object.keys(LANE_COLORS).map((lane) => {
          const exists = data.some((d) => d.name === lane);
          return exists ? (
            <Line
              key={lane}
              type="monotone"
              dataKey={metric}
              data={data.filter((d) => d.name === lane)}
              name={lane}
              stroke={LANE_COLORS[lane]}
              dot={{ r: 4, strokeWidth: 2 }}
              activeDot={{ r: 6 }}
              strokeWidth={2}
              isAnimationActive={animate}
            />
          ) : null;
        })}
      </LineChart>
    );
  }

  // Time-series mode — single line.
  return (
    <LineChart data={data} margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
      <CartesianGrid stroke={gridStyle.stroke} />
      <XAxis dataKey="name" tick={axisStyle} tickLine={false} axisLine={false} interval="preserveStartEnd" />
      <YAxis tick={axisStyle} tickLine={false} axisLine={false} width={32} />
      <Tooltip
        contentStyle={tooltipContentStyle}
        labelStyle={{ color: "#d1d5db" }}
        itemStyle={{ color: "#d1d5db" }}
      />
      <Legend wrapperStyle={{ fontSize: 12, color: "#9ca3af" }} />
      <Line
        type="monotone"
        dataKey={metric}
        name={METRIC_LABELS[metric]}
        stroke={METRIC_COLOR}
        dot={false}
        strokeWidth={2}
        isAnimationActive={animate}
      />
    </LineChart>
  );
}

function AreaVariant({ data, metric, animate }: Required<Pick<Props, "data" | "metric" | "animate">>) {
  return (
    <AreaChart data={data} margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
      <defs>
        <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="5%"  stopColor={METRIC_COLOR} stopOpacity={0.35} />
          <stop offset="95%" stopColor={METRIC_COLOR} stopOpacity={0}   />
        </linearGradient>
      </defs>
      <CartesianGrid stroke={gridStyle.stroke} />
      <XAxis dataKey="name" tick={axisStyle} tickLine={false} axisLine={false} interval="preserveStartEnd" />
      <YAxis tick={axisStyle} tickLine={false} axisLine={false} width={32} />
      <Tooltip
        contentStyle={tooltipContentStyle}
        labelStyle={{ color: "#d1d5db" }}
        itemStyle={{ color: "#d1d5db" }}
      />
      <Legend wrapperStyle={{ fontSize: 12, color: "#9ca3af" }} />
      <Area
        type="monotone"
        dataKey={metric}
        name={METRIC_LABELS[metric]}
        stroke={METRIC_COLOR}
        fill="url(#areaGrad)"
        dot={false}
        strokeWidth={2}
        isAnimationActive={animate}
      />
    </AreaChart>
  );
}

// ── Variant toggle buttons ────────────────────────────────────────────────────

const VARIANT_ICONS: Record<ChartVariant, string> = {
  bar:  "▊",
  line: "〜",
  area: "▲",
};

// ── Main Component ────────────────────────────────────────────────────────────

export default function TrafficChart({
  data,
  variant = "bar",
  metric = "green_time",
  title,
  height = 220,
  animate = false,
}: Props) {
  const [activeVariant, setActiveVariant] = React.useState<ChartVariant>(variant);
  const [activeMetric, setActiveMetric]   = React.useState<ChartMetric>(metric);

  const metrics: ChartMetric[] = ["green_time", "vehicle_count", "queue_length", "avg_wait_time"];

  return (
    <div className="bg-gray-900 rounded-xl p-4 flex flex-col gap-3">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        {title && (
          <p className="text-xs text-gray-400 uppercase tracking-widest">{title}</p>
        )}

        {/* Metric selector */}
        <div className="flex gap-1 flex-wrap">
          {metrics.map((m) => (
            <button
              key={m}
              onClick={() => setActiveMetric(m)}
              className={`text-xs px-2 py-1 rounded-md transition-colors ${
                activeMetric === m
                  ? "bg-indigo-600 text-white"
                  : "bg-gray-800 text-gray-400 hover:bg-gray-700"
              }`}
            >
              {METRIC_LABELS[m]}
            </button>
          ))}
        </div>

        {/* Variant switcher */}
        <div className="flex gap-1">
          {(["bar", "line", "area"] as ChartVariant[]).map((v) => (
            <button
              key={v}
              onClick={() => setActiveVariant(v)}
              title={v}
              className={`text-sm px-2 py-1 rounded-md transition-colors ${
                activeVariant === v
                  ? "bg-indigo-600 text-white"
                  : "bg-gray-800 text-gray-400 hover:bg-gray-700"
              }`}
            >
              {VARIANT_ICONS[v]}
            </button>
          ))}
        </div>
      </div>

      {/* Chart */}
      <ResponsiveContainer width="100%" height={height}>
        {activeVariant === "bar" ? (
          <BarVariant  data={data} metric={activeMetric} animate={animate} />
        ) : activeVariant === "line" ? (
          <LineVariant data={data} metric={activeMetric} animate={animate} />
        ) : (
          <AreaVariant data={data} metric={activeMetric} animate={animate} />
        )}
      </ResponsiveContainer>
    </div>
  );
}
