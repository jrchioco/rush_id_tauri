import { Paintbrush } from "lucide-react";
import { Tooltip } from "./Tooltip";
import { TOOLTIPS } from "../lib/tooltips";

interface RetouchButtonProps {
  onClick: () => void;
}

export function RetouchButton({ onClick }: RetouchButtonProps) {
  return (
    <Tooltip content={TOOLTIPS.retouch}>
      <button
        onClick={onClick}
        className="absolute bottom-2 right-2 flex items-center gap-1 px-2 py-1
                   bg-black/60 text-white text-xs rounded opacity-50
                   hover:opacity-100 transition-opacity duration-150 z-10"
      >
        <Paintbrush size={12} />
        Retouch
      </button>
    </Tooltip>
  );
}
