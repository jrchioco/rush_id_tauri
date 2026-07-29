import { useState, useEffect, useMemo } from "react";
import { invoke } from "../../components/CompanionWidget/effieInvoke";
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import type { SalesTrend, TemplateBreakdown, Service } from "../../types";

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

function TrendTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ value: number }>; label?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-[#1a1a18] border border-[#2a2a28] rounded-lg px-3 py-2 shadow-lg">
      <p className="text-[10px] font-mono text-[#888]">{label ? formatDate(label) : ""}</p>
      <p className="text-xs font-mono text-[#c8881a] font-bold">₱{payload[0].value.toLocaleString()}</p>
    </div>
  );
}

function BreakdownTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: { name: string; total: number; quantity: number } }> }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="bg-[#1a1a18] border border-[#2a2a28] rounded-lg px-3 py-2 shadow-lg">
      <p className="text-[10px] font-mono text-[#888]">{d.name}</p>
      <p className="text-xs font-mono text-[#c8881a] font-bold">₱{d.total.toLocaleString()}</p>
      <p className="text-[10px] font-mono text-[#555]">{d.quantity} sold</p>
    </div>
  );
}

export default function TrendsSection() {
  const [range, setRange] = useState(7);
  const [trendData, setTrendData] = useState<SalesTrend[]>([]);
  const [breakdownData, setBreakdownData] = useState<TemplateBreakdown[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      invoke<SalesTrend[]>("get_sales_trend", { days: range }),
      invoke<TemplateBreakdown[]>("get_template_breakdown", { days: range }),
      invoke<Service[]>("get_services"),
    ])
      .then(([trend, breakdown, svcs]) => {
        setTrendData(trend);
        setBreakdownData(breakdown);
        setServices(svcs);
      })
      .catch(() => {
        setTrendData([]);
        setBreakdownData([]);
      })
      .finally(() => setLoading(false));
  }, [range]);

  const displayNameMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of services) {
      map.set(s.template_key, s.display_name);
    }
    return map;
  }, [services]);

  const chartData = useMemo(() => {
    const allDates = generateDateRange(range);
    const byDate = new Map(trendData.map((d) => [d.date, d.total]));
    return allDates.map((date) => ({
      date,
      total: byDate.get(date) ?? 0,
    }));
  }, [trendData, range]);

  const breakdownChartData = useMemo(() => {
    return breakdownData.map((d) => ({
      name: displayNameMap.get(d.template_key) ?? d.template_key,
      total: d.total,
      quantity: d.quantity,
    }));
  }, [breakdownData, displayNameMap]);

  const hasTrendData = trendData.length > 0;
  const hasBreakdownData = breakdownData.length > 0;

  return (
    <div className="bg-[#0c0c0b] border border-[#2a2a28] rounded-xl p-6 mb-4">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-bold text-[#e8e4da] tracking-wide">Trends</h2>
        <RangeToggle value={range} onChange={setRange} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Sales Trend Line Chart */}
        <div>
          <h3 className="text-xs font-mono text-[#555] mb-3">Sales Trend</h3>
          {loading ? (
            <div className="h-48 bg-[#1a1a18] rounded animate-pulse" />
          ) : !hasTrendData ? (
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
                <Tooltip content={<TrendTooltip />} />
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

        {/* Template Breakdown Bar Chart */}
        <div>
          <h3 className="text-xs font-mono text-[#555] mb-3">Template Breakdown</h3>
          {loading ? (
            <div className="h-48 bg-[#1a1a18] rounded animate-pulse" />
          ) : !hasBreakdownData ? (
            <div className="h-48 flex items-center justify-center">
              <p className="text-xs text-[#555] font-mono">No sales data yet</p>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={breakdownChartData} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                <XAxis
                  dataKey="name"
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
                <Tooltip content={<BreakdownTooltip />} />
                <Bar dataKey="total" fill="#c8881a" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>
    </div>
  );
}
