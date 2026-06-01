import { cn, COLORS } from "../lib/utils";

type Size = "sm" | "lg";

const SIZES: Record<Size, string> = {
  lg: "w-7 h-7",
  sm: "w-5 h-5",
};

interface Props {
  value: string;
  onChange: (color: string) => void;
  size?: Size;
}

export function ColorPicker({ value, onChange, size = "lg" }: Props) {
  return (
    <div className="flex items-center gap-2">
      {COLORS.map((c) => (
        <button
          key={c.value}
          onClick={() => onChange(c.value)}
          className={cn(
            "rounded-full transition-all duration-150",
            SIZES[size],
            value === c.value
              ? "ring-2 ring-[#c8881a] ring-offset-2 ring-offset-[#0c0c0b] scale-110"
              : "hover:scale-110 opacity-80 hover:opacity-100",
          )}
          style={{ backgroundColor: c.value }}
          title={c.label}
        />
      ))}
      <input
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={cn(
          "rounded-full border border-[#2a2a28] overflow-hidden cursor-pointer bg-transparent",
          SIZES[size],
        )}
        title="Custom color"
      />
    </div>
  );
}
