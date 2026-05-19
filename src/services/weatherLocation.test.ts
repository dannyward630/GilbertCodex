import { describe, expect, it } from "vitest";
import { getPreferredWeatherUnits, resolveStoredWeatherLocationUnits, resolveWeatherUnitPreference, type StoredWeatherLocation } from "./weatherLocation";

const BASE_LOCATION: StoredWeatherLocation = {
  capturedAt: "2026-05-15T12:00:00.000Z",
  countryCode: "DE",
  countrySource: "manual",
  latitude: 52.52,
  locale: "de-DE",
  longitude: 13.405,
  preferredUnits: "metric",
  source: "manual",
  temperatureUnit: "C",
  timezone: "Europe/Berlin",
};

describe("weather temperature units", () => {
  it("uses Fahrenheit only for countries and territories that normally use it", () => {
    expect(getPreferredWeatherUnits("US")).toBe("us");
    expect(getPreferredWeatherUnits("PR")).toBe("us");
    expect(getPreferredWeatherUnits("DE")).toBe("metric");
    expect(getPreferredWeatherUnits("CN")).toBe("metric");
    expect(getPreferredWeatherUnits("MX")).toBe("metric");
  });

  it("allows manual Celsius and Fahrenheit overrides", () => {
    expect(resolveWeatherUnitPreference("DE", "auto")).toMatchObject({ preferredUnits: "metric", source: "country", temperatureUnit: "C" });
    expect(resolveWeatherUnitPreference("DE", "fahrenheit")).toMatchObject({ preferredUnits: "us", source: "manual", temperatureUnit: "F" });
    expect(resolveWeatherUnitPreference("US", "celsius")).toMatchObject({ preferredUnits: "metric", source: "manual", temperatureUnit: "C" });
  });

  it("applies unit overrides at runtime without changing the saved coordinates", () => {
    expect(resolveStoredWeatherLocationUnits(BASE_LOCATION, "fahrenheit")).toMatchObject({
      countryCode: "DE",
      latitude: 52.52,
      longitude: 13.405,
      preferredUnits: "us",
      temperatureUnit: "F",
    });
  });
});
