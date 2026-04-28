/**
 * AnalyticsPanel.tsx — Phase 4 Analytics
 * ----------------------------------------
 * Displays four live KPI cards (avg wait time, throughput, queue length,
 * emergency count) derived from a rolling buffer of PhaseUpdate messages.
 *
 * Props
 * -----
 * snapshots  : RollingSnapshot[]  — managed in page.tsx state, passed down.
 * earlyExtends: EarlyExtendSignal[] — EARLY_EXTEND events, also from page.tsx.
 * maxVisible  : number            — how many snapshots to show in mini-charts
 *                                   (default 20).
 *
 * The component is purely presentational — all data lives in the parent.
 */

import React, { useMemo } from "react";
import {
  AreaChart,
  Area,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

// ── Types (mirror what page.tsx creates) ─────────────────────────────────────

export interface LaneDatum {
  lane: string;
  vehicle_count: number;
  queue_length: number;
  avg_wait_time: number;
  green_time: number;
}

/** One entry in the rolling buffer — created from each PHASE_UPDATE message. */
export interface RollingSnapshot {
  timestamp: number;          // Unix seconds
  phase_name: string;
  lane_data: LaneDatum[];
  total_vehicles: number;     // sum across all lanes
  avg_queue: number;          // mean queue_length across lanes
  avg_wait: number;           // mean avg_wait_time across lanes
}

export interface EarlyExtendSignal {
  lane: string;
  arrival_rate: number;
  severity: "mild" | "moderate" | "high";
  recommendation: string;
  timestamp: number;
}

interface Props {
  snapshots: RollingSnapshot[];
  earlyExtends?: EarlyExtendSignal[];
  emergencyCount?: number;
  maxVisible?: number;
}

// ── Helper to format a Unix timestamp as HH:MM:SS ────────────────────────────

function fmtTime(ts: number): string {
  return new Date(ts * 1000).toLocaleTimeString([], { hour12: false });
}

// ── KPI Card ─────────────────────────────────────────────────────────────────

interface KpiCardProps {
  label: string;
  value: string | number;
  unit?: string;
  trend?: "up" | "down" | "neutral";
  accent?: string;   // Tailwind border-color class
  children?: React.ReactNode;
}

function KpiCard({ label, value, unit, trend, accent = "border-blue-500", children }: KpiCardProps) {
  const trendIcon =
    trend === "up" ? "▲" : trend === "down" ? "▼" : "─";
  const trendColor =
    trend === "up"
      ? "text-red-400"
      : trend === "down"
      ? "text-green-400"
      : "text-gray-400";

  return (
    <div
      className={`bg-gray-900 rounded-xl border-l-4 ${accent} p-4 flex flex-col gap-2`}
    >
      <p className="text-xs text-gray-400 uppercase tracking-widest">{label}</p>
      <div className="flex items-baseline gap-1">
        <span className="text-3xl font-bold text-white">{value}</span>
        {unit && <span className="text-sm text-gray-400">{unit}</span>}
        <span className={`ml-auto text-sm font-semibold ${trendColor}`}>
          {trendIcon}
        </span>
      </div>
      {children}
    </div>
  );
}

// ── Surge Badge ───────────────────────────────────────────────────────────────

const SEVERITY_CLASSES: Record<string, string> = {
  mild:     "bg-yellow-900 text-yellow-300 border border-yellow-600",
  moderate: "bg-orange-900 text-orange-300 border border-orange-600",
  high:     "bg-red-900   text-red-300   border border-red-600",
};

function SurgeBadge({ signal }: { signal: EarlyExtendSignal }) {
  return (
    <div
      className={`rounded-lg px-3 py-2 text-xs ${SEVERITY_CLASSES[signal.severity]}`}
    >
      <span className="font-bold uppercase">{signal.lane}</span>
      {" · "}
      <span>{signal.severity}</span>
      {" · "}
      <span>{signal.arrival_rate.toFixed(2)} veh/s</span>
      <p className="mt-1 text-gray-300 line-clamp-1">{signal.recommendation}</p>
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function AnalyticsPanel({
  snapshots,
  earlyExtends = [],
  emergencyCount = 0,
  maxVisible = 20,
}: Props) {
  const visible = snapshots.slice(-maxVisible);

  // Derived KPIs from the most recent snapshot.
  const latest = visible[visible.length - 1];
  const prev    = visible[visible.length - 2];

  const avgWait = latest ? parseFloat(latest.avg_wait.toFixed(1)) : 0;
  const prevWait = prev  ? parseFloat(prev.avg_wait.toFixed(1))   : avgWait;
  const waitTrend: "up" | "down" | "neutral" =
    avgWait > prevWait ? "up" : avgWait < prevWait ? "down" : "neutral";

  const throughput = latest?.total_vehicles ?? 0;
  const prevThroughput = prev?.total_vehicles ?? throughput;
  const throughputTrend: "up" | "down" | "neutral" =
    throughput > prevThroughput
      ? "up"
      : throughput < prevThroughput
      ? "down"
      : "neutral";

  const avgQueue = latest ? parseFloat(latest.avg_queue.toFixed(1)) : 0;
  const prevQueue = prev  ? parseFloat(prev.avg_queue.toFixed(1))   : avgQueue;
  const queueTrend: "up" | "down" | "neutral" =
    avgQueue > prevQueue ? "up" : avgQueue < prevQueue ? "down" : "neutral";

  // Chart data.
  const chartData = useMemo(
    () =>
      visible.map((s) => ({
        t: fmtTime(s.timestamp),
        wait: parseFloat(s.avg_wait.toFixed(1)),
        queue: parseFloat(s.avg_queue.toFixed(1)),
        vehicles: s.total_vehicles,
      })),
    [visible]
  );

  const recentSurges = earlyExtends.slice(-4).reverse();

  return (
    <div className="flex flex-col gap-5 w-full font-sans">
      {/* ── KPI Row ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Avg Wait Time */}
        <KpiCard
          label="Avg Wait Time"
          value={avgWait}
          unit="s"
          trend={waitTrend}
          accent="border-blue-500"
        >
          <ResponsiveContainer width="100%" height={48}>
            <AreaChart data={chartData}>
              <defs>
                <linearGradient id="gWait" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor="#3b82f6" stopOpacity={0.4} />
                  <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}   />
                </linearGradient>
              </defs>
              <Area
                type="monotone"
                dataKey="wait"
                stroke="#3b82f6"
                fill="url(#gWait)"
                dot={false}
                strokeWidth={1.5}
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </KpiCard>

        {/* Throughput */}
        <KpiCard
          label="Throughput"
          value={throughput}
          unit="veh"
          trend={throughputTrend}
          accent="border-emerald-500"
        >
          <ResponsiveContainer width="100%" height={48}>
            <AreaChart data={chartData}>
              <defs>
                <linearGradient id="gVeh" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor="#10b981" stopOpacity={0.4} />
                  <stop offset="95%" stopColor="#10b981" stopOpacity={0}   />
                </linearGradient>
              </defs>
              <Area
                type="monotone"
                dataKey="vehicles"
                stroke="#10b981"
                fill="url(#gVeh)"
                dot={false}
                strokeWidth={1.5}
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </KpiCard>

        {/* Avg Queue Length */}
        <KpiCard
          label="Avg Queue"
          value={avgQueue}
          unit="veh"
          trend={queueTrend}
          accent="border-amber-500"
        >
          <ResponsiveContainer width="100%" height={48}>
            <AreaChart data={chartData}>
              <defs>
                <linearGradient id="gQ" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor="#f59e0b" stopOpacity={0.4} />
                  <stop offset="95%" stopColor="#f59e0b" stopOpacity={0}   />
                </linearGradient>
              </defs>
              <Area
                type="monotone"
                dataKey="queue"
                stroke="#f59e0b"
                fill="url(#gQ)"
                dot={false}
                strokeWidth={1.5}
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </KpiCard>

        {/* Emergency Count */}
        <KpiCard
          label="Emergencies"
          value={emergencyCount}
          unit="total"
          trend="neutral"
          accent="border-red-500"
        >
          <p className="text-xs text-gray-500 mt-1">
            Since session start
          </p>
        </KpiCard>
      </div>

      {/* ── Full-width Wait + Queue line chart ── */}
      <div className="bg-gray-900 rounded-xl p-4">
        <p className="text-xs text-gray-400 uppercase tracking-widest mb-3">
          Wait Time &amp; Queue — last {maxVisible} phases
        </p>
        <ResponsiveContainer width="100%" height={160}>
          <LineChart data={chartData}>
            <XAxis
              dataKey="t"
              tick={{ fill: "#9ca3af", fontSize: 10 }}
              tickLine={false}
              axisLine={false}
              interval="preserveStartEnd"
            />
            <YAxis
              tick={{ fill: "#9ca3af", fontSize: 10 }}
              tickLine={false}
              axisLine={false}
              width={28}
            />
            <Tooltip
              contentStyle={{
                background: "#111827",
                border: "1px solid #374151",
                borderRadius: 8,
                fontSize: 12,
              }}
              labelStyle={{ color: "#d1d5db" }}
              itemStyle={{ color: "#d1d5db" }}
            />
            <Line
              type="monotone"
              dataKey="wait"
              stroke="#3b82f6"
              dot={false}
              strokeWidth={2}
              name="Avg Wait (s)"
              isAnimationActive={false}
            />
            <Line
              type="monotone"
              dataKey="queue"
              stroke="#f59e0b"
              dot={false}
              strokeWidth={2}
              name="Avg Queue"
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* ── Surge signals ── */}
      {recentSurges.length > 0 && (
        <div className="bg-gray-900 rounded-xl p-4">
          <p className="text-xs text-gray-400 uppercase tracking-widest mb-3">
            Recent Surge Signals
          </p>
          <div className="flex flex-col gap-2">
            {recentSurges.map((s) => (
              <SurgeBadge key={`${s.lane}-${s.timestamp}`} signal={s} />
            ))}
          </div>
        </div>
      )}

      {snapshots.length === 0 && (
        <p className="text-center text-gray-600 text-sm py-8">
          Waiting for phase data…
        </p>
      )}
    </div>
  );
}
