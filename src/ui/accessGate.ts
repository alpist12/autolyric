export const ACCESS_STORAGE_KEY = "scoreflow-access-granted";
export const ACCESS_TOKEN = "sf-7k9m2x8p";

export function verifyAccessKey(input: string): boolean {
  return input.trim() === ACCESS_TOKEN;
}

export function checkAndPersistAccess(
  search = typeof location !== "undefined" ? location.search : "",
  hash = typeof location !== "undefined" ? location.hash : "",
  storage: Pick<Storage, "getItem" | "setItem"> | undefined = typeof localStorage !== "undefined" ? localStorage : undefined,
): { authorized: boolean; cleanedUrl?: string } {
  const searchParams = new URLSearchParams(search);
  const hashQuery = hash.includes("?") ? hash.slice(hash.indexOf("?") + 1) : "";
  const hashParams = new URLSearchParams(hashQuery);

  const keyFromSearch = searchParams.get("key");
  const keyFromHash = hashParams.get("key");
  const candidate = keyFromSearch ?? keyFromHash;

  if (candidate && verifyAccessKey(candidate)) {
    try {
      storage?.setItem(ACCESS_STORAGE_KEY, ACCESS_TOKEN);
    } catch {
      // Ignore storage errors in private browsing
    }
    searchParams.delete("key");
    hashParams.delete("key");
    const nextSearch = searchParams.toString();
    const baseHash = hash.split("?")[0] || "";
    const nextHashQuery = hashParams.toString();
    const nextHash = baseHash ? `${baseHash}${nextHashQuery ? `?${nextHashQuery}` : ""}` : "";
    const pathname = typeof location !== "undefined" ? location.pathname : "/";
    const cleanedUrl = `${pathname}${nextSearch ? `?${nextSearch}` : ""}${nextHash}`;
    return { authorized: true, cleanedUrl };
  }

  try {
    if (storage?.getItem(ACCESS_STORAGE_KEY) === ACCESS_TOKEN) {
      return { authorized: true };
    }
  } catch {
    // Ignore storage read errors
  }

  return { authorized: false };
}

export function buildInviteUrl(originAndPath?: string): string {
  const base = originAndPath ?? (typeof location !== "undefined" ? `${location.origin}${location.pathname}` : "");
  return `${base}?key=${ACCESS_TOKEN}`;
}
