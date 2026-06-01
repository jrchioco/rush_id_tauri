import type { ReactNode } from "react";
import { cn } from "../lib/utils";
import type { LogEntry } from "../types";
import { logColor } from "../lib/logColor";

interface Props {
  title: string;
  entries: LogEntry[];
  footer?: ReactNode;
  height?: number;
}

export function LogsPanel({ title, entries, footer, height = 420 }: Props) {
  return (
    <div className="bg-[#0c0c0b] rounded-xl border border-[#2a2a28] h-fit">
      <div className="p-3 border-b border-[#2a2a28] flex items-center gap-2">
        <div
          className={cn(
            "w-1.5 h-1.5 rounded-full",
            entries.length > 0 ? "bg-[#4caf78]" : "bg-[#333]",
          )}
        />
        <h3 className="text-xs font-semibold text-[#555] font-mono tracking-widest uppercase">
          {title}
        </h3>
      </div>
      <div
        className="overflow-y-auto p-3 space-y-1.5 font-mono text-xs"
        style={{ height: `${height}px` }}
      >
        {entries.length === 0 && (
          <p className="text-[#333] italic">No activity yet</p>
        )}
        {entries.map((entry, i) => (
          <div key={i} className="flex gap-2 leading-relaxed">
            <span className="text-[#444] flex-shrink-0">[{entry.time}]</span>
            <span className={logColor(entry.text)}>{entry.text}</span>
          </div>
        ))}
      </div>
      {footer}
    </div>
  );
}
