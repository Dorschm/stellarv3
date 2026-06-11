import { describe, expect, it, vi } from "vitest";
import { ClientMsgRateLimiter } from "../../src/server/ClientMsgRateLimiter";

const CLIENT_A = "clientA" as any;
const CLIENT_B = "clientB" as any;

const SMALL = 100;

describe("ClientMsgRateLimiter", () => {
  describe("intent messages", () => {
    it("allows intents within limits", () => {
      const limiter = new ClientMsgRateLimiter();
      expect(limiter.check(CLIENT_A, "intent", SMALL)).toBe("ok");
    });

    it("limits when per-second count exceeded", () => {
      const limiter = new ClientMsgRateLimiter();
      for (let i = 0; i < 10; i++) {
        expect(limiter.check(CLIENT_A, "intent", SMALL)).toBe("ok");
      }
      expect(limiter.check(CLIENT_A, "intent", SMALL)).toBe("limit");
    });

    it("rate limits are per client", () => {
      const limiter = new ClientMsgRateLimiter();
      for (let i = 0; i < 10; i++) {
        limiter.check(CLIENT_A, "intent", SMALL);
      }
      expect(limiter.check(CLIENT_B, "intent", SMALL)).toBe("ok");
    });
  });

  describe("non-intent messages", () => {
    it("does not rate-limit non-intent messages", () => {
      const limiter = new ClientMsgRateLimiter();
      for (let i = 0; i < 20; i++) {
        expect(limiter.check(CLIENT_A, "winner", 50)).toBe("ok");
      }
    });

    it("does not rate-limit ping messages", () => {
      const limiter = new ClientMsgRateLimiter();
      for (let i = 0; i < 20; i++) {
        expect(limiter.check(CLIENT_A, "ping", 50)).toBe("ok");
      }
    });
  });

  describe("byte rate limit", () => {
    it("kicks when bytes exceed 2MB within one minute", () => {
      const limiter = new ClientMsgRateLimiter();
      const chunkSize = 512 * 1024; // 512KB
      // 4 chunks = 2MB fits within the burst budget
      for (let i = 0; i < 4; i++) {
        expect(limiter.check(CLIENT_A, "other", chunkSize)).toBe("ok");
      }
      // 5th chunk exceeds the per-minute budget, should kick
      expect(limiter.check(CLIENT_A, "other", chunkSize)).toBe("kick");
    });

    it("byte tracking is per client", () => {
      const limiter = new ClientMsgRateLimiter();
      const almostFull = 2 * 1024 * 1024 - 1;
      expect(limiter.check(CLIENT_A, "other", almostFull)).toBe("ok");
      // CLIENT_B should still be fine
      expect(limiter.check(CLIENT_B, "other", 100)).toBe("ok");
    });

    it("kicks on bytes regardless of message type", () => {
      const limiter = new ClientMsgRateLimiter();
      const overBudget = 2 * 1024 * 1024 + 1;
      expect(limiter.check(CLIENT_A, "intent", overBudget)).toBe("kick");
    });

    it("refills the budget over time instead of accumulating forever", () => {
      // The limiter library reads performance.now(); fake it so a minute
      // can pass instantly.
      vi.useFakeTimers({ toFake: ["performance"] });
      try {
        const limiter = new ClientMsgRateLimiter();
        const chunkSize = 512 * 1024; // 512KB
        for (let i = 0; i < 4; i++) {
          expect(limiter.check(CLIENT_A, "other", chunkSize)).toBe("ok");
        }
        expect(limiter.check(CLIENT_A, "other", chunkSize)).toBe("kick");
        // A minute later the window has refilled — steady legitimate
        // traffic in a long game must never accumulate into a kick.
        vi.advanceTimersByTime(61_000);
        expect(limiter.check(CLIENT_A, "other", chunkSize)).toBe("ok");
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
