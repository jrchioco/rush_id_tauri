export function logColor(text: string): string {
  if (text.startsWith("✓")) return "text-[#4caf78]";
  if (text.toLowerCase().includes("error")) return "text-red-400";
  if (text.endsWith("...")) return "text-[#c8881a]";
  return "text-[#888]";
}
