"use client";

import { Area, AreaChart, Cell, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis, CartesianGrid } from "recharts";
import type { CategorySlice, DayBucket } from "@/lib/analytics";

const CATEGORY_COLOURS = ["#3478f6", "#47d7a0", "#f4bd50"];
const tooltipStyle = { background: "#101216", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 8, color: "#f5f5f5", fontSize: 12 };

export function ActivityChart({ series }: { series: DayBucket[] }) {
  return (
    <div className="chart-plot">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={series} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
          <XAxis dataKey="day" tick={{ fill: "#747983", fontSize: 11 }} tickFormatter={(value: string) => value.slice(5)} axisLine={false} tickLine={false} />
          <YAxis allowDecimals={false} tick={{ fill: "#747983", fontSize: 11 }} axisLine={false} tickLine={false} width={28} />
          <Tooltip contentStyle={tooltipStyle} />
          <Line type="monotone" dataKey="received" name="Received" stroke="#3478f6" strokeWidth={2} dot={false} isAnimationActive={false} />
          <Line type="monotone" dataKey="processed" name="Processed" stroke="#47d7a0" strokeWidth={2} dot={false} isAnimationActive={false} />
          <Line type="monotone" dataKey="review" name="Needs review" stroke="#f4bd50" strokeWidth={2} dot={false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export function CategoryChart({ slices }: { slices: CategorySlice[] }) {
  const total = slices.reduce((sum, slice) => sum + slice.count, 0);
  return (
    <div className="grid items-center gap-2 sm:grid-cols-[132px_minmax(0,1fr)]">
      <div className="relative h-[148px]">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={slices} dataKey="count" nameKey="label" innerRadius={42} outerRadius={62} paddingAngle={2} stroke="none" isAnimationActive={false}>
              {slices.map((slice, index) => <Cell key={slice.key} fill={CATEGORY_COLOURS[index % CATEGORY_COLOURS.length]} />)}
            </Pie>
            <Tooltip contentStyle={tooltipStyle} />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-[18px] font-semibold tabular-nums">{total}</span>
          <span className="text-[10px] text-faint">Messages</span>
        </div>
      </div>
      <ul className="space-y-1.5 text-[12px]">
        {slices.map((slice, index) => (
          <li key={slice.key} className="flex items-center justify-between gap-2">
            <span className="flex min-w-0 items-center gap-2 text-muted">
              <span className="size-2 shrink-0 rounded-full" style={{ background: CATEGORY_COLOURS[index % CATEGORY_COLOURS.length] }} />
              <span className="truncate">{slice.label}</span>
            </span>
            <span className="shrink-0 tabular-nums">{slice.count} · {slice.percent}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

type DailyPoint = { day: string; orders: number; offeredMinor: number; delivered: number };

function dayLabel(value: string): string {
  const date = new Date(`${value}T12:00:00+05:30`);
  return new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" }).format(date);
}

/** Orders created and delivered per day, one count scale for both. */
export function OrderActivityChart({ data }: { data: DailyPoint[] }) {
  return (
    <div className="h-[208px]">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 10, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="created-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.32} />
              <stop offset="100%" stopColor="#3b82f6" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="delivered-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#f4bd50" stopOpacity={0.22} />
              <stop offset="100%" stopColor="#f4bd50" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="rgba(255,255,255,0.07)" vertical={false} />
          <XAxis dataKey="day" tick={{ fill: "#8b93a3", fontSize: 11 }} tickFormatter={dayLabel} axisLine={false} tickLine={false} interval="preserveStartEnd" minTickGap={22} />
          <YAxis allowDecimals={false} tick={{ fill: "#8b93a3", fontSize: 11 }} axisLine={false} tickLine={false} width={30} />
          <Tooltip contentStyle={tooltipStyle} cursor={{ stroke: "rgba(255,255,255,0.25)", strokeDasharray: "3 3" }} labelFormatter={(value) => dayLabel(String(value))} />
          <Area type="monotone" dataKey="orders" name="Created" stroke="#3b82f6" strokeWidth={2.4} fill="url(#created-fill)" dot={{ r: 3.5, fill: "#3b82f6", strokeWidth: 0 }} activeDot={{ r: 5 }} isAnimationActive={false} />
          <Area type="monotone" dataKey="delivered" name="Delivered" stroke="#f4bd50" strokeWidth={2.4} fill="url(#delivered-fill)" dot={{ r: 3.5, fill: "#f4bd50", strokeWidth: 0 }} activeDot={{ r: 5 }} isAnimationActive={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export function StageDonut({ slices, total }: { slices: Array<{ key: string; label: string; count: number; colour: string }>; total: number }) {
  const shown = slices.filter((s) => s.count > 0);
  return (
    <div className="relative mx-auto size-[172px] shrink-0">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie data={shown.length ? shown : [{ key: "none", label: "None", count: 1, colour: "rgba(255,255,255,0.08)" }]} dataKey="count" nameKey="label" innerRadius={58} outerRadius={84} paddingAngle={shown.length > 1 ? 2 : 0} cornerRadius={4} stroke="none" startAngle={90} endAngle={-270} isAnimationActive={false}>
            {(shown.length ? shown : [{ key: "none", colour: "rgba(255,255,255,0.08)" }]).map((slice) => <Cell key={slice.key} fill={slice.colour} />)}
          </Pie>
          {shown.length ? <Tooltip contentStyle={tooltipStyle} /> : null}
        </PieChart>
      </ResponsiveContainer>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-[28px] leading-none font-bold tracking-[-0.03em] tabular-nums">{total}</span>
        <span className="mt-1 text-[11.5px] text-muted">Open orders</span>
      </div>
    </div>
  );
}
