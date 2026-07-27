import { useState, useEffect } from "react";
import { invoke } from "../../components/CompanionWidget/effieInvoke";
import { FileDown, Printer, Layers, Files } from "lucide-react";
import type { ActivityStats, ActivityEntry } from "../../types";

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
}

function StatCard({ icon: Icon, label, value }: StatCardProps) {
  return (
    <div className="bg-[#0c0c0b] border border-[#2a2a28] rounded-xl p-6">
      <div className="flex items-center justify-between mb-3">
        <Icon className="w-5 h-5 text-[#555]" />
      </div>
      <p className="text-3xl font-bold text-[#c8881a] font-mono">{value}</p>
      <p className="text-xs text-[#555] font-mono mt-1">{label}</p>
    </div>
  );
}

export default function ActivitySummary() {
  const [stats, setStats] = useState<ActivityStats | null>(null);
  const [recent, setRecent] = useState<ActivityEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      invoke<ActivityStats>("get_activity_stats"),
      invoke<ActivityEntry[]>("get_recent_activity", { limit: 15 }),
    ])
      .then(([s, r]) => {
        setStats(s);
        setRecent(r);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="max-w-6xl mx-auto px-6 py-8">
      <div className="mb-8">
        <h1 className="text-lg font-bold text-[#e8e4da] tracking-wide">Activity</h1>
        <p className="text-xs text-[#555] font-mono mt-1">Today's Activity</p>
      </div>

      <div className="grid grid-cols-4 gap-4 mb-8">
        <StatCard icon={FileDown} label="PDFs Exported Today" value={stats?.pdf_exports ?? 0} />
        <StatCard icon={Printer} label="Print Reminders Today" value={stats?.print_reminders ?? 0} />
        <StatCard icon={Layers} label="Total Pages Exported" value={stats?.total_pages ?? 0} />
        <StatCard icon={Files} label="Multi-Page Batches" value={stats?.multi_page_batches ?? 0} />
      </div>

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
    </div>
  );
}
