import { PersistedRunScore } from "../core/game/Game";
import { loadRunHistory, mergeRunHistory, writeRunHistory } from "./RunHistory";
import { fetchRunHistory, pushRunScore } from "./RunHistoryApi";
import { generateCryptoRandomUUID } from "./Utils";

let __syncPromise: Promise<void> | null = null;

export async function syncRunHistoryOnLogin(): Promise<void> {
  if (__syncPromise) return __syncPromise;
  __syncPromise = doSync();
  try {
    await __syncPromise;
  } finally {
    __syncPromise = null;
  }
}

async function doSync(): Promise<void> {
  const remote = await fetchRunHistory();
  if (remote === false) return;

  const local = loadRunHistory();
  const localWithIds: PersistedRunScore[] = local.map((e) =>
    e.id ? e : { ...e, id: generateCryptoRandomUUID() },
  );
  const { merged, localOnly } = mergeRunHistory(localWithIds, remote);
  writeRunHistory(merged);

  for (const entry of localOnly) {
    await pushRunScore(entry);
  }
}
