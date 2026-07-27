import { DollarSign } from "lucide-react";

export default function ServicePricing() {
  return (
    <div>
      <div className="mb-8">
        <h1 className="text-lg font-bold text-[#e8e4da] tracking-wide">Service Pricing</h1>
        <p className="text-xs text-[#555] font-mono mt-1">Manage pricing for your services</p>
      </div>
      <div className="bg-[#0c0c0b] border border-[#2a2a28] rounded-xl p-12 text-center">
        <DollarSign className="w-8 h-8 text-[#555] mx-auto mb-3" />
        <p className="text-sm text-[#555] font-mono">Coming soon</p>
      </div>
    </div>
  );
}
