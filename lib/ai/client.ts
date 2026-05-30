/**
 * AI Client
 *
 * This module provides a client for interacting with the AI API
 * via Next.js API Routes. It handles:
 * - Streaming responses
 * - Error handling
 * - Progressive UI updates
 *
 * Requirements: 3.3, 3.5, 17.1, 17.3
 */

import type { Itinerary, ChatMessage } from "@/types";
import { extractJSON } from "./parser";
import { parseOperations, type OperationsUpdate } from "./operations";
import { getAccessToken } from "@/lib/supabase/client";
import { fetchEventSource } from "@microsoft/fetch-event-source";
import type { Activity, TransportMode } from "@/types/itinerary";

export type SSEActivityEvent = {
  day_number: number;
  activity: Activity;
};
export type SSEDayMetaEvent = {
  day_number: number;
  start_time?: string;
  end_time?: string;
  transport_mode?: TransportMode;
};
export type SSEErrorEvent = { message: string };

/**
 * Error types for API responses
 */
export class ApiError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/**
 * Options for chat interaction
 */
export interface ChatOptions {
  message: string;
  history: ChatMessage[];
  context: Itinerary | null;
  locale: string;
}

/**
 * AI Client
 *
 * Provides methods for interacting with AI API through Next.js API Routes
 */
export class AIClient {
  async streamItinerary(
    itineraryId: string,
    locale: string,
    onActivity: (data: SSEActivityEvent) => void,
    onDayMeta: (data: SSEDayMetaEvent) => void,
    onComplete: () => void,
    onError: (data: SSEErrorEvent) => void,
    signal: AbortSignal,
  ): Promise<void> {
    const token = await getAccessToken();

    // Capture handleErrorResponse reference to avoid 'this' binding issues
    const handleError = this.handleErrorResponse.bind(this);

    await fetchEventSource("/api/generate-itinerary", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token && { Authorization: `Bearer ${token}` }),
      },
      body: JSON.stringify({
        itinerary_id: itineraryId,
        locale,
      }),
      signal,
      async onopen(response) {
        if (!response.ok) {
          throw await handleError(response);
        }
      },
      onmessage(msg) {
        // fetchEventSource automatically parses SSE format and provides event type
        if (msg.event === "activity") {
          const data = JSON.parse(msg.data) as SSEActivityEvent;
          onActivity(data);
        } else if (msg.event === "day_meta") {
          const data = JSON.parse(msg.data) as SSEDayMetaEvent;
          onDayMeta(data);
        } else if (msg.event === "complete") {
          onComplete();
        } else if (msg.event === "error") {
          const data = JSON.parse(msg.data) as SSEErrorEvent;
          onError(data);
        }
      },
      onerror(err) {
        // Prevent automatic reconnection by throwing
        throw err;
      },
      openWhenHidden: true, // Continue streaming even when tab is hidden
    });
  }

  /**
   * Send a chat message with streaming support
   *
   * @param options - Chat options
   * @param onChunk - Callback for each streaming chunk
   * @returns AI response message
   * @throws ApiError if the API responds with an error code
   */
  async chat(
    options: ChatOptions,
    onChunk: (chunk: string) => void,
  ): Promise<{ message: string; operations?: OperationsUpdate }> {
    const { message, history, context, locale } = options;

    const token = await getAccessToken();

    const response = await fetch("/api/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token && { Authorization: `Bearer ${token}` }),
      },
      body: JSON.stringify({
        message,
        history: history.map((msg) => ({
          role: msg.role,
          content: msg.content,
        })),
        itinerary_context: context,
        locale,
      }),
    });

    if (!response.ok) {
      throw await this.handleErrorResponse(response);
    }

    if (!response.body) {
      throw new Error("No response body received");
    }

    // Stream response
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const OPERATIONS_MARKER = "ITINERARY_OPERATIONS:";

    let fullResponse = "";
    let streamedUpTo = 0;
    let markerFound = false;
    let operations: OperationsUpdate | undefined;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        fullResponse += chunk;

        if (markerFound) {
          // Already found marker, just accumulate remaining content
          continue;
        }

        // Check for operations marker
        const markerIndex = fullResponse.indexOf(OPERATIONS_MARKER);
        if (markerIndex !== -1) {
          // Marker found - stream everything before it
          this.streamContent(fullResponse, streamedUpTo, markerIndex, onChunk);
          streamedUpTo = markerIndex;
          markerFound = true;
          continue;
        }

        // No marker yet - stream safe content (keep buffer for potential split marker)
        const safeUpTo = Math.max(0, fullResponse.length - OPERATIONS_MARKER.length);
        this.streamContent(fullResponse, streamedUpTo, safeUpTo, onChunk);
        streamedUpTo = safeUpTo;
      }

      // Parse operations if marker was found
      if (markerFound) {
        const markerIndex = fullResponse.indexOf(OPERATIONS_MARKER);
        const cleanMessage = fullResponse.substring(0, markerIndex).trim();
        const jsonPart = fullResponse.substring(markerIndex + OPERATIONS_MARKER.length).trim();

        try {
          // Extract JSON from markdown code blocks if present
          const extractedJSON = extractJSON(jsonPart) || jsonPart;
          const parsedOperations = parseOperations(JSON.parse(extractedJSON));
          if (parsedOperations) {
            operations = parsedOperations;
          }
        } catch (error) {
          console.error("Failed to parse itinerary operations:", error);
        }

        console.log("ai response:", fullResponse);
        fullResponse = cleanMessage;
      } else {
        // Stream any remaining buffered content if no marker was found
        this.streamContent(fullResponse, streamedUpTo, fullResponse.length, onChunk);
      }

      return {
        message: fullResponse,
        operations,
      };
    } catch (error) {
      throw new Error(
        `Failed to process chat response: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }

  /**
   * Stream content from startIndex to endIndex
   * Helper method to avoid code duplication
   */
  private streamContent(
    content: string,
    startIndex: number,
    endIndex: number,
    onChunk: (chunk: string) => void,
  ): void {
    if (endIndex > startIndex) {
      const toStream = content.substring(startIndex, endIndex);
      onChunk(toStream);
    }
  }

  /**
   * Handle error response from API
   *
   * @param response - Fetch response
   * @returns ApiError
   */
  private async handleErrorResponse(response: Response): Promise<ApiError> {
    let errorMessage = `API request failed with status ${response.status}`;
    let errorCode = "API_ERROR";

    try {
      const errorData = await response.json();
      errorMessage = errorData.error || errorMessage;
      errorCode = errorData.code || errorCode;
    } catch {
      // Failed to parse error response, use default message
    }

    return new ApiError(errorMessage, errorCode);
  }
}

/**
 * Default AI client instance
 */
export const aiClient = new AIClient();
