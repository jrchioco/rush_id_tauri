const STORAGE_KEY = "lastSaveDir";

export function getLastSaveDir(): string | null {
  return localStorage.getItem(STORAGE_KEY);
}

export function setLastSaveDir(fullPath: string): void {
  const sep = fullPath.includes("\\") ? "\\" : "/";
  const lastSep = fullPath.lastIndexOf(sep);
  if (lastSep > 0) {
    localStorage.setItem(STORAGE_KEY, fullPath.substring(0, lastSep));
  }
}

function timestamp(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

export function buildSavePath(nameParts: string[]): string {
  const dir = getLastSaveDir();
  const name = [...nameParts, timestamp()].join("-") + ".pdf";
  return dir ? `${dir}/${name}` : name;
}
