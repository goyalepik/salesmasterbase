"use client";

import { Bar, BarChart, Cell, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis, CartesianGrid } from "recharts";
import { inr, inrCompact } from "@/lib/ops-ui/format";
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

/** One measure per chart: never two y-scales on one plot. */
export function DailyBars({ data, measure }: { data: DailyPoint[]; measure: "orders" | "offeredMinor" }) {
  const money = measure === "offeredMinor";
  return (
    <div className="h-[150px]">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 6, right: 4, left: 0, bottom: 0 }} barCategoryGap={3}>
          <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
          <XAxis dataKey="day" tick={{ fill: "#747983", fontSize: 10 }} tickFormatter={dayLabel} axisLine={false} tickLine={false} interval="preserveStartEnd" minTickGap={18} />
          <YAxis
            allowDecimals={false}
            tick={{ fill: "#747983", fontSize: 10 }}
            axisLine={false}
            tickLine={false}
            width={money ? 44 : 26}
            tickFormatter={(value: number) => (money ? inrCompact(value) : String(value))}
          />
          <Tooltip
            cursor={{ fill: "rgba(255,255,255,0.05)" }}
            contentStyle={tooltipStyle}
            labelFormatter={(value) => dayLabel(String(value))}
            formatter={(value) => [money ? inr(Number(value)) : String(value), money ? "Offered" : "Orders"]}
          />
          <Bar dataKey={measure} fill="#3478f6" radius={[4, 4, 0, 0]} maxBarSize={22} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
