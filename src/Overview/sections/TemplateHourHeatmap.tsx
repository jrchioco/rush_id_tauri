import { useMemo } from "react";
import type { TemplateHourCell } from "../../types";

const EMPTY_SHADE = "#1a1408";
const BAND_SHADES = ["#241a0a", "#5c3e0c", "#9c6a14", "#c8881a"];
const BAND_LABELS = ["Mellow", "Moderate", "Busy", "Peak"];

function shadeFor(count: number, max: number): string {
  if (count === 0 || max <= 0) return EMPTY_SHADE;
  const ratio = count / max;
  if (ratio < 0.25) return BAND_SHADES[0];
  if (ratio < 0.5) return BAND_SHADES[1];
  if (ratio < 0.75) return BAND_SHADES[2];
  return BAND_SHADES[3];
}

function formatHour(h: number): string {
  const period = h < 12 ? "a" : "p";
  const hr = h % 12 === 0 ? 12 : h % 12;
  return `${hr}${period}`;
}

interface HeatmapRow {
  template_key: string;
  display_name: string;
  cells: number[];
  total: number;
}

export default function TemplateHourHeatmap({ data, loading }: { data: TemplateHourCell[]; loading: boolean }) {
  const rows = useMemo<HeatmapRow[]>(() => {
    const map = new Map<string, HeatmapRow>();
    for (const cell of data) {
      const entry = map.get(cell.template_key) ?? {
        template_key: cell.template_key,
        display_name: cell.display_name,
        cells: Array(24).fill(0),
        total: 0,
      };
      entry.cells[cell.hour] = cell.count;
      map.set(cell.template_key, entry);
    }
    const list = [...map.values()];
    for (const row of list) {
      row.total = row.cells.reduce((a, b) => a + b, 0);
    }
    list.sort((a, b) => b.total - a.total);
    return list;
  }, [data]);

  const max = useMemo(() => rows.reduce((m, r) => Math.max(m, ...r.cells), 0), [rows]);

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
                  {row.cells.map((count, h) => (
                    <div
                      key={h}
                      className="h-4 rounded-[2px]"
                      style={{ backgroundColor: shadeFor(count, max) }}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>

          <div className="flex items-center gap-2 mt-1.5">
            <span className="w-24 shrink-0" />
            <div className="flex-1 grid grid-cols-6">
              {[0, 4, 8, 12, 16, 20].map((h) => (
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
