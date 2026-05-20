import { describe, expect, it } from "vitest";
import { normalizeNativeRequestMethod } from "./nativeHttp";

describe("native HTTP helpers", () => {
  it("allows mutation methods used by subscription settings", () => {
    expect(normalizeNativeRequestMethod("patch", "The subscriptions bridge")).toBe("PATCH");
    expect(normalizeNativeRequestMethod("PUT", "The subscriptions bridge")).toBe("PUT");
  });

  it("defaults to GET and normalizes supported methods", () => {
    expect(normalizeNativeRequestMethod(undefined, "The subscriptions bridge")).toBe("GET");
    expect(normalizeNativeRequestMethod(" post ", "The subscriptions bridge")).toBe("POST");
    expect(normalizeNativeRequestMethod("delete", "The subscriptions bridge")).toBe("DELETE");
  });

  it("rejects unsupported methods with the bridge label", () => {
    expect(() => normalizeNativeRequestMethod("OPTIONS", "The subscriptions bridge")).toThrow(
      "The subscriptions bridge does not support OPTIONS requests.",
    );
  });
});
