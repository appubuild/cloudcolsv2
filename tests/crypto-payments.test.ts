import { describe, it, expect } from "vitest";
import { checkXrplPayment, destinationTagFor, dropsForUsd } from "../lib/payments/crypto";

/**
 * The checks that decide whether money arrived.
 *
 * Each refusal here is a way someone could otherwise get a plan without paying for it:
 * a transaction that failed, one to another address, one carrying another payment's
 * tag, or a partial payment that states a large Amount and delivers a small one.
 */

const DEST = "rPEPPER7kfTD9w2To4CQk6UCfuHM9c6GDY";
const TAG = 123456;

function tx(overrides: {
  validated?: boolean;
  result?: string;
  type?: string;
  destination?: string;
  tag?: number;
  amount?: unknown;
  delivered?: unknown;
} = {}) {
  return {
    validated: overrides.validated ?? true,
    meta: {
      TransactionResult: overrides.result ?? "tesSUCCESS",
      ...("delivered" in overrides ? { delivered_amount: overrides.delivered } : { delivered_amount: "5000000" }),
    },
    tx_json: {
      TransactionType: overrides.type ?? "Payment",
      Account: "rSENDERxxxxxxxxxxxxxxxxxxxxxxxxxx",
      Destination: overrides.destination ?? DEST,
      DestinationTag: overrides.tag ?? TAG,
      Amount: "amount" in overrides ? overrides.amount : "5000000",
    },
  };
}

const expected = { destination: DEST, destinationTag: TAG, drops: 5_000_000 };

describe("checkXrplPayment", () => {
  it("accepts a validated, successful payment of the full amount", () => {
    const r = checkXrplPayment(tx(), expected);
    expect(r.ok).toBe(true);
    expect(r.account).toBe("rSENDERxxxxxxxxxxxxxxxxxxxxxxxxxx");
  });

  it("accepts paying more than was asked", () => {
    expect(checkXrplPayment(tx({ delivered: "6000000", amount: "6000000" }), expected).ok).toBe(true);
  });

  it("waits for a transaction that is not validated yet", () => {
    const r = checkXrplPayment(tx({ validated: false }), expected);
    expect(r).toMatchObject({ ok: false, reason: "not validated yet" });
  });

  it("refuses a transaction the ledger rejected", () => {
    expect(checkXrplPayment(tx({ result: "tecUNFUNDED_PAYMENT" }), expected).ok).toBe(false);
  });

  it("refuses something that is not a payment", () => {
    expect(checkXrplPayment(tx({ type: "OfferCreate" }), expected).ok).toBe(false);
  });

  it("refuses a payment to another address", () => {
    expect(checkXrplPayment(tx({ destination: "rOTHERxxxxxxxxxxxxxxxxxxxxxxxxxxx" }), expected)).toMatchObject({
      ok: false,
      reason: "paid to another address",
    });
  });

  it("refuses a payment carrying another payment's tag", () => {
    expect(checkXrplPayment(tx({ tag: TAG + 1 }), expected)).toMatchObject({
      ok: false,
      reason: "destination tag does not match",
    });
  });

  it("refuses a partial payment that states the full Amount but delivers less", () => {
    // The trick: Amount says 5 XRP, delivered_amount says 1 drop.
    const r = checkXrplPayment(tx({ amount: "5000000", delivered: "1" }), expected);
    expect(r).toMatchObject({ ok: false, reason: "paid less than the amount due" });
  });

  it("refuses an underpayment", () => {
    expect(checkXrplPayment(tx({ amount: "4999999", delivered: "4999999" }), expected).ok).toBe(false);
  });

  it("refuses a payment in a token rather than XRP", () => {
    const token = { currency: "USD", issuer: "rISSUERxxxxxxxxxxxxxxxxxxxxxxxxxx", value: "9999" };
    expect(checkXrplPayment(tx({ amount: token, delivered: token }), expected)).toMatchObject({
      ok: false,
      reason: "not paid in XRP",
    });
  });

  it("reads the older response shape, with fields at the top level", () => {
    const legacy = {
      validated: true,
      meta: { TransactionResult: "tesSUCCESS", delivered_amount: "5000000" },
      TransactionType: "Payment",
      Destination: DEST,
      DestinationTag: TAG,
      Amount: "5000000",
      Account: "rSENDERxxxxxxxxxxxxxxxxxxxxxxxxxx",
    };
    expect(checkXrplPayment(legacy, expected).ok).toBe(true);
  });
});

describe("destinationTagFor", () => {
  it("is stable for the same reference", () => {
    expect(destinationTagFor("ref-1")).toBe(destinationTagFor("ref-1"));
  });

  it("differs between references", () => {
    const tags = new Set(Array.from({ length: 1000 }, (_, i) => destinationTagFor(`ref-${i}-${crypto.randomUUID()}`)));
    expect(tags.size).toBe(1000);
  });

  it("is a valid, non-zero 32-bit tag", () => {
    for (let i = 0; i < 1000; i += 1) {
      const t = destinationTagFor(crypto.randomUUID());
      expect(Number.isInteger(t)).toBe(true);
      expect(t).toBeGreaterThan(0);
      expect(t).toBeLessThanOrEqual(4294967295);
    }
  });
});

describe("dropsForUsd", () => {
  it("converts a price at a quoted rate", () => {
    // $10.00 at $2.00 per XRP is 5 XRP.
    expect(dropsForUsd(1000, 2)).toBe(5_000_000);
  });

  it("rounds up, never undercharging by a fraction of a drop", () => {
    // $1.00 at $3.00 per XRP is 0.333… XRP.
    expect(dropsForUsd(100, 3)).toBe(333_334);
  });

  it("refuses to quote without a rate", () => {
    expect(() => dropsForUsd(1000, 0)).toThrow();
    expect(() => dropsForUsd(1000, Number.NaN)).toThrow();
  });
});

describe("periodEnd", () => {
  // Imported lazily: the module pulls in server-only helpers the other tests do not need.
  it("gives a monthly plan one month", async () => {
    const { periodEnd } = await import("../lib/payments/apply");
    const from = new Date("2026-01-15T12:00:00Z");
    expect(periodEnd("monthly", from)).toBe("2026-02-15T12:00:00.000Z");
  });

  it("gives a yearly plan a year, not a month", async () => {
    // The bug this pins: the interval is stored as "yearly", and comparing it against
    // "year" never matched — a year paid for in XRP bought a month.
    const { periodEnd } = await import("../lib/payments/apply");
    const from = new Date("2026-01-15T12:00:00Z");
    expect(periodEnd("yearly", from)).toBe("2027-01-15T12:00:00.000Z");
  });
});
