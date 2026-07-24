const STORAGE_KEY = "lastSeenVersion";

export function getLastSeenVersion(): string | null {
  return localStorage.getItem(STORAGE_KEY);
}

export function setLastSeenVersion(version: string): void {
  localStorage.setItem(STORAGE_KEY, version);
}
