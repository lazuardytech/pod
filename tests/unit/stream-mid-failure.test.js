import { describe, expect, it, vi } from "vitest";

import { createDisconnectAwareStream, createStreamController } from "../../open-sse/utils/streamHandler.js";

// ─── createStreamController ───────────────────────────────────────────

describe("createStreamController — disconnect and error handling", () => {
  it("marks stream as disconnected on handleDisconnect", () => {
    const controller = createStreamController();
    expect(controller.isConnected()).toBe(true);
    controller.handleDisconnect("client_closed");
    expect(controller.isConnected()).toBe(false);
  });

  it("calls onDisconnect callback when client disconnects", () => {
    const onDisconnect = vi.fn();
    const controller = createStreamController({ onDisconnect });
    controller.handleDisconnect("client_closed");
    expect(onDisconnect).toHaveBeenCalledWith({ reason: "client_closed", duration: expect.any(Number) });
  });

  it("aborts the signal after disconnect timeout", async () => {
    vi.useFakeTimers();
    const controller = createStreamController();
    expect(controller.signal.aborted).toBe(false);

    controller.handleDisconnect("client_closed");
    // Signal should NOT abort immediately — there's a 500ms delay
    expect(controller.signal.aborted).toBe(false);

    // Advance past the 500ms delay
    vi.advanceTimersByTime(600);
    expect(controller.signal.aborted).toBe(true);

    vi.useRealTimers();
  });

  it("handleComplete cancels the abort timeout", () => {
    vi.useFakeTimers();
    const controller = createStreamController();
    const abortSpy = vi.spyOn(controller, "abort");

    controller.handleComplete();
    // Advance past the 500ms delay — should NOT abort because handleComplete cleared it
    vi.advanceTimersByTime(600);
    expect(abortSpy).not.toHaveBeenCalled();

    vi.useRealTimers();
  });

  it("marks stream as disconnected on handleError", () => {
    const controller = createStreamController();
    controller.handleError(new Error("stream error"));
    expect(controller.isConnected()).toBe(false);
  });

  it("calls onError callback on handleError", () => {
    const onError = vi.fn();
    const controller = createStreamController({ onError });
    const error = new Error("stream crashed");
    controller.handleError(error);
    expect(onError).toHaveBeenCalledWith(error);
  });

  it("does not call onError for AbortError", () => {
    const onError = vi.fn();
    const controller = createStreamController({ onError });
    const error = new Error("aborted");
    error.name = "AbortError";
    controller.handleError(error);
    expect(onError).not.toHaveBeenCalled();
  });

  it("idempotent: calling handleDisconnect twice only triggers once", () => {
    const onDisconnect = vi.fn();
    const controller = createStreamController({ onDisconnect });
    controller.handleDisconnect("first");
    controller.handleDisconnect("second");
    expect(onDisconnect).toHaveBeenCalledTimes(1);
  });

  it("manually abort immediately aborts signal", () => {
    const controller = createStreamController();
    controller.abort();
    expect(controller.signal.aborted).toBe(true);
  });
});

// ─── createDisconnectAwareStream (reader errors) ──────────────────────

function mockReadableStream(readResults) {
  let index = 0;
  return new ReadableStream({
    async pull(controller) {
      if (index >= readResults.length) {
        controller.close();
        return;
      }
      const r = readResults[index++];
      if (r instanceof Error) {
        controller.error(r);
        return;
      }
      controller.enqueue(r);
    },
  });
}

describe("createDisconnectAwareStream — mid-stream failure behavior", () => {
  it("passes chunks through until stream completes", async () => {
    const streamController = createStreamController();
    const source = mockReadableStream([new TextEncoder().encode("chunk1"), new TextEncoder().encode("chunk2")]);
    const transform = new TransformStream();
    const piped = source.pipeThrough(transform);

    const aware = createDisconnectAwareStream(
      { readable: piped, writable: { getWriter: () => ({ abort: () => Promise.resolve() }) } },
      streamController,
    );

    const reader = aware.getReader();
    const chunks = [];
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      chunks.push(new TextDecoder().decode(value));
    }
    expect(chunks).toEqual(["chunk1", "chunk2"]);
    expect(streamController.isConnected()).toBe(false);
  });

  it("propagates mid-stream errors to the controller", async () => {
    const onError = vi.fn();
    const controllerWithOnError = createStreamController({ onError });
    // Reuse but we'll observe via isConnected+manual

    const source = mockReadableStream([new TextEncoder().encode("chunk1"), new Error("connection dropped")]);
    const transform = new TransformStream();
    const piped = source.pipeThrough(transform);

    const aware = createDisconnectAwareStream(
      { readable: piped, writable: { getWriter: () => ({ abort: () => Promise.resolve() }) } },
      controllerWithOnError,
    );

    const reader = aware.getReader();
    const chunks = [];
    let readError = null;
    while (true) {
      try {
        const { value, done } = await reader.read();
        if (done) break;
        chunks.push(new TextDecoder().decode(value));
      } catch (err) {
        readError = err;
        break;
      }
    }
    expect(chunks).toEqual(["chunk1"]);
    expect(readError).toBeTruthy();
    expect(readError.message).toBe("connection dropped");
    expect(controllerWithOnError.isConnected()).toBe(false);
    expect(onError).toHaveBeenCalled();
    expect(onError.mock.calls[0][0].message).toBe("connection dropped");
  });

  it("stops reading when stream controller is disconnected", async () => {
    const streamController = createStreamController();
    const source = mockReadableStream([
      new TextEncoder().encode("chunk1"),
      new TextEncoder().encode("chunk2"), // This should never be read
    ]);
    const transform = new TransformStream();
    const piped = source.pipeThrough(transform);

    const aware = createDisconnectAwareStream(
      { readable: piped, writable: { getWriter: () => ({ abort: () => Promise.resolve() }) } },
      streamController,
    );

    // Disconnect before first pull
    streamController.handleDisconnect("client_cancel");

    const reader = aware.getReader();
    const { done } = await reader.read();
    // Should close immediately without reading any chunks
    expect(done).toBe(true);
  });

  it("mid-stream error propagates to controller error callback", async () => {
    const onError = vi.fn();
    const streamController = createStreamController({ onError });
    const source = mockReadableStream([new Error("connection reset")]);
    const transform = new TransformStream();
    const piped = source.pipeThrough(transform);

    const aware = createDisconnectAwareStream(
      { readable: piped, writable: { getWriter: () => ({ abort: () => Promise.resolve() }) } },
      streamController,
    );

    const reader = aware.getReader();
    try {
      await reader.read();
    } catch {
      // expected
    }
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0].message).toBe("connection reset");
    expect(streamController.isConnected()).toBe(false);
  });
});
