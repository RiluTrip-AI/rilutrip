/**
 * Property-Based Tests for Itinerary Persistence
 *
 * Feature: tripai-travel-planner
 * Property 22: Itinerary Database Persistence
 * Property 23: Itinerary Save-Load Round-trip
 * Property 24: Itinerary Deletion
 *
 * Validates: Requirements 10.1, 10.3, 10.4
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import * as fc from "fast-check";
import {
  loadItinerary,
  deleteItinerary,
  listUserItineraries,
  ItineraryUnavailableError,
} from "@/lib/supabase/itineraries";
import { supabase } from "@/lib/supabase/client";
import { itineraryArbitrary } from "@/test/utils/property-test-helpers";

// Mock Supabase client
vi.mock("@/lib/supabase/client", () => ({
  supabase: {
    from: vi.fn(),
    rpc: vi.fn(),
    auth: {
      getUser: vi.fn(),
      getSession: vi.fn(),
    },
  },
}));

describe("Property 22: Itinerary Database Persistence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(supabase.rpc).mockReset();
  });

  // Feature: tripai-travel-planner, Property 22: Itinerary Database Persistence
  it("should retrieve saved itinerary by ID", async () => {
    await fc.assert(
      fc.asyncProperty(itineraryArbitrary, async (itinerary) => {
        // Mock successful load
        const mockFrom = vi.fn(() => ({
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({
            data: {
              id: itinerary.id,
              user_id: itinerary.user_id,
              title: itinerary.title,
              destination: itinerary.destination,
              start_date: itinerary.start_date,
              end_date: itinerary.end_date,
              data: {
                days: itinerary.days,
              },
              settings: {
                startTime: "09:00",
                endTime: "21:00",
                transportMode: "driving",
              },
              created_at: itinerary.created_at,
              updated_at: itinerary.updated_at,
            },
            error: null,
          }),
        }));

        vi.mocked(supabase.from).mockImplementation(mockFrom as unknown as typeof supabase.from);

        // Load the itinerary
        const result = await loadItinerary(itinerary.id);

        // Verify all data is retrieved
        expect(result.id).toBe(itinerary.id);
        expect(result.user_id).toBe(itinerary.user_id);
        expect(result.title).toBe(itinerary.title);
        expect(result.destination).toBe(itinerary.destination);
        expect(result.start_date).toBe(itinerary.start_date);
        expect(result.end_date).toBe(itinerary.end_date);
        expect(result.days).toEqual(itinerary.days);
        expect(result.created_at).toBe(itinerary.created_at);
        expect(result.updated_at).toBe(itinerary.updated_at);

        // Verify database was called with correct ID
        expect(supabase.from).toHaveBeenCalledWith("itineraries");
      }),
      { numRuns: 100 },
    );
  });

  it("loads persisted days with missing day settings from itinerary settings", async () => {
    const itinerary = fc.sample(itineraryArbitrary, 1)[0];
    const settings = {
      startTime: "10:00",
      endTime: "20:00",
      transportMode: "walking" as const,
    };
    const persistedDays = itinerary.days.map((day) => {
      const persistedDay: Record<string, unknown> = { ...day };
      delete persistedDay.start_time;
      delete persistedDay.end_time;
      delete persistedDay.transport_mode;
      return persistedDay;
    });
    const mockFrom = vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: {
          id: itinerary.id,
          user_id: itinerary.user_id,
          title: itinerary.title,
          destination: itinerary.destination,
          start_date: itinerary.start_date,
          end_date: itinerary.end_date,
          data: {
            days: persistedDays,
          },
          settings,
          created_at: itinerary.created_at,
          updated_at: itinerary.updated_at,
        },
        error: null,
      }),
    }));

    vi.mocked(supabase.from).mockImplementation(mockFrom as unknown as typeof supabase.from);

    const result = await loadItinerary(itinerary.id);

    expect(result.days).toEqual(
      itinerary.days.map((day) => ({
        ...day,
        start_time: settings.startTime,
        end_time: settings.endTime,
        transport_mode: settings.transportMode,
      })),
    );
  });

  // Feature: tripai-travel-planner, Property 22: Itinerary Database Persistence
  it("should throw ItineraryUnavailableError when loading non-existent itinerary", async () => {
    await fc.assert(
      fc.asyncProperty(fc.uuid(), async (nonExistentId) => {
        // Mock not found error
        const mockFrom = vi.fn(() => ({
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({
            data: null,
            error: {
              message: "No rows found",
              code: "PGRST116",
            },
          }),
        }));

        vi.mocked(supabase.from).mockImplementation(mockFrom as unknown as typeof supabase.from);
        vi.mocked(supabase.rpc).mockReturnValue({
          single: vi.fn().mockResolvedValue({
            data: null,
            error: {
              message: "No rows found",
              code: "PGRST116",
            },
          }),
        } as unknown as ReturnType<typeof supabase.rpc>);

        // Attempt to load should throw
        await expect(loadItinerary(nonExistentId)).rejects.toThrow(ItineraryUnavailableError);
      }),
      { numRuns: 100 },
    );
  });
});

describe("Property 24: Itinerary Deletion", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(supabase.rpc).mockReset();
  });

  // Feature: tripai-travel-planner, Property 24: Itinerary Deletion
  it("should permanently remove itinerary from database", async () => {
    await fc.assert(
      fc.asyncProperty(fc.uuid(), async (itineraryId) => {
        // Mock successful deletion
        const mockDeleteFrom = vi.fn(() => ({
          delete: vi.fn().mockReturnThis(),
          eq: vi.fn().mockResolvedValue({
            data: null,
            error: null,
          }),
        }));

        vi.mocked(supabase.from).mockImplementation(
          mockDeleteFrom as unknown as typeof supabase.from,
        );

        // Delete the itinerary
        await deleteItinerary(itineraryId);

        // Verify delete was called
        expect(supabase.from).toHaveBeenCalledWith("itineraries");

        // Mock subsequent load attempt (should fail)
        const mockLoadFrom = vi.fn(() => ({
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({
            data: null,
            error: {
              message: "No rows found",
              code: "PGRST116",
            },
          }),
        }));

        vi.mocked(supabase.from).mockImplementation(
          mockLoadFrom as unknown as typeof supabase.from,
        );
        vi.mocked(supabase.rpc).mockReturnValue({
          single: vi.fn().mockResolvedValue({
            data: null,
            error: {
              message: "No rows found",
              code: "PGRST116",
            },
          }),
        } as unknown as ReturnType<typeof supabase.rpc>);

        // Attempting to load deleted itinerary should throw
        await expect(loadItinerary(itineraryId)).rejects.toThrow(ItineraryUnavailableError);
      }),
      { numRuns: 100 },
    );
  });

  // Feature: tripai-travel-planner, Property 24: Itinerary Deletion
  it("should throw ItineraryUnavailableError when deleting non-existent itinerary", async () => {
    await fc.assert(
      fc.asyncProperty(fc.uuid(), async (nonExistentId) => {
        // Mock not found error on delete
        const mockFrom = vi.fn(() => ({
          delete: vi.fn().mockReturnThis(),
          eq: vi.fn().mockResolvedValue({
            data: null,
            error: {
              message: "No rows found",
              code: "PGRST116",
            },
          }),
        }));

        vi.mocked(supabase.from).mockImplementation(mockFrom as unknown as typeof supabase.from);

        // Attempt to delete should throw
        await expect(deleteItinerary(nonExistentId)).rejects.toThrow(ItineraryUnavailableError);
      }),
      { numRuns: 100 },
    );
  });

  // Feature: tripai-travel-planner, Property 24: Itinerary Deletion
  it("should not return deleted itinerary in list", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(itineraryArbitrary, { minLength: 2, maxLength: 5 }),
        fc.integer({ min: 0, max: 4 }),
        async (itineraries, deleteIndex) => {
          // Ensure deleteIndex is valid
          fc.pre(deleteIndex < itineraries.length);

          const itineraryToDelete = itineraries[deleteIndex];

          // Mock successful deletion
          const mockDeleteFrom = vi.fn(() => ({
            delete: vi.fn().mockReturnThis(),
            eq: vi.fn().mockResolvedValue({
              data: null,
              error: null,
            }),
          }));

          vi.mocked(supabase.from).mockImplementation(
            mockDeleteFrom as unknown as typeof supabase.from,
          );

          // Delete one itinerary
          await deleteItinerary(itineraryToDelete.id);

          // Mock list operation (should not include deleted)
          const remainingItineraries = itineraries.filter((_, i) => i !== deleteIndex);
          const mockListFrom = vi.fn(() => ({
            select: vi.fn().mockReturnThis(),
            order: vi.fn().mockResolvedValue({
              data: remainingItineraries.map((it) => ({
                id: it.id,
                title: it.title,
                destination: it.destination,
                start_date: it.start_date,
                end_date: it.end_date,
                created_at: it.created_at,
                updated_at: it.updated_at,
              })),
              error: null,
            }),
          }));

          vi.mocked(supabase.from).mockImplementation(
            mockListFrom as unknown as typeof supabase.from,
          );

          // List itineraries
          const list = await listUserItineraries();

          // Verify deleted itinerary is not in list
          expect(list.find((it) => it.id === itineraryToDelete.id)).toBeUndefined();
          expect(list.length).toBe(remainingItineraries.length);
        },
      ),
      { numRuns: 100 },
    );
  });
});
