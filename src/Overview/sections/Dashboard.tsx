import { useState, useEffect } from "react";
import { invoke } from "../../components/CompanionWidget/effieInvoke";
import { FileDown, Printer, Layers, Files, DollarSign, TrendingUp } from "lucide-react";
import type { ActivityStats, ActivityEntry, SalesSummary, Sale } from "../../types";

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  } catch {
    return iso;
  }
}

function formatEvent(eventType: string): string {
  switch (eventType) {
    case "pdf_export": return "PDF Export";
    case "print_reminder_shown": return "Print Reminder";
    default: return eventType;
  }
}

function formatTab(tab: string | null): string {
  if (!tab) return "—";
  return tab.charAt(0).toUpperCase() + tab.slice(1);
}

interface StatCardProps {
  icon: typeof FileDown;
  label: string;
  value: number;
  valueDisplay?: string;
  subtitle?: string;
}

function StatCard({ icon: Icon, label, value, valueDisplay, subtitle }: StatCardProps) {
  return (
    <div className="bg-[#0c0c0b] border border-[#2a2a28] rounded-xl p-6">
      <div className="flex items-center justify-between mb-3">
        <Icon className="w-5 h-5 text-[#555]" />
      </div>
      <p className="text-3xl font-bold text-[#c8881a] font-mono">{valueDisplay ?? value}</p>
      <p className="text-xs text-[#555] font-mono mt-1">{label}</p>
      {subtitle && <p className="text-[10px] text-[#888] font-mono mt-0.5">{subtitle}</p>}
    </div>
  );
}

export default function Dashboard({ onNavigate }: { onNavigate?: (section: string) => void }) {
  const [stats, setStats] = useState<ActivityStats | null>(null);
  const [recent, setRecent] = useState<ActivityEntry[]>([]);
  const [salesSummary, setSalesSummary] = useState<SalesSummary | null>(null);
  const [recentSales, setRecentSales] = useState<Sale[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      invoke<ActivityStats>("get_activity_stats"),
      invoke<ActivityEntry[]>("get_recent_activity", { limit: 15 }),
      invoke<SalesSummary>("get_sales_summary"),
      invoke<Sale[]>("get_sales", { filter: "today" }),
    ])
      .then(([s, r, ss, sales]) => {
        setStats(s);
        setRecent(r);
        setSalesSummary(ss);
        setRecentSales(sales);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <div>
      <div className="grid grid-cols-5 gap-4 mb-8">
        <StatCard icon={FileDown} label="PDFs Exported Today" value={stats?.pdf_exports ?? 0} />
        <StatCard icon={Printer} label="Print Reminders Today" value={stats?.print_reminders ?? 0} />
        <StatCard icon={Layers} label="Total Pages Exported" value={stats?.total_pages ?? 0} />
        <StatCard icon={Files} label="Multi-Page Batches" value={stats?.multi_page_batches ?? 0} />
        <StatCard icon={DollarSign} label="Today's Sales" value={salesSummary?.today_count ?? 0} valueDisplay={`₱${(salesSummary?.today_total ?? 0).toLocaleString()}`} subtitle={`${salesSummary?.today_count ?? 0} sale${(salesSummary?.today_count ?? 0) === 1 ? "" : "s"} today`} />
      </div>

      <div className="grid grid-cols-2 gap-6">
        <div className="bg-[#0c0c0b] border border-[#2a2a28] rounded-xl p-6">
          <h2 className="text-sm font-bold text-[#e8e4da] tracking-wide mb-4">Recent Activity</h2>

          {loading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-10 bg-[#1a1a18] rounded animate-pulse" />
              ))}
            </div>
          ) : recent.length === 0 ? (
            <p className="text-xs text-[#555] font-mono py-8 text-center">No activity recorded today</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b border-[#2a2a28]">
                    <th className="pb-3 text-xs font-mono text-[#555] font-normal">Time</th>
                    <th className="pb-3 text-xs font-mono text-[#555] font-normal">Event</th>
                    <th className="pb-3 text-xs font-mono text-[#555] font-normal">Tab</th>
                    <th className="pb-3 text-xs font-mono text-[#555] font-normal text-right">Pages</th>
                  </tr>
                </thead>
                <tbody>
                  {recent.map((entry, i) => (
                    <tr
                      key={entry.id}
                      className={`border-b border-[#2a2a28]/50 ${i % 2 === 1 ? "bg-[#111110]/50" : ""}`}
                    >
                      <td className="py-3 text-xs font-mono text-[#888]">{formatTime(entry.created_at)}</td>
                      <td className="py-3 text-xs font-mono text-[#e8e4da]">{formatEvent(entry.event_type)}</td>
                      <td className="py-3 text-xs font-mono text-[#888]">{formatTab(entry.tab)}</td>
                      <td className="py-3 text-xs font-mono text-[#888] text-right">
                        {entry.event_type === "print_reminder_shown" ? "—" : entry.page_count}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="bg-[#0c0c0b] border border-[#2a2a28] rounded-xl p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-bold text-[#e8e4da] tracking-wide">Today's Sales</h2>
            <button
              onClick={() => onNavigate?.("sales-history")}
              className="text-[10px] font-mono text-[#c8881a] hover:text-[#d9992b] transition-colors"
            >
              View All →
            </button>
          </div>

          {loading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-10 bg-[#1a1a18] rounded animate-pulse" />
              ))}
            </div>
          ) : recentSales.length === 0 ? (
            <div className="text-center py-8">
              <TrendingUp className="w-6 h-6 text-[#555] mx-auto mb-2" />
              <p className="text-xs text-[#555] font-mono">No sales recorded yet</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b border-[#2a2a28]">
                    <th className="pb-3 text-xs font-mono text-[#555] font-normal">Time</th>
                    <th className="pb-3 text-xs font-mono text-[#555] font-normal">Tab</th>
                    <th className="pb-3 text-xs font-mono text-[#555] font-normal">Template</th>
                    <th className="pb-3 text-xs font-mono text-[#555] font-normal text-right">Amount</th>
                    <th className="pb-3 text-xs font-mono text-[#555] font-normal text-right">Qty</th>
                    <th className="pb-3 text-xs font-mono text-[#555] font-normal">Source</th>
                  </tr>
                </thead>
                <tbody>
                  {recentSales.map((sale, i) => (
                    <tr
                      key={sale.id}
                      className={`border-b border-[#2a2a28]/50 ${i % 2 === 1 ? "bg-[#111110]/50" : ""}`}
                    >
                      <td className="py-3 text-xs font-mono text-[#888]">
                        {(() => {
                          try {
                            return new Date(sale.created_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
                          } catch {
                            return sale.created_at;
                          }
                        })()}
                      </td>
                      <td className="py-3 text-xs font-mono text-[#888]">{formatTab(sale.tab)}</td>
                      <td className="py-3 text-xs font-mono text-[#555]">{sale.template_key ?? "—"}</td>
                      <td className="py-3 text-xs font-mono text-[#e8e4da] text-right">₱{sale.amount.toLocaleString()}</td>
                      <td className="py-3 text-xs font-mono text-[#888] text-right">{sale.quantity}</td>
                      <td className="py-3 text-xs font-mono">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                          sale.source === "auto"
                            ? "bg-[#c8881a]/20 text-[#c8881a]"
                            : "bg-[#2a2a28] text-[#888]"
                        }`}>
                          {sale.source === "auto" ? "Auto" : "Manual"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
