import { useState } from "react";
import { invoke } from "../../components/CompanionWidget/effieInvoke";
import { ThemedModal } from "../../components/ThemedModal";
import type { Material } from "../../types";

const TAB_OPTIONS = [
  { value: "", label: "None" },
  { value: "single", label: "Single" },
  { value: "multi", label: "Multi" },
  { value: "passport", label: "Passport" },
  { value: "polaroid", label: "Polaroid" },
  { value: "other", label: "Other" },
];

interface Props {
  material: Material | null;
  onClose: () => void;
  onSave: () => void;
}

export default function AddEditMaterialModal({ material, onClose, onSave }: Props) {
  const [name, setName] = useState(material?.name ?? "");
  const [unit, setUnit] = useState(material?.unit ?? "");
  const [stock, setStock] = useState(String(material?.current_stock ?? ""));
  const [threshold, setThreshold] = useState(String(material?.low_stock_threshold ?? "0"));
  const [linkedTab, setLinkedTab] = useState(material?.linked_tab ?? "");
  const [deduct, setDeduct] = useState(String(material?.deduct_per_export ?? "1"));
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !unit.trim() || stock === "") return;
    setSaving(true);
    try {
      const params = {
        name: name.trim(),
        unit: unit.trim(),
        current_stock: parseFloat(stock),
        low_stock_threshold: parseFloat(threshold) || 0,
        linked_tab: linkedTab || null,
        deduct_per_export: parseFloat(deduct) || 1,
      };
      if (material) {
        await invoke("update_material", { id: material.id, ...params });
      } else {
        await invoke("add_material", params);
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
          {material ? "Edit Material" : "Add Material"}
        </h2>

        <div className="space-y-3">
          <div>
            <label className="block text-xs text-[#555] font-mono mb-1">Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full bg-[#1a1a18] border border-[#2a2a28] rounded-lg px-3 py-2 text-xs font-mono text-[#e8e4da] outline-none focus:border-[#c8881a] transition-colors"
              required
            />
          </div>

          <div>
            <label className="block text-xs text-[#555] font-mono mb-1">Unit</label>
            <input
              type="text"
              value={unit}
              onChange={(e) => setUnit(e.target.value)}
              placeholder="sheets, ml, pcs, rolls..."
              className="w-full bg-[#1a1a18] border border-[#2a2a28] rounded-lg px-3 py-2 text-xs font-mono text-[#e8e4da] outline-none focus:border-[#c8881a] transition-colors"
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-[#555] font-mono mb-1">Starting Stock</label>
              <input
                type="number"
                step="any"
                value={stock}
                onChange={(e) => setStock(e.target.value)}
                className="w-full bg-[#1a1a18] border border-[#2a2a28] rounded-lg px-3 py-2 text-xs font-mono text-[#e8e4da] outline-none focus:border-[#c8881a] transition-colors"
                required
              />
            </div>
            <div>
              <label className="block text-xs text-[#555] font-mono mb-1">Low Threshold</label>
              <input
                type="number"
                step="any"
                value={threshold}
                onChange={(e) => setThreshold(e.target.value)}
                className="w-full bg-[#1a1a18] border border-[#2a2a28] rounded-lg px-3 py-2 text-xs font-mono text-[#e8e4da] outline-none focus:border-[#c8881a] transition-colors"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs text-[#555] font-mono mb-1">Auto-deduct on export from</label>
            <select
              value={linkedTab}
              onChange={(e) => setLinkedTab(e.target.value)}
              className="w-full bg-[#1a1a18] border border-[#2a2a28] rounded-lg px-3 py-2 text-xs font-mono text-[#e8e4da] outline-none focus:border-[#c8881a] transition-colors"
            >
              {TAB_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>

          {linkedTab && (
            <div>
              <label className="block text-xs text-[#555] font-mono mb-1">Deduct per export</label>
              <input
                type="number"
                step="any"
                value={deduct}
                onChange={(e) => setDeduct(e.target.value)}
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
            disabled={saving || !name.trim() || !unit.trim() || stock === ""}
            className="px-4 py-2 bg-[#c8881a] text-[#0c0c0b] rounded-lg text-xs font-mono font-bold hover:bg-[#d9992b] transition-colors disabled:opacity-50"
          >
            {saving ? "Saving..." : material ? "Update" : "Add"}
          </button>
        </div>
      </form>
    </ThemedModal>
  );
}
