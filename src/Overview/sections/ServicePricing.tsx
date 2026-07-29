import { useState, useEffect, useCallback } from "react";
import { invoke } from "../../components/CompanionWidget/effieInvoke";
import { DollarSign, Check } from "lucide-react";
import type { Service, PricingTier } from "../../types";

const DISPLAY_GROUPS = [
  { label: "Rush ID", tabs: ["single", "passport"] },
  { label: "Polaroid", tabs: ["polaroid"] },
  { label: "Other", tabs: ["other"] },
];

interface TierConfig {
  templateKey: string;
  type: "base" | "independent" | "flat";
  layouts?: string[];
}

const TIER_CONFIGS: TierConfig[] = [
  { templateKey: "3r", type: "base", layouts: ["2pcs", "4pcs"] },
  { templateKey: "5r", type: "base", layouts: ["1pcs", "2pcs"] },
  { templateKey: "4r", type: "base", layouts: ["2pcs", "3pcs"] },
  { templateKey: "8r", type: "base", layouts: ["1pcs"] },
  { templateKey: "wallet", type: "independent", layouts: ["2pcs", "3pcs", "9pcs", "18pcs", "27pcs"] },
];

function PriceInput({ value, onSave }: { value: number; onSave: (price: number) => void }) {
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(String(value));
  const [saved, setSaved] = useState(false);

  const save = () => {
    const price = parseFloat(editValue);
    if (isNaN(price) || price < 0) return;
    onSave(price);
    setEditing(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  if (editing) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-xs font-mono text-[#888]">₱</span>
        <input
          type="number"
          step="any"
          min="0"
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") save();
            if (e.key === "Escape") setEditing(false);
          }}
          onBlur={save}
          autoFocus
          className="w-24 bg-[#1a1a18] border border-[#c8881a] rounded px-2 py-1 text-xs font-mono text-[#e8e4da] outline-none text-right"
        />
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3">
      <button
        onClick={() => { setEditing(true); setEditValue(String(value)); }}
        className={`px-3 py-1 rounded text-xs font-mono text-right min-w-[80px] transition-colors ${
          value > 0
            ? "text-[#e8e4da] hover:bg-[#1a1a18]"
            : "text-[#555] hover:bg-[#1a1a18] hover:text-[#888]"
        }`}
      >
        {value > 0 ? `₱${value.toLocaleString()}` : "Set price"}
      </button>
      {saved && <Check className="w-4 h-4 text-green-500" />}
    </div>
  );
}

function FlatPriceInput({ service, onSave }: { service: Service; onSave: (price: number) => void }) {
  return (
    <div className="flex items-center justify-between px-5 py-3 hover:bg-[#111110]/50 transition-colors">
      <div className="flex-1 min-w-0">
        <p className="text-xs font-mono text-[#e8e4da]">{service.display_name}</p>
        <p className="text-[10px] font-mono text-[#555]">{service.template_key}</p>
      </div>
      <PriceInput value={service.price} onSave={onSave} />
    </div>
  );
}

function TierPriceInputs({ service, tiers, onSave }: { service: Service; tiers: PricingTier[]; onSave: (tierId: number, price: number) => void }) {
  return (
    <div className="px-5 py-3">
      <div className="flex items-center mb-2">
        <p className="text-xs font-mono text-[#e8e4da]">{service.display_name}</p>
        <p className="text-[10px] font-mono text-[#555] ml-2">{service.template_key}</p>
      </div>
      <div className="space-y-2 ml-4">
        {tiers.map((tier) => (
          <div key={tier.id} className="flex items-center justify-between">
            <span className="text-[10px] font-mono text-[#888]">{tier.layout}</span>
            <PriceInput value={tier.price} onSave={(price) => onSave(tier.id, price)} />
          </div>
        ))}
      </div>
    </div>
  );
}

