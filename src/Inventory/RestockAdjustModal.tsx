import { useState } from "react";
import { invoke } from "../components/CompanionWidget/effieInvoke";
import { ThemedModal } from "../components/ThemedModal";
import type { Material } from "../types";

interface Props {
  material: Material;
  onClose: () => void;
  onSave: () => void;
}

export default function RestockAdjustModal({ material, onClose, onSave }: Props) {
  const [mode, setMode] = useState<"restock" | "adjust">("restock");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const val = parseFloat(amount);
    if (isNaN(val) || val === 0) return;
    setSaving(true);
    try {
      if (mode === "restock") {
        await invoke("restock_material", { id: material.id, amount: Math.abs(val) });
      } else {
        await invoke("adjust_stock", {
          id: material.id,
          amount: val,
          reason: reason.trim() || null,
        });
      }
      onSave();
    } catch {
    } finally {
      setSaving(false);
    }
  };

  return (
    <ThemedModal open onClose={onClose}>
      <form onSubmit={handleSubmit} className="p-6 w-[360px]">
        <h2 className="text-sm font-bold text-[#e8e4da] tracking-wide mb-1">
          {mode === "restock" ? "Restock" : "Adjust"} Stock
        </h2>
        <p className="text-xs text-[#555] font-mono mb-4">
          {material.name} — current: {material.current_stock} {material.unit}
        </p>

        <div className="flex gap-2 mb-4">
          <button
            type="button"
            onClick={() => setMode("restock")}
            className={`flex-1 py-2 rounded-lg text-xs font-mono transition-colors ${
              mode === "restock"
                ? "bg-[#c8881a] text-[#0c0c0b] font-bold"
                : "bg-[#1a1a18] border border-[#2a2a28] text-[#888] hover:text-[#e8e4da]"
            }`}
          >
            Restock
          </button>
          <button
            type="button"
            onClick={() => setMode("adjust")}
            className={`flex-1 py-2 rounded-lg text-xs font-mono transition-colors ${
              mode === "adjust"
                ? "bg-[#c8881a] text-[#0c0c0b] font-bold"
                : "bg-[#1a1a18] border border-[#2a2a28] text-[#888] hover:text-[#e8e4da]"
            }`}
          >
            Adjust
          </button>
        </div>

        <div className="space-y-3">
          <div>
            <label className="block text-xs text-[#555] font-mono mb-1">
              {mode === "restock" ? "Amount to add" : "Amount (+/-)"}
            </label>
            <input
              type="number"
              step="any"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder={mode === "restock" ? "e.g. 50" : "e.g. -5 or 10"}
              className="w-full bg-[#1a1a18] border border-[#2a2a28] rounded-lg px-3 py-2 text-xs font-mono text-[#e8e4da] outline-none focus:border-[#c8881a] transition-colors"
              required
            />
          </div>

          {mode === "adjust" && (
            <div>
              <label className="block text-xs text-[#555] font-mono mb-1">Reason (optional)</label>
              <input
                type="text"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="e.g. Damaged, Correction"
                className="w-full bg-[#1a1a18] border border-[#2a2a28] rounded-lg px-3 py-2 text-xs font-mono text-[#e8e4da] outline-none focus:border-[#c8881a] transition-colors"
              />
            </div>
          )}
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
            disabled={saving || amount === "" || parseFloat(amount) === 0}
            className="px-4 py-2 bg-[#c8881a] text-[#0c0c0b] rounded-lg text-xs font-mono font-bold hover:bg-[#d9992b] transition-colors disabled:opacity-50"
          >
            {saving ? "Saving..." : mode === "restock" ? "Restock" : "Adjust"}
          </button>
        </div>
      </form>
    </ThemedModal>
  );
}
