import * as fc from "fast-check";

/**
 * Property-based testing helpers using fast-check
 */

/**
 * Arbitrary for generating optional coordinates
 */
export const optionalCoordinateArb = fc.oneof(
  fc.record({
    lat: fc.double({ min: -90, max: 90, noNaN: true }),
    lng: fc.double({ min: -180, max: 180, noNaN: true }),
  }),
  fc.constant({}),
);

/**
 * Arbitrary for generating valid location data
 */
export const locationArbitrary = fc
  .record({
    name: fc.string({ minLength: 1, maxLength: 100 }),
    place_id: fc.option(fc.string(), { nil: undefined }),
  })
  .chain((base) =>
    optionalCoordinateArb.map((coords) => ({
      ...base,
      ...coords,
    })),
  );

/**
 * Arbitrary for generating valid activity data
 */
export const activityArbitrary = fc.record({
  id: fc.uuid(),
  time: fc
    .integer({ min: 0, max: 23 })
    .chain((hour) =>
      fc
        .integer({ min: 0, max: 59 })
        .map(
          (minute) => `${hour.toString().padStart(2, "0")}:${minute.toString().padStart(2, "0")}`,
        ),
    ),
  title: fc.string({ minLength: 1, maxLength: 100 }),
  note: fc.string({ minLength: 1, maxLength: 500 }),
  location: locationArbitrary,
  duration_minutes: fc.integer({ min: 15, max: 480 }),
  order: fc.nat(),
});

/**
 * Arbitrary for generating valid day data
 */
export const dayArbitrary = fc.record({
  day_number: fc.integer({ min: 1, max: 30 }),
  activities: fc.array(activityArbitrary, { minLength: 0, maxLength: 10 }),
  start_time: fc.constant("09:00"),
  end_time: fc.constant("21:00"),
  transport_mode: fc.constantFrom("driving", "walking", "transit", "bicycling"),
});

/**
 * Arbitrary for generating valid itinerary data
 */
export const itineraryArbitrary = fc.record({
  id: fc.uuid(),
  user_id: fc.uuid(),
  title: fc.string({ minLength: 1, maxLength: 100 }),
  destination: fc.string({ minLength: 1, maxLength: 100 }),
  start_date: fc
    .integer({
      min: new Date("2020-01-01").getTime(),
      max: new Date("2030-12-31").getTime(),
    })
    .map((ts) => new Date(ts).toISOString().split("T")[0]),
  end_date: fc
    .integer({
      min: new Date("2020-01-01").getTime(),
      max: new Date("2030-12-31").getTime(),
    })
    .map((ts) => new Date(ts).toISOString().split("T")[0]),
  days: fc.array(dayArbitrary, { minLength: 1, maxLength: 30 }),
  created_at: fc
    .integer({
      min: new Date("2020-01-01").getTime(),
      max: new Date("2030-12-31").getTime(),
    })
    .map((ts) => new Date(ts).toISOString()),
  updated_at: fc
    .integer({
      min: new Date("2020-01-01").getTime(),
      max: new Date("2030-12-31").getTime(),
    })
    .map((ts) => new Date(ts).toISOString()),
});

/**
 * Arbitrary for generating chat messages
 */
export const chatMessageArbitrary = fc.record({
  id: fc.uuid(),
  role: fc.constantFrom("user", "assistant"),
  content: fc.string({ minLength: 1, maxLength: 1000 }),
  timestamp: fc.integer({ min: 0 }),
  streaming: fc.option(fc.boolean(), { nil: undefined }),
});

/**
 * Arbitrary for generating non-empty strings (for validation tests)
 */
export const nonEmptyStringArbitrary = fc.string({ minLength: 1 });

/**
 * Arbitrary for generating whitespace-only strings (for validation tests)
 */
export const whitespaceStringArbitrary = fc
  .array(fc.constantFrom(" ", "\t", "\n", "\r"), { minLength: 1 })
  .map((chars) => chars.join(""));

/**
 * Arbitrary for generating theme modes
 */
export const themeModeArbitrary = fc.constantFrom("light", "dark", "system");
