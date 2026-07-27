import ActivitySummary from "./sections/ActivitySummary";
import { Package, TrendingUp, DollarSign } from "lucide-react";

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

export default function Overview() {
  return (
    <div className="max-w-6xl mx-auto px-6 py-8">
      <div className="mb-8">
        <h1 className="text-lg font-bold text-[#e8e4da] tracking-wide">Overview</h1>
        <p className="text-xs text-[#555] font-mono mt-1">Activity and summary at a glance</p>
      </div>

      <ActivitySummary />

      <div className="grid grid-cols-3 gap-4 mt-8">
        <ComingSoon title="Inventory" icon={Package} />
        <ComingSoon title="Sales History" icon={TrendingUp} />
        <ComingSoon title="Service Pricing" icon={DollarSign} />
      </div>
    </div>
  );
}
