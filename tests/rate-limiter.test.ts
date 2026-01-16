import { describe, it, expect, beforeEach } from "bun:test";
import { RateLimiter, CONFIG } from "../src/utils";

describe("RateLimiter", () => {
  let limiter: RateLimiter;

  beforeEach(() => {
    // Use a short window for faster tests
    limiter = new RateLimiter(1000); // 1 second window
  });

  describe("checkLimit", () => {
    it("should allow calls within the limit", () => {
      // Should not throw for calls within limit
      expect(() => {
        for (let i = 0; i < 5; i++) {
          limiter.checkLimit(5);
        }
      }).not.toThrow();
    });

    it("should throw when limit is exceeded", () => {
      // Make 5 calls (the limit)
      for (let i = 0; i < 5; i++) {
        limiter.checkLimit(5);
      }

      // 6th call should throw
      expect(() => {
        limiter.checkLimit(5);
      }).toThrow("Rate limit exceeded");
    });

    it("should include limit in error message", () => {
      for (let i = 0; i < 10; i++) {
        limiter.checkLimit(10);
      }

      expect(() => {
        limiter.checkLimit(10);
      }).toThrow("Maximum 10 tool calls per minute");
    });

    it("should use default limit from CONFIG when not specified", () => {
      const defaultLimiter = new RateLimiter(60000);

      // Should allow up to CONFIG.RATE_LIMIT_MAX_CALLS
      expect(() => {
        for (let i = 0; i < CONFIG.RATE_LIMIT_MAX_CALLS; i++) {
          defaultLimiter.checkLimit();
        }
      }).not.toThrow();

      // Next call should throw
      expect(() => {
        defaultLimiter.checkLimit();
      }).toThrow("Rate limit exceeded");
    });

    it("should reset counter after window expires", async () => {
      // Use a very short window for this test
      const shortLimiter = new RateLimiter(50); // 50ms window

      // Exhaust the limit
      for (let i = 0; i < 3; i++) {
        shortLimiter.checkLimit(3);
      }

      // Should be at limit
      expect(() => shortLimiter.checkLimit(3)).toThrow();

      // Wait for window to expire
      await new Promise((resolve) => setTimeout(resolve, 60));

      // Should be able to make calls again
      expect(() => shortLimiter.checkLimit(3)).not.toThrow();
    });

    it("should track calls correctly across multiple checkLimit calls", () => {
      limiter.checkLimit(10);
      expect(limiter.getStatus().calls).toBe(1);

      limiter.checkLimit(10);
      expect(limiter.getStatus().calls).toBe(2);

      limiter.checkLimit(10);
      expect(limiter.getStatus().calls).toBe(3);
    });
  });

  describe("getStatus", () => {
    it("should return current call count", () => {
      expect(limiter.getStatus().calls).toBe(0);

      limiter.checkLimit(10);
      expect(limiter.getStatus().calls).toBe(1);

      limiter.checkLimit(10);
      limiter.checkLimit(10);
      expect(limiter.getStatus().calls).toBe(3);
    });

    it("should return configured limit", () => {
      expect(limiter.getStatus().limit).toBe(CONFIG.RATE_LIMIT_MAX_CALLS);
    });

    it("should return positive resetsIn value", () => {
      const status = limiter.getStatus();
      expect(status.resetsIn).toBeGreaterThan(0);
      expect(status.resetsIn).toBeLessThanOrEqual(1); // 1 second window
    });

    it("should not return negative resetsIn after window expires", async () => {
      const shortLimiter = new RateLimiter(50);

      // Wait for window to expire
      await new Promise((resolve) => setTimeout(resolve, 60));

      // resetsIn should be 0, not negative
      expect(shortLimiter.getStatus().resetsIn).toBeGreaterThanOrEqual(0);
    });
  });

  describe("reset", () => {
    it("should reset call count to zero", () => {
      limiter.checkLimit(10);
      limiter.checkLimit(10);
      limiter.checkLimit(10);
      expect(limiter.getStatus().calls).toBe(3);

      limiter.reset();
      expect(limiter.getStatus().calls).toBe(0);
    });

    it("should allow calls again after reset", () => {
      // Exhaust the limit
      for (let i = 0; i < 5; i++) {
        limiter.checkLimit(5);
      }
      expect(() => limiter.checkLimit(5)).toThrow();

      // Reset and try again
      limiter.reset();
      expect(() => limiter.checkLimit(5)).not.toThrow();
    });

    it("should reset the window timer", () => {
      limiter.reset();

      const status = limiter.getStatus();
      // After reset, resetsIn should be back to ~1 second (our window)
      expect(status.resetsIn).toBeGreaterThan(0);
      expect(status.calls).toBe(0);
    });
  });

  describe("edge cases", () => {
    it("should handle limit of 1", () => {
      limiter.checkLimit(1);
      expect(() => limiter.checkLimit(1)).toThrow("Rate limit exceeded");
    });

    it("should handle rapid successive calls", () => {
      const calls: boolean[] = [];

      for (let i = 0; i < 100; i++) {
        try {
          limiter.checkLimit(50);
          calls.push(true);
        } catch {
          calls.push(false);
        }
      }

      // First 50 should succeed, rest should fail
      expect(calls.filter((c) => c).length).toBe(50);
      expect(calls.filter((c) => !c).length).toBe(50);
    });

    it("should work with different custom limits per call", () => {
      // First call with limit 5
      limiter.checkLimit(5);
      limiter.checkLimit(5);

      // Now check with stricter limit - should fail because we've made 2 calls
      // and then this would be the 3rd call against a limit of 2
      limiter.checkLimit(5); // 3rd call
      expect(() => limiter.checkLimit(3)).toThrow(); // 4th call exceeds limit of 3
    });
  });
});
