import {
  PersistedRunScoreSchema,
  RunHistoryResponseSchema,
} from "../core/ApiSchemas";
import { PersistedRunScore } from "../core/game/Game";
import { getApiBase } from "./Api";
import { userAuth } from "./Auth";

const RUN_HISTORY_PATH = "/api/users/@me/runs";

export async function fetchRunHistory(): Promise<PersistedRunScore[] | false> {
  try {
    const auth = await userAuth();
    if (!auth) return false;

    const res = await fetch(`${getApiBase()}${RUN_HISTORY_PATH}`, {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${auth.jwt}`,
      },
    });

    if (res.status === 404) {
      return [];
    }
    if (!res.ok) {
      console.warn("fetchRunHistory: unexpected status", res.status);
      return false;
    }

    const json = await res.json();
    const parsed = RunHistoryResponseSchema.safeParse(json);
    if (!parsed.success) {
      console.warn("fetchRunHistory: Zod validation failed", parsed.error);
      return false;
    }
    return parsed.data.runs as PersistedRunScore[];
  } catch (err) {
    console.warn("fetchRunHistory: request failed", err);
    return false;
  }
}

export async function pushRunScore(entry: PersistedRunScore): Promise<boolean> {
  const body = PersistedRunScoreSchema.safeParse(entry);
  if (!body.success) {
    console.warn("pushRunScore: invalid entry, skipping", body.error);
    return false;
  }
  try {
    const auth = await userAuth();
    if (!auth) return false;

    const res = await fetch(`${getApiBase()}${RUN_HISTORY_PATH}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${auth.jwt}`,
      },
      body: JSON.stringify(body.data),
    });
    if (!res.ok) {
      console.warn("pushRunScore: unexpected status", res.status);
      return false;
    }
    return true;
  } catch (err) {
    console.warn("pushRunScore: request failed", err);
    return false;
  }
}
