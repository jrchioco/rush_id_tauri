import { useState, useEffect, useMemo } from "react";
import { invoke } from "../../components/CompanionWidget/effieInvoke";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import type { SalesTrend } from "../../types";

function formatDate(iso: string): string {
  try {
    const d = new Date(iso + "T00:00:00");
    return d.toLocaleDateString([], { month: "short", day: "numeric" });
  } catch {
    return iso;
  }
}

function generateDateRange(days: number): string[] {
  const dates: string[] = [];
  const now = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    dates.push(d.toISOString().slice(0, 10));
  }
  return dates;
}

function RangeToggle({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <div className="flex items-center gap-1 bg-[#111110] border border-[#2a2a28] rounded-lg p-0.5">
      {([7, 30] as const).map((d) => (
        <button
          key={d}
          onClick={() => onChange(d)}
          className={`px-3 py-1.5 rounded-md text-xs font-mono transition-colors ${
            value === d
              ? "bg-[#c8881a] text-[#0c0c0b] font-bold"
              : "text-[#888] hover:text-[#e8e4da] hover:bg-[#1a1a18]"
          }`}
        >
          {d}d
        </button>
      ))}
    </div>
  );
}

function CustomTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ value: number }>; label?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-[#1a1a18] border border-[#2a2a28] rounded-lg px-3 py-2 shadow-lg">
      <p className="text-[10px] font-mono text-[#888]">{label ? formatDate(label) : ""}</p>
      <p className="text-xs font-mono text-[#c8881a] font-bold">₱{payload[0].value.toLocaleString()}</p>
    </div>
  );
}

export default function TrendsSection() {
  const [range, setRange] = useState(7);
  const [data, setData] = useState<SalesTrend[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    invoke<SalesTrend[]>("get_sales_trend", { days: range })
      .then(setData)
      .catch(() => setData([]))
      .finally(() => setLoading(false));
  }, [range]);

  const chartData = useMemo(() => {
    const allDates = generateDateRange(range);
    const byDate = new Map(data.map((d) => [d.date, d.total]));
    return allDates.map((date) => ({
      date,
      total: byDate.get(date) ?? 0,
    }));
  }, [data, range]);

  const hasData = data.length > 0;

  return (
    <div className="bg-[#0c0c0b] border border-[#2a2a28] rounded-xl p-6 mb-4">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-bold text-[#e8e4da] tracking-wide">Sales Trend</h2>
        <RangeToggle value={range} onChange={setRange} />
      </div>

      {loading ? (
        <div className="h-48 bg-[#1a1a18] rounded animate-pulse" />
      ) : !hasData ? (
        <div className="h-48 flex items-center justify-center">
          <p className="text-xs text-[#555] font-mono">No sales data yet</p>
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={200}>
          <LineChart data={chartData} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
            <XAxis
              dataKey="date"
              tickFormatter={formatDate}
              tick={{ fontSize: 10, fill: "#555", fontFamily: "monospace" }}
              axisLine={{ stroke: "#2a2a28" }}
              tickLine={false}
            />
            <YAxis
              tick={{ fontSize: 10, fill: "#555", fontFamily: "monospace" }}
              axisLine={false}
              tickLine={false}
              tickFormatter={(v) => `₱${v}`}
            />
            <Tooltip content={<CustomTooltip />} />
            <Line
              type="monotone"
              dataKey="total"
              stroke="#c8881a"
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4, fill: "#c8881a", stroke: "#0c0c0b", strokeWidth: 2 }}
            />
          </LineChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
