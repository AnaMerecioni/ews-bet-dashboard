import { useSyncExternalStore } from "react";

/** Valoare păstrată în localStorage, partajată între componente (fără a umfla contextul principal). */
export function createLocalStore<T>(key: string) {
  let value: T | null | undefined; // undefined = încă necitit
  const listeners = new Set<() => void>();
  const read = (): T | null => {
    if (value === undefined) {
      try { value = JSON.parse(localStorage.getItem(key) ?? "null") as T | null; } catch { value = null; }
    }
    return value;
  };
  const emit = () => listeners.forEach((l) => l());
  const subscribe = (l: () => void) => { listeners.add(l); return () => listeners.delete(l); };
  return {
    get: read,
    set(next: T | null) {
      value = next;
      try {
        if (next === null) localStorage.removeItem(key);
        else localStorage.setItem(key, JSON.stringify(next));
      } catch { /* spațiu insuficient: rămâne doar în memorie */ }
      emit();
    },
    use: () => useSyncExternalStore(subscribe, read, () => null),
  };
}
