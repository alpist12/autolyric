import { getApp, getApps, initializeApp } from "firebase/app";
import { getAuth, signInAnonymously } from "firebase/auth";
import { get, getDatabase, ref, set } from "firebase/database";
import { parseMusicXml } from "../musicxml/parseMusicXml";
import type { StoredScore } from "../types";

const BAND_KEY_STORAGE = "scoreflow-band-key";
const BAND_KEY_PATTERN = /^sf-[A-Za-z0-9_-]{8,64}$/;
const SCORE_ID_PATTERN = /^[A-Za-z0-9_-]{1,160}$/;

const firebaseConfig = {
  apiKey: "AIzaSyC5QfdMX8VZEtxaJxbb99uCdmaUOSKwkVQ",
  authDomain: "auto-lyric-3ac30.firebaseapp.com",
  databaseURL: "https://auto-lyric-3ac30-default-rtdb.firebaseio.com",
  projectId: "auto-lyric-3ac30",
  storageBucket: "auto-lyric-3ac30.firebasestorage.app",
  messagingSenderId: "212280640512",
  appId: "1:212280640512:web:6cc1b579efa21b0ae044e5",
};

type CloudScore = Pick<StoredScore, "id" | "name" | "xml" | "savedAt" | "updatedAt" | "note" | "annotations"> & { displayName?: string };

export function retainBandKey(url: URL, storage: Pick<Storage, "getItem" | "setItem">): { key: string; cleanUrl?: string } | null {
  const supplied = url.searchParams.get("key")?.trim();
  const key = supplied || storage.getItem(BAND_KEY_STORAGE)?.trim();
  if (!key || !BAND_KEY_PATTERN.test(key)) return null;
  if (supplied) {
    storage.setItem(BAND_KEY_STORAGE, supplied);
    url.searchParams.delete("key");
    return { key: supplied, cleanUrl: `${url.pathname}${url.search}${url.hash}` };
  }
  return { key };
}

function isCloudScore(value: unknown): value is CloudScore {
  if (!value || typeof value !== "object") return false;
  const score = value as Partial<CloudScore>;
  return typeof score.id === "string" && SCORE_ID_PATTERN.test(score.id)
    && typeof score.name === "string" && score.name.length <= 300
    && (score.displayName === undefined || (typeof score.displayName === "string" && score.displayName.length > 0 && score.displayName.length <= 120))
    && typeof score.xml === "string" && score.xml.length <= 8_000_000
    && typeof score.savedAt === "number" && Number.isFinite(score.savedAt)
    && typeof score.updatedAt === "number" && Number.isFinite(score.updatedAt)
    && typeof score.note === "string" && score.note.length <= 100_000
    && (score.annotations === undefined || (Array.isArray(score.annotations) && score.annotations.length <= 10_000
      && score.annotations.every((line) => typeof line === "string" && line.length <= 100_000)));
}

export class FirebaseSync {
  private readonly auth;
  private readonly database;
  private authPromise: Promise<void> | undefined;

  constructor(private readonly bandKey: string) {
    const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
    this.auth = getAuth(app);
    this.database = getDatabase(app);
  }

  async reconcile(localScores: StoredScore[]): Promise<StoredScore[]> {
    await this.authenticate();
    const snapshot = await get(ref(this.database, `bands/${this.bandKey}/scores`));
    const values = snapshot.val() as Record<string, unknown> | null;
    const remote = Object.values(values ?? {}).filter(isCloudScore);
    const remoteById = new Map(remote.map((score) => [score.id, score]));
    const merged = new Map(localScores.map((score) => [score.id, score]));

    for (const item of remote) {
      const local = merged.get(item.id);
      if (!local || item.updatedAt! > (local.updatedAt ?? local.savedAt)) {
        try {
          merged.set(item.id, { ...item, score: parseMusicXml(item.xml), note: item.note ?? "", annotations: item.annotations ?? [] });
        } catch {
          // Ignore malformed remote MusicXML so one bad entry cannot break the library.
        }
      }
    }
    await Promise.all(localScores.map(async (item) => {
      const remoteItem = remoteById.get(item.id);
      if (!remoteItem || (item.updatedAt ?? item.savedAt) > remoteItem.updatedAt!) await this.save(item);
    }));
    return [...merged.values()];
  }

  async save(score: StoredScore): Promise<void> {
    if (!SCORE_ID_PATTERN.test(score.id)) throw new Error("공유할 수 없는 악보 ID입니다.");
    await this.authenticate();
    const { id, name, displayName, xml, savedAt, updatedAt, note = "", annotations = [] } = score;
    await set(ref(this.database, `bands/${this.bandKey}/scores/${id}`), {
      id, name, xml, savedAt, updatedAt: updatedAt ?? savedAt, note,
      ...(displayName ? { displayName } : {}),
      ...(annotations.length ? { annotations } : {}),
    } satisfies CloudScore);
  }

  private authenticate(): Promise<void> {
    if (this.auth.currentUser) return Promise.resolve();
    this.authPromise ??= signInAnonymously(this.auth).then(() => undefined).catch((error) => {
      this.authPromise = undefined;
      throw error;
    });
    return this.authPromise;
  }
}

export function createFirebaseSync(): FirebaseSync | null {
  const access = retainBandKey(new URL(location.href), localStorage);
  if (!access) return null;
  if (access.cleanUrl) history.replaceState(null, "", access.cleanUrl);
  return new FirebaseSync(access.key);
}