export default function ServicePricing() {
  const [services, setServices] = useState<Service[]>([]);
  const [tiers, setTiers] = useState<Record<number, PricingTier[]>>({});
  const [loading, setLoading] = useState(true);

  const fetchServices = useCallback((initial = false) => {
    if (initial) setLoading(true);
    invoke<Service[]>("get_services")
      .then(async (data) => {
        setServices(data);
        const tiersMap: Record<number, PricingTier[]> = {};
        for (const service of data) {
          const serviceTiers = await invoke<PricingTier[]>("get_pricing_tiers", {
            serviceId: service.id
          });
          tiersMap[service.id] = serviceTiers;
        }
        setTiers(tiersMap);
      })
      .catch(() => {})
      .finally(() => { if (initial) setLoading(false); });
  }, []);

  useEffect(() => { fetchServices(true); }, [fetchServices]);

  const isMainService = (s: Service) => !s.template_key.startsWith("multi_") && !s.template_key.startsWith("Dev ") && s.template_key !== "4r2pcs" && s.template_key !== "4r3pcs";

  const grouped = DISPLAY_GROUPS.reduce((acc, { label, tabs }) => {
    const items = services.filter((s) => s.tab && tabs.includes(s.tab) && isMainService(s));
    if (items.length > 0) acc.push({ label, items });
    return acc;
  }, [] as { label: string; items: Service[] }[]);

  const mainServices = services.filter(isMainService);
  const pricedCount = mainServices.filter((s) => s.price > 0).length;

  const saveServicePrice = async (service: Service, price: number) => {
    try {
      await invoke("update_service_price", { id: service.id, price });
      fetchServices();
    } catch {}
  };

  const saveTierPrice = async (tierId: number, price: number) => {
    try {
      await invoke("update_pricing_tier", { id: tierId, price });
      fetchServices();
    } catch {}
  };

  const renderService = (service: Service) => {
    const config = TIER_CONFIGS.find((c) => c.templateKey === service.template_key);

    if (!config || config.type === "flat") {
      return <FlatPriceInput service={service} onSave={(price) => saveServicePrice(service, price)} />;
    }

    const serviceTiers = tiers[service.id] || [];

    if (config.type === "base") {
      const baseTiers = serviceTiers.filter((t) => config.layouts?.includes(t.layout));
      return <TierPriceInputs service={service} tiers={baseTiers} onSave={saveTierPrice} />;
    }

    if (config.type === "independent") {
      return <TierPriceInputs service={service} tiers={serviceTiers} onSave={saveTierPrice} />;
    }

    return <FlatPriceInput service={service} onSave={(price) => saveServicePrice(service, price)} />;
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-lg font-bold text-[#e8e4da] tracking-wide">Service Pricing</h1>
          <p className="text-xs text-[#555] font-mono mt-1">Manage pricing for your templates</p>
        </div>
        <div className="text-xs font-mono text-[#888]">
          {pricedCount} of {mainServices.length} priced
        </div>
      </div>

      {loading ? (
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-20 bg-[#1a1a18] rounded-xl animate-pulse" />
          ))}
        </div>
      ) : services.length === 0 ? (
        <div className="bg-[#0c0c0b] border border-[#2a2a28] rounded-xl p-12 text-center">
          <DollarSign className="w-8 h-8 text-[#555] mx-auto mb-3" />
          <p className="text-xs text-[#555] font-mono">No templates found</p>
        </div>
      ) : (
        <div className="space-y-6">
          {grouped.map(({ label, items }) => (
            <div key={label} className="bg-[#0c0c0b] border border-[#2a2a28] rounded-xl overflow-hidden">
              <div className="px-5 py-3 border-b border-[#2a2a28] bg-[#111110]">
                <h2 className="text-xs font-bold text-[#e8e4da] font-mono tracking-wide">{label}</h2>
              </div>
              <div className="divide-y divide-[#2a2a28]/50">
                {items.map((service) => (
                  <div key={service.id}>
                    {renderService(service)}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
