"use client"
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'

interface Props {
  data: { lane: string; cars: number; bikes: number; buses: number; trucks: number }[]
}

export default function TrafficChart({ data }: Props) {
  const chartData = data.map(d => ({
    name: d.lane.toUpperCase(),
    total: d.cars + d.bikes + d.buses + d.trucks,
    cars: d.cars,
    heavy: d.buses + d.trucks,
    bikes: d.bikes
  }))

  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={chartData}>
          <XAxis dataKey="name" stroke="#94a3b8" />
          <YAxis stroke="#94a3b8" />
          <Tooltip 
            cursor={{ fill: 'rgba(255,255,255,0.05)' }} 
            contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '8px' }}
          />
          <Bar dataKey="cars" stackId="a" fill="#3b82f6" name="Cars" radius={[0, 0, 4, 4]} />
          <Bar dataKey="bikes" stackId="a" fill="#10b981" name="Bikes" />
          <Bar dataKey="heavy" stackId="a" fill="#f59e0b" name="Heavy" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
