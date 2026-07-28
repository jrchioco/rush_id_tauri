import { useState } from "react";
import { invoke } from "../../components/CompanionWidget/effieInvoke";
import { ThemedModal } from "../../components/ThemedModal";
import type { Sale } from "../../types";

const TAB_OPTIONS = [
  { value: "", label: "None / Other" },
  { value: "single", label: "Single" },
  { value: "multi", label: "Multi" },
  { value: "passport", label: "Passport" },
  { value: "polaroid", label: "Polaroid" },
  { value: "other", label: "Other" },
];

interface Props {
  sale: Sale | null;
  onClose: () => void;
  onSave: () => void;
}

export default function AddEditSaleModal({ sale, onClose, onSave }: Props) {
  const [tab, setTab] = useState(sale?.tab ?? "");
  const [amount, setAmount] = useState(String(sale?.amount ?? ""));
  const [quantity, setQuantity] = useState(String(sale?.quantity ?? "1"));
  const [note, setNote] = useState(sale?.note ?? "");
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (amount === "" || parseFloat(amount) <= 0) return;
    setSaving(true);
    try {
      const params = {
        tab: tab || null,
        templateKey: sale?.template_key ?? null,
        amount: parseFloat(amount),
        quantity: parseInt(quantity) || 1,
        note: note.trim() || null,
      };
      if (sale) {
        await invoke("update_sale", { id: sale.id, ...params });
      } else {
        await invoke("add_sale", params);
      }
      onSave();
    } catch {
    } finally {
      setSaving(false);
    }
  };

  return (
    <ThemedModal open onClose={onClose}>
      <form onSubmit={handleSubmit} className="p-6 w-[400px]">
        <h2 className="text-sm font-bold text-[#e8e4da] tracking-wide mb-4">
          {sale ? "Edit Sale" : "Add Sale"}
        </h2>

        {sale && (
          <div className="mb-3 space-y-2">
            <div className="px-3 py-2 bg-[#1a1a18] border border-[#2a2a28] rounded-lg">
              <span className="text-xs font-mono text-[#555]">Source: </span>
              <span className={`text-xs font-mono font-bold ${sale.source === "auto" ? "text-[#c8881a]" : "text-[#888]"}`}>
                {sale.source === "auto" ? "Auto (export)" : "Manual"}
              </span>
            </div>
            {sale.template_key && (
              <div className="px-3 py-2 bg-[#1a1a18] border border-[#2a2a28] rounded-lg">
                <span className="text-xs font-mono text-[#555]">Template: </span>
                <span className="text-xs font-mono text-[#e8e4da]">{sale.template_key}</span>
              </div>
            )}
          </div>
        )}

        <div className="space-y-3">
          <div>
            <label className="block text-xs text-[#555] font-mono mb-1">Tab</label>
            <select
              value={tab}
              onChange={(e) => setTab(e.target.value)}
              className="w-full bg-[#1a1a18] border border-[#2a2a28] rounded-lg px-3 py-2 text-xs font-mono text-[#e8e4da] outline-none focus:border-[#c8881a] transition-colors"
            >
              {TAB_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-[#555] font-mono mb-1">Amount (₱)</label>
              <input
                type="number"
                step="any"
                min="0"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="w-full bg-[#1a1a18] border border-[#2a2a28] rounded-lg px-3 py-2 text-xs font-mono text-[#e8e4da] outline-none focus:border-[#c8881a] transition-colors"
                required
              />
            </div>
            <div>
              <label className="block text-xs text-[#555] font-mono mb-1">Quantity</label>
              <input
                type="number"
                min="1"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                className="w-full bg-[#1a1a18] border border-[#2a2a28] rounded-lg px-3 py-2 text-xs font-mono text-[#e8e4da] outline-none focus:border-[#c8881a] transition-colors"
                required
              />
            </div>
          </div>

          <div>
            <label className="block text-xs text-[#555] font-mono mb-1">Note</label>
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Reprint - customer request..."
              className="w-full bg-[#1a1a18] border border-[#2a2a28] rounded-lg px-3 py-2 text-xs font-mono text-[#e8e4da] outline-none focus:border-[#c8881a] transition-colors"
            />
          </div>
        </div>

        <div className="flex justify-end gap-2 mt-6">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 bg-[#1a1a18] border border-[#2a2a28] rounded-lg text-xs font-mono text-[#888] hover:text-[#e8e4da] transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving || amount === "" || parseFloat(amount) <= 0}
            className="px-4 py-2 bg-[#c8881a] text-[#0c0c0b] rounded-lg text-xs font-mono font-bold hover:bg-[#d9992b] transition-colors disabled:opacity-50"
          >
            {saving ? "Saving..." : sale ? "Update" : "Add"}
          </button>
        </div>
      </form>
    </ThemedModal>
  );
}
