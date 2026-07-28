import { useState, useEffect, useCallback } from "react";
import { invoke } from "../../components/CompanionWidget/effieInvoke";
import { TrendingUp, Plus, Pencil, Trash2 } from "lucide-react";
import type { Sale } from "../../types";
import AddEditSaleModal from "./AddEditSaleModal";

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  } catch {
    return iso;
  }
}

function formatTab(tab: string | null): string {
  if (!tab) return "—";
  return tab.charAt(0).toUpperCase() + tab.slice(1);
}

export default function SalesHistory() {
  const [sales, setSales] = useState<Sale[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingSale, setEditingSale] = useState<Sale | null>(null);

  const fetchSales = useCallback(() => {
    setLoading(true);
    invoke<Sale[]>("get_sales", { limit: 15 })
      .then(setSales)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { fetchSales(); }, [fetchSales]);

  const handleDelete = async (id: number) => {
    if (!confirm("Delete this sale?")) return;
    try {
      await invoke("delete_sale", { id });
      fetchSales();
    } catch {}
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-lg font-bold text-[#e8e4da] tracking-wide">Sales History</h1>
          <p className="text-xs text-[#555] font-mono mt-1">Track your sales over time</p>
        </div>
        <button
          onClick={() => { setEditingSale(null); setModalOpen(true); }}
          className="flex items-center gap-2 px-4 py-2 bg-[#c8881a] text-[#0c0c0b] rounded-lg text-xs font-mono font-bold hover:bg-[#d9992b] transition-colors"
        >
          <Plus className="w-4 h-4" />
          Add Sale
        </button>
      </div>

      <div className="bg-[#0c0c0b] border border-[#2a2a28] rounded-xl p-6">
        {loading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-10 bg-[#1a1a18] rounded animate-pulse" />
            ))}
          </div>
        ) : sales.length === 0 ? (
          <div className="text-center py-12">
            <TrendingUp className="w-8 h-8 text-[#555] mx-auto mb-3" />
            <p className="text-xs text-[#555] font-mono">No sales recorded yet</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-[#2a2a28]">
                  <th className="pb-3 text-xs font-mono text-[#555] font-normal">Time</th>
                  <th className="pb-3 text-xs font-mono text-[#555] font-normal">Tab</th>
                  <th className="pb-3 text-xs font-mono text-[#555] font-normal text-right">Amount</th>
                  <th className="pb-3 text-xs font-mono text-[#555] font-normal text-right">Qty</th>
                  <th className="pb-3 text-xs font-mono text-[#555] font-normal">Source</th>
                  <th className="pb-3 text-xs font-mono text-[#555] font-normal text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {sales.map((sale, i) => (
                  <tr
                    key={sale.id}
                    className={`border-b border-[#2a2a28]/50 ${i % 2 === 1 ? "bg-[#111110]/50" : ""}`}
                  >
                    <td className="py-3 text-xs font-mono text-[#888]">{formatTime(sale.created_at)}</td>
                    <td className="py-3 text-xs font-mono text-[#888]">{formatTab(sale.tab)}</td>
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
                    <td className="py-3 text-xs font-mono text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => { setEditingSale(sale); setModalOpen(true); }}
                          className="p-1 text-[#555] hover:text-[#e8e4da] transition-colors"
                          title="Edit"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => handleDelete(sale.id)}
                          className="p-1 text-[#555] hover:text-red-500 transition-colors"
                          title="Delete"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {modalOpen && (
        <AddEditSaleModal
          sale={editingSale}
          onClose={() => { setModalOpen(false); setEditingSale(null); }}
          onSave={() => { setModalOpen(false); setEditingSale(null); fetchSales(); }}
        />
      )}
    </div>
  );
}
