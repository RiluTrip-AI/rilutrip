/**
 * Operations Tests
 *
 * Test the operations-based itinerary update system
 */

import { describe, it, expect, vi } from "vitest";
import { applyOperations, parseOperations } from "@/lib/ai/operations";
import type { Itinerary } from "@/types";

vi.mock("@/lib/places/place-resolver", () => ({
  resolvePlaceDetails: vi.fn(async (loc: { name: string; lat?: number; lng?: number }) => ({
    status: "success" as const,
    location: {
      name: loc.name,
      lat: 36.0,
      lng: 140.0,
      place_id: "mock_place_id",
    },
  })),
}));

// Mock itinerary for testing
const mockItinerary: Itinerary = {
  id: "test-itinerary",
  user_id: "test-user",
  title: "Tokyo Adventure",
  destination: "Tokyo, Japan",
  start_date: "2026-03-01",
  end_date: "2026-03-03",
  days: [
    {
      day_number: 1,
      activities: [
        {
          id: "activity-1",
          time: "09:00",
          title: "Activity 1",
          note: "First activity",
          location: {
            name: "Location 1",
            lat: 35.6762,
            lng: 139.6503,
          },
          duration_minutes: 60,
          order: 0,
        },
        {
          id: "activity-2",
          time: "11:00",
          title: "Activity 2",
          note: "Second activity",
          location: {
            name: "Location 2",
            lat: 35.6812,
            lng: 139.7671,
          },
          duration_minutes: 90,
          order: 1,
        },
      ],
    },
    {
      day_number: 2,
      activities: [
        {
          id: "activity-3",
          time: "10:00",
          title: "Activity 3",
          note: "Third activity",
          location: {
            name: "Location 3",
            lat: 35.6595,
            lng: 139.7004,
          },
          duration_minutes: 120,
          order: 0,
        },
      ],
    },
    {
      day_number: 3,
      activities: [],
    },
  ],
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

describe("Operations System", () => {
  describe("ADD Operation", () => {
    it("should add activity to a day", async () => {
      const result = await applyOperations(mockItinerary, {
        operations: [
          {
            type: "ADD",
            day_number: 1,
            activity: {
              time: "14:00",
              title: "New Activity",
              note: "Added activity",
              location: {
                name: "New Location",
                lat: 35.6586,
                lng: 139.7454,
              },
              duration_minutes: 60,
            },
          },
        ],
      });

      expect(result.days[0].activities).toHaveLength(3);
      expect(result.days[0].activities[2].title).toBe("New Activity");
      expect(result.days[0].activities[2].id).toBeDefined();
      expect(result.days[0].activities[2].order).toBe(2);
    });

    it("should insert activity at specific position", async () => {
      const result = await applyOperations(mockItinerary, {
        operations: [
          {
            type: "ADD",
            day_number: 1,
            activity: {
              time: "10:00",
              title: "Inserted Activity",
              location: {
                name: "Location",
                lat: 35.0,
                lng: 139.0,
              },
              insert_at: 1, // Insert at index 1 (0-based, becomes second activity)
            },
          },
        ],
      });

      expect(result.days[0].activities).toHaveLength(3);
      expect(result.days[0].activities[1].title).toBe("Inserted Activity");
      expect(result.days[0].activities[1].order).toBe(1);
      expect(result.days[0].activities[2].order).toBe(2);
    });

    it("should add activity to empty day", async () => {
      const result = await applyOperations(mockItinerary, {
        operations: [
          {
            type: "ADD",
            day_number: 3,
            activity: {
              time: "09:00",
              title: "First Activity on Day 3",
              location: {
                name: "Location",
                lat: 35.0,
                lng: 139.0,
              },
            },
          },
        ],
      });

      expect(result.days[2].activities).toHaveLength(1);
      expect(result.days[2].activities[0].title).toBe("First Activity on Day 3");
    });
  });

  describe("REMOVE Operation", () => {
    it("should remove activity from a day", async () => {
      const result = await applyOperations(mockItinerary, {
        operations: [
          {
            type: "REMOVE",
            day_number: 1,
            activity_index: 0, // Remove first activity (0-based)
          },
        ],
      });

      expect(result.days[0].activities).toHaveLength(1);
      expect(result.days[0].activities[0].id).toBe("activity-2");
      expect(result.days[0].activities[0].order).toBe(0);
    });

    it("should handle removing with invalid index", async () => {
      const result = await applyOperations(mockItinerary, {
        operations: [
          {
            type: "REMOVE",
            day_number: 1,
            activity_index: 999, // Invalid index
          },
        ],
      });

      // Should not crash, original activities remain
      expect(result.days[0].activities).toHaveLength(2);
    });
  });

  describe("UPDATE Operation", () => {
    it("should update activity fields", async () => {
      const result = await applyOperations(mockItinerary, {
        operations: [
          {
            type: "UPDATE",
            day_number: 1,
            activity_index: 0, // First activity (0-based)
            changes: {
              time: "10:00",
              title: "Updated Title",
              note: "Updated note",
            },
          },
        ],
      });

      const updated = result.days[0].activities[0];
      expect(updated.time).toBe("10:00");
      expect(updated.title).toBe("Updated Title");
      expect(updated.note).toBe("Updated note");
      // Other fields should remain unchanged
      expect(updated.location.name).toBe("Location 1");
    });

    it("should resolve location through place resolver", async () => {
      const result = await applyOperations(mockItinerary, {
        operations: [
          {
            type: "UPDATE",
            day_number: 1,
            activity_index: 0,
            changes: {
              location: {
                name: "Updated Location",
              },
            },
          },
        ],
      });

      const updated = result.days[0].activities[0];
      expect(updated.location.name).toBe("Updated Location");
      // Coords come from our global mock above
      expect(updated.location.lat).toBe(36.0);
      expect(updated.location.lng).toBe(140.0);
      expect(updated.location.place_id).toBe("mock_place_id");
    });
  });

  describe("MOVE Operation", () => {
    it("should move activity between days", async () => {
      const result = await applyOperations(mockItinerary, {
        operations: [
          {
            type: "MOVE",
            from_day_number: 1,
            from_activity_index: 0, // First activity (0-based)
            to_day_number: 2,
          },
        ],
      });

      // Activity removed from day 1
      expect(result.days[0].activities).toHaveLength(1);
      expect(result.days[0].activities[0].id).toBe("activity-2");

      // Activity added to day 2
      expect(result.days[1].activities).toHaveLength(2);
      expect(result.days[1].activities[1].id).toBe("activity-1");

      // Orders recalculated
      expect(result.days[0].activities[0].order).toBe(0);
      expect(result.days[1].activities[0].order).toBe(0);
      expect(result.days[1].activities[1].order).toBe(1);
    });

    it("should move activity to specific position", async () => {
      const result = await applyOperations(mockItinerary, {
        operations: [
          {
            type: "MOVE",
            from_day_number: 2,
            from_activity_index: 0, // First activity of day 2 (0-based)
            to_day_number: 1,
            insert_at: 1, // Insert as second activity (0-based)
          },
        ],
      });

      expect(result.days[0].activities).toHaveLength(3);
      expect(result.days[0].activities[1].id).toBe("activity-3");
      expect(result.days[1].activities).toHaveLength(0);
    });
  });

  describe("REORDER Operation", () => {
    it("should reorder activities within a day", async () => {
      const result = await applyOperations(mockItinerary, {
        operations: [
          {
            type: "REORDER",
            day_number: 1,
            activity_order: [1, 0], // Swap first and second (0-based indices)
          },
        ],
      });

      expect(result.days[0].activities[0].id).toBe("activity-2");
      expect(result.days[0].activities[1].id).toBe("activity-1");
      expect(result.days[0].activities[0].order).toBe(0);
      expect(result.days[0].activities[1].order).toBe(1);
    });
  });

  describe("Multiple Operations", () => {
    it("should apply multiple operations in sequence", async () => {
      const result = await applyOperations(mockItinerary, {
        operations: [
          {
            type: "REMOVE",
            day_number: 1,
            activity_index: 0, // Remove first activity (0-based)
          },
          {
            type: "ADD",
            day_number: 2,
            activity: {
              time: "15:00",
              title: "New Activity",
              location: {
                name: "Location",
                lat: 35.0,
                lng: 139.0,
              },
            },
          },
          {
            type: "UPDATE",
            day_number: 1,
            activity_index: 0, // Now the first activity (was second before removal, 0-based)
            changes: {
              title: "Updated Activity 2",
            },
          },
        ],
      });

      // Activity 1 removed from day 1
      expect(result.days[0].activities).toHaveLength(1);
      expect(result.days[0].activities[0].id).toBe("activity-2");

      // Activity 2 updated
      expect(result.days[0].activities[0].title).toBe("Updated Activity 2");

      // New activity added to day 2
      expect(result.days[1].activities).toHaveLength(2);
      expect(result.days[1].activities[1].title).toBe("New Activity");
    });

    it("should handle move and update combination", async () => {
      const result = await applyOperations(mockItinerary, {
        operations: [
          {
            type: "MOVE",
            from_day_number: 1,
            from_activity_index: 0, // First activity (0-based)
            to_day_number: 3,
          },
          {
            type: "UPDATE",
            day_number: 3,
            activity_index: 0, // Now first activity in day 3 (0-based)
            changes: {
              time: "14:00",
              title: "Moved and Updated",
            },
          },
        ],
      });

      expect(result.days[2].activities).toHaveLength(1);
      expect(result.days[2].activities[0].id).toBe("activity-1");
      expect(result.days[2].activities[0].time).toBe("14:00");
      expect(result.days[2].activities[0].title).toBe("Moved and Updated");
    });
  });

  describe("Automatic Day Creation", () => {
    it("should create new days when adding activity to non-existent day", async () => {
      const result = await applyOperations(mockItinerary, {
        operations: [
          {
            type: "ADD",
            day_number: 5, // Itinerary has 3 days
            activity: {
              time: "10:00",
              title: "Activity on New Day",
              location: {
                name: "Location",
                lat: 35.0,
                lng: 139.0,
              },
            },
          },
        ],
      });

      expect(result.days).toHaveLength(5);
      expect(result.days[3].day_number).toBe(4); // Empty intermediate day
      expect(result.days[3].activities).toHaveLength(0);
      expect(result.days[4].day_number).toBe(5); // Target day
      expect(result.days[4].activities).toHaveLength(1);
      expect(result.days[4].activities[0].title).toBe("Activity on New Day");

      // Dates should be correct
      expect(result.end_date).toBe("2026-03-05");
    });

    it("should create new days when moving activity to non-existent day", async () => {
      const result = await applyOperations(mockItinerary, {
        operations: [
          {
            type: "MOVE",
            from_day_number: 1,
            from_activity_index: 0,
            to_day_number: 5, // Itinerary has 3 days
          },
        ],
      });

      expect(result.days).toHaveLength(5);
      // Activity removed from day 1
      expect(result.days[0].activities).toHaveLength(1);

      // Target day created and populated
      expect(result.days[4].day_number).toBe(5);
      expect(result.days[4].activities).toHaveLength(1);
      expect(result.days[4].activities[0].id).toBe("activity-1"); // Moved activity

      // Dates updated
      expect(result.end_date).toBe("2026-03-05");
    });
  });

  describe("parseOperations", () => {
    it("should parse operations from JSON string", () => {
      const json = JSON.stringify({
        operations: [
          {
            type: "ADD",
            day_number: 1,
            activity: {
              time: "14:00",
              title: "Test",
              location: {
                name: "Test Location",
                lat: 35.0,
                lng: 139.0,
              },
            },
          },
        ],
      });

      const result = parseOperations(json);
      expect(result).not.toBeNull();
      expect(result?.operations).toHaveLength(1);
      expect(result?.operations[0].type).toBe("ADD");
    });

    it("should parse operations from object", () => {
      const obj = {
        operations: [
          {
            type: "REMOVE",
            day_number: 1,
            activity_index: 1,
          },
        ],
      };

      const result = parseOperations(obj);
      expect(result).not.toBeNull();
      expect(result?.operations).toHaveLength(1);
    });

    it("should return null for invalid input", () => {
      const result = parseOperations("invalid json");
      expect(result).toBeNull();
    });

    it("should return null for missing operations array", () => {
      const result = parseOperations(JSON.stringify({ someOtherField: "Test" }));
      expect(result).toBeNull();
    });
  });

  describe("Data Integrity", () => {
    it("should not mutate original itinerary", async () => {
      const original = JSON.parse(JSON.stringify(mockItinerary));

      await applyOperations(mockItinerary, {
        operations: [
          {
            type: "ADD",
            day_number: 1,
            activity: {
              time: "14:00",
              title: "New Activity",
              location: {
                name: "Location",
                lat: 35.0,
                lng: 139.0,
              },
            },
          },
        ],
      });

      // Original should remain unchanged
      expect(mockItinerary).toEqual(original);
    });

    it("should update timestamp", async () => {
      const result = await applyOperations(mockItinerary, {
        operations: [
          {
            type: "ADD",
            day_number: 1,
            activity: {
              time: "14:00",
              title: "Test",
              location: {
                name: "Location",
                lat: 35.0,
                lng: 139.0,
              },
            },
          },
        ],
      });

      expect(result.updated_at).not.toBe(mockItinerary.updated_at);
      expect(new Date(result.updated_at).getTime()).toBeGreaterThan(
        new Date(mockItinerary.updated_at).getTime(),
      );
    });
  });
});
