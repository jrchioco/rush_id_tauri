import { useState, useEffect, useCallback } from "react";
import { invoke } from "../../components/CompanionWidget/effieInvoke";
import { Plus, AlertTriangle } from "lucide-react";
import type { Material } from "../../types";
import AddEditMaterialModal from "./AddEditMaterialModal";
import RestockAdjustModal from "./RestockAdjustModal";

const TAB_OPTIONS = [
  { value: "", label: "None" },
  { value: "single", label: "Single" },
  { value: "multi", label: "Multi" },
  { value: "passport", label: "Passport" },
  { value: "polaroid", label: "Polaroid" },
  { value: "other", label: "Other" },
];

export default function InventoryPage() {
  const [materials, setMaterials] = useState<Material[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddEdit, setShowAddEdit] = useState(false);
  const [editingMaterial, setEditingMaterial] = useState<Material | null>(null);
  const [showRestockAdjust, setShowRestockAdjust] = useState(false);
  const [restockMaterial, setRestockMaterial] = useState<Material | null>(null);

  const fetchMaterials = useCallback(() => {
    invoke<Material[]>("get_materials")
      .then(setMaterials)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { fetchMaterials(); }, [fetchMaterials]);

  const handleAdd = () => {
    setEditingMaterial(null);
    setShowAddEdit(true);
  };

  const handleEdit = (mat: Material) => {
    setEditingMaterial(mat);
    setShowAddEdit(true);
  };

  const handleDelete = async (id: number) => {
    await invoke("delete_material", { id });
    fetchMaterials();
  };

  const handleRestock = (mat: Material) => {
    setRestockMaterial(mat);
    setShowRestockAdjust(true);
  };

  const handleSave = () => {
    setShowAddEdit(false);
    setEditingMaterial(null);
    fetchMaterials();
  };

  const handleAdjustSave = () => {
    setShowRestockAdjust(false);
    setRestockMaterial(null);
    fetchMaterials();
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-lg font-bold text-[#e8e4da] tracking-wide">Inventory</h1>
          <p className="text-xs text-[#555] font-mono mt-1">Materials tracking</p>
        </div>
        <button
          onClick={handleAdd}
          className="flex items-center gap-2 px-4 py-2 bg-[#c8881a] text-[#0c0c0b] rounded-lg text-xs font-mono font-bold hover:bg-[#d9992b] transition-colors"
        >
          <Plus className="w-4 h-4" />
          Add Material
        </button>
      </div>

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-24 bg-[#1a1a18] rounded-xl animate-pulse" />
          ))}
        </div>
      ) : materials.length === 0 ? (
        <div className="bg-[#0c0c0b] border border-[#2a2a28] rounded-xl p-12 text-center">
          <p className="text-sm text-[#555] font-mono">No materials yet. Click "Add Material" to get started.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3">
          {materials.map((mat) => {
            const isLow = mat.current_stock <= mat.low_stock_threshold;
            const tabLabel = TAB_OPTIONS.find((t) => t.value === mat.linked_tab)?.label ?? "None";
            return (
              <div
                key={mat.id}
                className={`bg-[#0c0c0b] border rounded-xl p-5 ${
                  isLow ? "border-[#c8881a]/50" : "border-[#2a2a28]"
                }`}
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="text-sm font-bold text-[#e8e4da]">{mat.name}</h3>
                      {isLow && <AlertTriangle className="w-4 h-4 text-[#c8881a]" />}
                    </div>
                    <p className="text-xs text-[#888] font-mono">
                      {mat.current_stock} {mat.unit}
                      {isLow && (
                        <span className="text-[#c8881a] ml-2">
                          (low — threshold: {mat.low_stock_threshold})
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-[#555] font-mono mt-1">
                      Linked: {tabLabel} · Deduct: {mat.deduct_per_export} {mat.unit}/export
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleRestock(mat)}
                      className="px-3 py-1.5 bg-[#1a1a18] border border-[#2a2a28] rounded-lg text-xs font-mono text-[#888] hover:text-[#e8e4da] hover:border-[#555] transition-colors"
                    >
                      Restock
                    </button>
                    <button
                      onClick={() => handleEdit(mat)}
                      className="px-3 py-1.5 bg-[#1a1a18] border border-[#2a2a28] rounded-lg text-xs font-mono text-[#888] hover:text-[#e8e4da] hover:border-[#555] transition-colors"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => handleDelete(mat.id)}
                      className="px-3 py-1.5 bg-[#1a1a18] border border-[#2a2a28] rounded-lg text-xs font-mono text-[#555] hover:text-red-400 hover:border-red-400/50 transition-colors"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {showAddEdit && (
        <AddEditMaterialModal
          material={editingMaterial}
          onClose={() => { setShowAddEdit(false); setEditingMaterial(null); }}
          onSave={handleSave}
        />
      )}

      {showRestockAdjust && restockMaterial && (
        <RestockAdjustModal
          material={restockMaterial}
          onClose={() => { setShowRestockAdjust(false); setRestockMaterial(null); }}
          onSave={handleAdjustSave}
        />
      )}
    </div>
  );
}
