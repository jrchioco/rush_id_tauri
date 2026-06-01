import { cn } from "../lib/utils";

type Size = "sm" | "lg";

const SIZES: Record<Size, {
  wrapper: string;
  numberInput: string;
  degree: string;
  sliderWidth: number;
  buttonGroup: string;
  button: string;
}> = {
  lg: {
    wrapper: "w-14 py-3",
    numberInput: "w-10 text-xs",
    degree: "text-xs",
    sliderWidth: 260,
    buttonGroup: "gap-1",
    button: "w-8 h-6 text-[10px]",
  },
  sm: {
    wrapper: "w-12 py-2",
    numberInput: "w-9 text-[10px]",
    degree: "text-[10px]",
    sliderWidth: 220,
    buttonGroup: "gap-0.5",
    button: "w-7 h-5 text-[9px]",
  },
};

interface Props {
  value: number;
  onChange: (v: number) => void;
  size?: Size;
}

export function RotationSidebar({ value, onChange, size = "lg" }: Props) {
  const s = SIZES[size];

  return (
    <div
      className={cn(
        "flex-shrink-0 flex flex-col items-center justify-between border-r border-[#2a2a28] bg-[#111110]",
        s.wrapper,
      )}
    >
      <input
        type="number"
        min={-90}
        max={90}
        value={value}
        onChange={(e) => {
          const v = Number(e.target.value);
          if (!isNaN(v)) onChange(Math.max(-90, Math.min(90, v)));
        }}
        className={cn(
          "bg-transparent font-mono text-[#c8881a] font-semibold text-center [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none outline-none focus:border-b focus:border-[#c8881a]",
          s.numberInput,
        )}
      />
      <span className={cn("font-mono text-[#c8881a] font-semibold", s.degree)}>
        °
      </span>
      <div className="flex-1 flex items-center justify-center w-full overflow-hidden">
        <input
          type="range"
          min={-90}
          max={90}
          step={1}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="accent-[#c8881a] cursor-pointer"
          style={{
            transform: "rotate(-90deg)",
            width: `${s.sliderWidth}px`,
            margin: 0,
            padding: 0,
            flexShrink: 0,
          }}
        />
      </div>
      <div className={cn("flex flex-col", s.buttonGroup)}>
        <button
          onClick={() => onChange(value - 1)}
          className={cn(
            "bg-[#1a1a18] border border-[#2a2a28] rounded text-[#555] hover:text-[#e8e4da] hover:border-[#c8881a] transition-colors font-mono",
            s.button,
          )}
        >
          −1
        </button>
        <button
          onClick={() => onChange(value + 1)}
          className={cn(
            "bg-[#1a1a18] border border-[#2a2a28] rounded text-[#555] hover:text-[#e8e4da] hover:border-[#c8881a] transition-colors font-mono",
            s.button,
          )}
        >
          +1
        </button>
      </div>
    </div>
  );
}
