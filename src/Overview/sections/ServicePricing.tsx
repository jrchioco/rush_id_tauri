import { useState, useEffect, useCallback } from "react";
import { invoke } from "../../components/CompanionWidget/effieInvoke";
import { DollarSign, Check } from "lucide-react";
import type { Service } from "../../types";

const TAB_ORDER = ["single", "multi", "passport", "polaroid", "other"] as const;

const TAB_LABELS: Record<string, string> = {
  single: "Single",
  multi: "Multi",
  passport: "Passport",
  polaroid: "Polaroid",
  other: "Other",
};

export default function ServicePricing() {
  const [services, setServices] = useState<Service[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editValue, setEditValue] = useState("");
  const [savedId, setSavedId] = useState<number | null>(null);

  const fetchServices = useCallback(() => {
    setLoading(true);
    invoke<Service[]>("get_services")
      .then(setServices)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { fetchServices(); }, [fetchServices]);

  const grouped = TAB_ORDER.reduce((acc, tab) => {
    const items = services.filter((s) => s.tab === tab);
    if (items.length > 0) acc.push({ tab, items });
    return acc;
  }, [] as { tab: string; items: Service[] }[]);

  const pricedCount = services.filter((s) => s.price > 0).length;

  const startEdit = (service: Service) => {
    setEditingId(service.id);
    setEditValue(String(service.price));
    setSavedId(null);
  };

  const savePrice = async (service: Service) => {
    const price = parseFloat(editValue);
    if (isNaN(price) || price < 0) return;
    try {
      await invoke("update_service_price", { id: service.id, price });
      setSavedId(service.id);
      setEditingId(null);
      fetchServices();
      setTimeout(() => setSavedId(null), 1500);
    } catch {
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent, service: Service) => {
    if (e.key === "Enter") savePrice(service);
    if (e.key === "Escape") setEditingId(null);
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-lg font-bold text-[#e8e4da] tracking-wide">Service Pricing</h1>
          <p className="text-xs text-[#555] font-mono mt-1">Manage pricing for your templates</p>
        </div>
        <div className="text-xs font-mono text-[#888]">
          {pricedCount} of {services.length} priced
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
          {grouped.map(({ tab, items }) => (
            <div key={tab} className="bg-[#0c0c0b] border border-[#2a2a28] rounded-xl overflow-hidden">
              <div className="px-5 py-3 border-b border-[#2a2a28] bg-[#111110]">
                <h2 className="text-xs font-bold text-[#e8e4da] font-mono tracking-wide">{TAB_LABELS[tab] ?? tab}</h2>
              </div>
              <div className="divide-y divide-[#2a2a28]/50">
                {items.map((service) => (
                  <div key={service.id} className="flex items-center justify-between px-5 py-3 hover:bg-[#111110]/50 transition-colors">
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-mono text-[#e8e4da] truncate">{service.display_name}</p>
                      <p className="text-[10px] font-mono text-[#555] truncate">{service.template_key}</p>
                    </div>
                    <div className="flex items-center gap-3 ml-4">
                      {editingId === service.id ? (
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-mono text-[#888]">₱</span>
                          <input
                            type="number"
                            step="any"
                            min="0"
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            onKeyDown={(e) => handleKeyDown(e, service)}
                            onBlur={() => savePrice(service)}
                            autoFocus
                            className="w-24 bg-[#1a1a18] border border-[#c8881a] rounded px-2 py-1 text-xs font-mono text-[#e8e4da] outline-none text-right"
                          />
                        </div>
                      ) : (
                        <button
                          onClick={() => startEdit(service)}
                          className={`px-3 py-1 rounded text-xs font-mono text-right min-w-[80px] transition-colors ${
                            service.price > 0
                              ? "text-[#e8e4da] hover:bg-[#1a1a18]"
                              : "text-[#555] hover:bg-[#1a1a18] hover:text-[#888]"
                          }`}
                        >
                          {service.price > 0 ? `₱${service.price.toLocaleString()}` : "Set price"}
                        </button>
                      )}
                      {savedId === service.id && (
                        <Check className="w-4 h-4 text-green-500" />
                      )}
                    </div>
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
