import { useState, useEffect } from "react";
import { invoke } from "../components/CompanionWidget/effieInvoke";
import { Package, TrendingUp, DollarSign } from "lucide-react";
import type { MaterialsSummary } from "../types";
import ActivitySummary from "./sections/ActivitySummary";

function ComingSoon({ title, icon: Icon }: { title: string; icon: typeof Package }) {
  return (
    <div className="bg-[#0c0c0b] border border-[#2a2a28] rounded-xl p-6">
      <div className="flex items-center gap-3 mb-2">
        <Icon className="w-5 h-5 text-[#555]" />
        <h3 className="text-sm font-bold text-[#e8e4da] tracking-wide">{title}</h3>
      </div>
      <p className="text-xs text-[#555] font-mono">Coming soon</p>
    </div>
  );
}

function InventoryCard() {
  const [summary, setSummary] = useState<MaterialsSummary | null>(null);

  useEffect(() => {
    invoke<MaterialsSummary>("get_materials_summary")
      .then(setSummary)
      .catch(() => {});
  }, []);

  const low = summary?.low_count ?? 0;

  return (
    <div className="bg-[#0c0c0b] border border-[#2a2a28] rounded-xl p-6">
      <div className="flex items-center gap-3 mb-2">
        <Package className="w-5 h-5 text-[#555]" />
        <h3 className="text-sm font-bold text-[#e8e4da] tracking-wide">Inventory</h3>
      </div>
      {summary ? (
        <div>
          <p className="text-xs text-[#555] font-mono">
            {summary.total} material{summary.total !== 1 ? "s" : ""}
          </p>
          {low > 0 ? (
            <p className="text-xs font-mono mt-1 text-[#c8881a]">
              {low} item{low !== 1 ? "s" : ""} low
            </p>
          ) : (
            <p className="text-xs text-[#555] font-mono mt-1">All stocked</p>
          )}
        </div>
      ) : (
        <p className="text-xs text-[#555] font-mono">Loading...</p>
      )}
    </div>
  );
}

export default function Overview() {
  return (
    <div className="max-w-6xl mx-auto px-6 py-8">
      <div className="mb-8">
        <h1 className="text-lg font-bold text-[#e8e4da] tracking-wide">Overview</h1>
        <p className="text-xs text-[#555] font-mono mt-1">Activity and summary at a glance</p>
      </div>

      <ActivitySummary />

      <div className="grid grid-cols-3 gap-4 mt-8">
        <InventoryCard />
        <ComingSoon title="Sales History" icon={TrendingUp} />
        <ComingSoon title="Service Pricing" icon={DollarSign} />
      </div>
    </div>
  );
}
