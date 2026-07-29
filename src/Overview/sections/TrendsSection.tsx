import { useState, useEffect, useMemo } from "react";
import { invoke } from "../../components/CompanionWidget/effieInvoke";
import { LineChart, Line, PieChart, Pie, Cell, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import type { SalesTrend, TemplateBreakdown } from "../../types";

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

const PIE_COLORS = ["#c8881a", "#a66e15", "#d4a24e", "#7a5010", "#e8c878", "#4d3208", "#f0daa8", "#2a1b04"];

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

function BreakdownLegend({ data }: { data: Array<{ name: string; total: number; color: string }> }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1.5 mt-3">
      {data.map((item) => (
        <div key={item.name} className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: item.color }} />
          <span className="text-[10px] font-mono text-[#888]">{item.name}</span>
        </div>
      ))}
    </div>
  );
}

export default function TrendsSection() {
  const [range, setRange] = useState(7);
  const [trendData, setTrendData] = useState<SalesTrend[]>([]);
  const [breakdownData, setBreakdownData] = useState<TemplateBreakdown[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      invoke<SalesTrend[]>("get_sales_trend", { days: range }),
      invoke<TemplateBreakdown[]>("get_template_breakdown", { days: range }),
    ])
      .then(([trend, breakdown]) => {
        setTrendData(trend);
        setBreakdownData(breakdown);
      })
      .catch(() => {
        setTrendData([]);
        setBreakdownData([]);
      })
      .finally(() => setLoading(false));
  }, [range]);

  const chartData = useMemo(() => {
    const allDates = generateDateRange(range);
    const byDate = new Map(trendData.map((d) => [d.date, d.total]));
    return allDates.map((date) => ({
      date,
      total: byDate.get(date) ?? 0,
    }));
  }, [trendData, range]);

  const breakdownChartData = useMemo(() => {
    return breakdownData.map((d, i) => ({
      name: d.template_key,
      total: d.total,
      quantity: d.quantity,
      color: PIE_COLORS[i % PIE_COLORS.length],
    }));
  }, [breakdownData]);

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
        <div className="lg:border-r lg:border-[#2a2a28] lg:pr-6">
          <h3 className="text-xs font-mono text-[#c8881a] mb-3">Sales Trend</h3>
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
                  tickFormatter={(v: number) => `₱${v}`}
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

        {/* Template Breakdown Donut Chart */}
        <div>
          <h3 className="text-xs font-mono text-[#c8881a] mb-3">Template Breakdown</h3>
          {loading ? (
            <div className="h-48 bg-[#1a1a18] rounded animate-pulse" />
          ) : !hasBreakdownData ? (
            <div className="h-48 flex items-center justify-center">
              <p className="text-xs text-[#555] font-mono">No sales data yet</p>
            </div>
          ) : (
            <>
              <ResponsiveContainer width="100%" height={200}>
                <PieChart>
                  <Pie
                    data={breakdownChartData}
                    dataKey="total"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    innerRadius={45}
                    outerRadius={65}
                    paddingAngle={2}
                    cornerRadius={4}
                    startAngle={90}
                    endAngle={-270}
                    label={({ name, percent, cx, cy, midAngle, innerRadius, outerRadius }: { name?: string; percent?: number; cx?: number; cy?: number; midAngle?: number; innerRadius?: number; outerRadius?: number }) => {
                      const RADIAN = Math.PI / 180;
                      const angle = (midAngle ?? 0) * RADIAN;
                      const ir = innerRadius ?? 45;
                      const or_ = outerRadius ?? 65;
                      const midR = (ir + or_) / 2;
                      const px = (cx ?? 0) + midR * Math.cos(angle);
                      const py = (cy ?? 0) - midR * Math.sin(angle);
                      const lr = or_ + 16;
                      const lx = (cx ?? 0) + lr * Math.cos(angle);
                      const ly = (cy ?? 0) - lr * Math.sin(angle);
                      const anchor = lx > (cx ?? 0) ? "start" : "end";
                      return (
                        <g pointerEvents="none">
                          <text x={px} y={py} textAnchor="middle" dominantBaseline="central" fontSize={9} fontFamily="monospace" fill="#0c0c0b" fontWeight="bold">
                            {((percent ?? 0) * 100).toFixed(0)}%
                          </text>
                          <line x1={(cx ?? 0) + (or_ + 4) * Math.cos(angle)} y1={(cy ?? 0) - (or_ + 4) * Math.sin(angle)} x2={(cx ?? 0) + (or_ + 12) * Math.cos(angle)} y2={(cy ?? 0) - (or_ + 12) * Math.sin(angle)} stroke="#555" strokeWidth={0.5} />
                          <text x={lx} y={ly} textAnchor={anchor} dominantBaseline="central" fontSize={9} fontFamily="monospace" fill="#888">
                            {name}
                          </text>
                        </g>
                      );
                    }}
                    labelLine={false}
                    strokeWidth={0}
                  >
                    {breakdownChartData.map((entry, i) => (
                      <Cell key={i} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip content={<BreakdownTooltip />} />
                </PieChart>
              </ResponsiveContainer>
              <BreakdownLegend data={breakdownChartData} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
