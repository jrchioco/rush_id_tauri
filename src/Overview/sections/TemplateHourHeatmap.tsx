import { useMemo } from "react";
import type { TemplateHourCell } from "../../types";
import { Tooltip } from "../../components/Tooltip";

const EMPTY_SHADE = "#1a1408";
const BAND_SHADES = ["#241a0a", "#5c3e0c", "#9c6a14", "#c8881a"];
const BAND_LABELS = ["Mellow", "Moderate", "Busy", "Peak"];

function categoryFor(templateKey: string): string | null {
  const k = templateKey.toLowerCase();
  if (["1x1", "dev_1x1", "multi_1x1"].includes(k)) return "Rush ID 1x1";
  if (["2x2", "dev_2x2", "multi_2x2"].includes(k)) return "Rush ID 2x2";
  if (["mixed", "dev_mixed", "multi_mixed"].includes(k)) return "Rush ID Mixed";
  if (["passport1", "passport2"].includes(k)) return "Passport";
  if (["3r", "4r", "5r", "8r"].includes(k)) return "Other";
  if (k.startsWith("polaroid")) return "Polaroid";
  if (k.startsWith("wallet")) return "Wallet";
  return null;
}

function shadeFor(count: number, max: number): string {
  if (count === 0 || max <= 0) return EMPTY_SHADE;
  const ratio = count / max;
  if (ratio < 0.25) return BAND_SHADES[0];
  if (ratio < 0.5) return BAND_SHADES[1];
  if (ratio < 0.75) return BAND_SHADES[2];
  return BAND_SHADES[3];
}

function formatHour(h: number): string {
  const period = h < 12 ? "am" : "pm";
  const hr = h % 12 === 0 ? 12 : h % 12;
  return `${hr}${period}`;
}

interface HeatmapRow {
  template_key: string;
  display_name: string;
  cells: { count: number; total: number }[];
  total: number;
}

function CellTooltip({ name, hour, total }: { name: string; hour: number; total: number }) {
  return (
    <div className="flex flex-col gap-0.5">
      <p className="text-[10px] font-mono text-[#c8881a] font-bold">{name}</p>
      <p className="text-[10px] font-mono text-[#888]">{formatHour(hour)}</p>
      <p className="text-[10px] font-mono text-[#e8e4da]">₱{total.toLocaleString()}</p>
    </div>
  );
}

export default function TemplateHourHeatmap({ data, loading }: { data: TemplateHourCell[]; loading: boolean }) {
  const rows = useMemo<HeatmapRow[]>(() => {
    const map = new Map<string, HeatmapRow>();
    for (const cell of data) {
      const category = categoryFor(cell.template_key);
      if (!category) continue;
      const entry = map.get(category) ?? {
        template_key: category,
        display_name: category,
        cells: Array.from({ length: 24 }, () => ({ count: 0, total: 0 })),
        total: 0,
      };
      const slot = entry.cells[cell.hour];
      slot.count += cell.count;
      slot.total += cell.total;
      map.set(category, entry);
    }
    const list = [...map.values()];
    for (const row of list) {
      row.total = row.cells.reduce((a, c) => a + c.count, 0);
    }
    list.sort((a, b) => b.total - a.total);
    return list;
  }, [data]);

  const max = useMemo(() => rows.reduce((m, r) => Math.max(m, ...r.cells.map((c) => c.count)), 0), [rows]);

  return (
    <div className="border-t border-[#2a2a28] pt-6 mt-6">
      <h3 className="text-xs font-mono text-[#c8881a] mb-3">Template Activity by Hour</h3>

      {loading ? (
        <div className="h-48 bg-[#1a1a18] rounded animate-pulse" />
      ) : rows.length === 0 ? (
        <div className="h-32 flex items-center justify-center">
          <p className="text-xs text-[#555] font-mono">No activity data yet</p>
        </div>
      ) : (
        <>
          <div className="flex flex-col gap-1">
            {rows.map((row) => (
              <div key={row.template_key} className="flex items-center gap-2">
                <span className="w-24 shrink-0 truncate text-[10px] font-mono text-[#888]" title={row.display_name}>
                  {row.display_name}
                </span>
                <div className="flex-1 grid gap-0.5 grid-cols-[repeat(24,minmax(0,1fr))]">
                  {row.cells.map((cell, h) =>
                    cell.count > 0 ? (
                      <Tooltip
                        key={h}
                        className="w-full"
                        content={<CellTooltip name={row.display_name} hour={h} total={cell.total} />}
                      >
                        <div
                          className="w-full h-4 rounded-[2px]"
                          style={{ backgroundColor: shadeFor(cell.count, max) }}
                        />
                      </Tooltip>
                    ) : (
                      <div
                        key={h}
                        className="h-4 rounded-[2px]"
                        style={{ backgroundColor: shadeFor(0, max) }}
                      />
                    ),
                  )}
                </div>
              </div>
            ))}
          </div>

          <div className="flex items-center gap-2 mt-1.5">
            <span className="w-24 shrink-0" />
            <div className="flex-1 grid grid-cols-12">
              {[0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22].map((h) => (
                <div key={h} className="text-center text-[9px] font-mono text-[#555]">
                  {formatHour(h)}
                </div>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-end gap-3 mt-3">
            {BAND_LABELS.map((label, i) => (
              <div key={label} className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: BAND_SHADES[i] }} />
                <span className="text-[10px] font-mono text-[#888]">{label}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
