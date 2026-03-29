/**
 * Secure private-key storage using IndexedDB.
 * Keys never leave the browser — they are stored in a dedicated
 * object store and retrieved by a string identifier:
 *   - Owner keys: "room:{slug}"
 *   - Visitor keys: "conv:{conversationId}"
 */

const DB_NAME = "wolow-e2ee";
const DB_VERSION = 2;
const STORE_NAME = "private-keys";

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (db.objectStoreNames.contains(STORE_NAME)) {
        db.deleteObjectStore(STORE_NAME);
      }
      db.createObjectStore(STORE_NAME, { keyPath: "id" });
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error(`IndexedDB open failed: ${request.error?.message}`));
  });
}

export async function storePrivateKey(id: string, privateKey: JsonWebKey): Promise<void> {
  const db = await openDatabase();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    store.put({ id, privateKey });

    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(new Error(`Failed to store private key: ${tx.error?.message}`));
    };
  });
}

export async function getPrivateKey(id: string): Promise<JsonWebKey | null> {
  const db = await openDatabase();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    const request = store.get(id);

    request.onsuccess = () => {
      db.close();
      resolve(request.result?.privateKey ?? null);
    };
    request.onerror = () => {
      db.close();
      reject(new Error(`Failed to retrieve private key: ${request.error?.message}`));
    };
  });
}

export async function deletePrivateKey(id: string): Promise<void> {
  const db = await openDatabase();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    store.delete(id);

    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(new Error(`Failed to delete private key: ${tx.error?.message}`));
    };
  });
}
