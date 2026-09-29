import { describe, expect, test } from "bun:test";
import { canonicalSubject, subjectDigest } from "../src/research-runtime/sa2a/index.ts";
describe("SA2A exact subject identity", () => {
  test("canonicalizes object key order without losing array order", () => {
    const left = { b: 2, a: { y: [2, 1], x: true } };
    const right = { a: { x: true, y: [2, 1] }, b: 2 };
    expect(canonicalSubject(left)).toBe(canonicalSubject(right));
    expect(subjectDigest(left)).toBe(subjectDigest(right));
  });
  test("refuses unsupported identity values", () => expect(() => canonicalSubject(undefined)).toThrow("SA2A_UNSUPPORTED_IDENTITY_VALUE"));
});
