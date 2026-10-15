import type { StoredScore } from "../types";

const DATABASE = "scoreflow";
const STORE = "scores";

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB 작업에 실패했습니다."));
  });
}

export class ScoreLibrary {
  private database?: Promise<IDBDatabase>;

  save(score: StoredScore): Promise<IDBValidKey> {
    return this.useStore("readwrite", (store) => requestResult(store.put(score)));
  }

  get(id: string): Promise<StoredScore | undefined> {
    return this.useStore("readonly", (store) => requestResult(store.get(id)));
  }

  list(): Promise<StoredScore[]> {
    return this.useStore("readonly", (store) => requestResult(store.getAll()));
  }

  delete(id: string): Promise<void> {
    return this.useStore("readwrite", async (store) => {
      await requestResult(store.delete(id));
    });
  }

  private open(): Promise<IDBDatabase> {
    if (!globalThis.indexedDB) return Promise.reject(new Error("이 브라우저는 IndexedDB를 지원하지 않습니다."));
    this.database ??= new Promise((resolve, reject) => {
      const request = indexedDB.open(DATABASE, 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE, { keyPath: "id" });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("악보 보관함을 열 수 없습니다."));
    });
    return this.database;
  }

  private async useStore<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => Promise<T>): Promise<T> {
    const database = await this.open();
    return work(database.transaction(STORE, mode).objectStore(STORE));
  }
}
