import { useState } from "react";
import { ActivitySquare, Package, TrendingUp, DollarSign } from "lucide-react";
import Dashboard from "./sections/Dashboard";
import InventoryPage from "./sections/InventoryPage";
import SalesHistory from "./sections/SalesHistory";
import ServicePricing from "./sections/ServicePricing";

const SECTIONS = [
  { key: "dashboard", label: "Dashboard", icon: ActivitySquare },
  { key: "inventory", label: "Inventory", icon: Package },
  { key: "sales-history", label: "Sales History", icon: TrendingUp },
  { key: "service-pricing", label: "Service Pricing", icon: DollarSign },
] as const;

type SectionKey = (typeof SECTIONS)[number]["key"];

export default function Overview() {
  const [activeSection, setActiveSection] = useState<SectionKey>("dashboard");

  return (
    <div className="flex">
      <div className="w-56 shrink-0 bg-[#0c0c0b] border-r border-[#2a2a28] p-4 self-start sticky top-0">
        <h2 className="text-xs font-bold text-[#555] font-mono tracking-widest uppercase mb-4 px-3">Overview</h2>
        <nav className="space-y-1">
          {SECTIONS.map((section) => {
            const isActive = activeSection === section.key;
            return (
              <button
                key={section.key}
                onClick={() => setActiveSection(section.key)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-xs font-mono transition-colors ${
                  isActive
                    ? "bg-[#c8881a] text-[#0c0c0b] font-bold"
                    : "text-[#888] hover:text-[#e8e4da] hover:bg-[#1a1a18]"
                }`}
              >
                <section.icon className="w-4 h-4" />
                {section.label}
              </button>
            );
          })}
        </nav>
      </div>

      <div className="flex-1 px-8 py-8">
        {activeSection === "dashboard" && <Dashboard onNavigate={(s) => setActiveSection(s as SectionKey)} />}
        {activeSection === "inventory" && <InventoryPage />}
        {activeSection === "sales-history" && <SalesHistory />}
        {activeSection === "service-pricing" && <ServicePricing />}
      </div>
    </div>
  );
}
