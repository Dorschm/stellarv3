import { RateLimiter } from "limiter";
import { ClientID } from "../core/Schemas";

const INTENTS_PER_SECOND = 10;
const INTENTS_PER_MINUTE = 150;
const MAX_INTENT_SIZE = 500;
// Sliding-window byte budget (token bucket with a full 2MB burst).
// Legitimate traffic (intents, pings, hashes) stays far below this rate,
// so only clients flooding the socket get kicked — unlike a lifetime
// cap, which normal traffic would eventually cross in long games.
const BYTES_PER_MINUTE = 2 * 1024 * 1024; // 2MB per client per minute
export type RateLimitResult = "ok" | "limit" | "kick";

interface ClientBucket {
  perSecond: RateLimiter;
  perMinute: RateLimiter;
  bytesPerMinute: RateLimiter;
}

export class ClientMsgRateLimiter {
  private buckets = new Map<ClientID, ClientBucket>();

  check(clientID: ClientID, type: string, bytes: number): RateLimitResult {
    const bucket = this.getOrCreate(clientID);

    // tryRemoveTokens also returns false when a single message exceeds
    // the whole budget, so oversized messages kick immediately.
    if (!bucket.bytesPerMinute.tryRemoveTokens(bytes)) return "kick";

    if (type === "intent") {
      // Intents are stored in turn history for the duration of the game, so
      // oversized intents would accumulate and fill up server RAM.
      // Intents are also sent to all players, so it increase outgoing
      // data.
      // Intents should never be larger than MAX_INTENT_SIZE, so we assume the client is malicious.
      if (bytes > MAX_INTENT_SIZE) {
        return "kick";
      }
      if (
        !bucket.perSecond.tryRemoveTokens(1) ||
        !bucket.perMinute.tryRemoveTokens(1)
      ) {
        return "limit";
      }
    }

    return "ok";
  }

  private getOrCreate(clientID: ClientID): ClientBucket {
    const existing = this.buckets.get(clientID);
    if (existing) {
      return existing;
    }
    const bucket = {
      perSecond: new RateLimiter({
        tokensPerInterval: INTENTS_PER_SECOND,
        interval: "second",
      }),
      perMinute: new RateLimiter({
        tokensPerInterval: INTENTS_PER_MINUTE,
        interval: "minute",
      }),
      bytesPerMinute: new RateLimiter({
        tokensPerInterval: BYTES_PER_MINUTE,
        interval: "minute",
      }),
    };
    this.buckets.set(clientID, bucket);
    return bucket;
  }
}
