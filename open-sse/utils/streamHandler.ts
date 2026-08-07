// Stream handler with disconnect detection - shared for all providers

type StreamControllerOptions = {
  onDisconnect?: (info: { reason: unknown; duration: number }) => void;
  onError?: (error: unknown) => void;
  log?: unknown;
  provider?: unknown;
  model?: unknown;
};

export type StreamController = {
  signal: AbortSignal;
  startTime: number;
  isConnected: () => boolean;
  handleDisconnect: (reason?: unknown) => void;
  handleComplete: () => void;
  handleError: (error: unknown) => void;
  abort: () => void;
};

type StreamPair = {
  readable: { getReader: () => ReadableStreamDefaultReader<Uint8Array> };
  writable: { getWriter: () => { abort: (reason?: unknown) => Promise<unknown> } };
};

// Get HH:MM:SS timestamp
function getTimeString() {
  return new Date().toLocaleTimeString("en-US", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function errorName(error: unknown) {
  return error instanceof Error ? error.name : "";
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Create stream controller with abort and disconnect detection
 * @param {object} options
 * @param {function} options.onDisconnect - Callback when client disconnects
 * @param {object} options.log - Logger instance
 * @param {string} options.provider - Provider name
 * @param {string} options.model - Model name
 */
export function createStreamController({
  onDisconnect,
  onError,
  log: _log,
  provider: _provider,
  model: _model,
}: StreamControllerOptions = {}): StreamController {
  const abortController = new AbortController();
  const startTime = Date.now();
  let disconnected = false;
  let abortTimeout: ReturnType<typeof setTimeout> | null = null;

  const logStream = (status: string) => {
    const duration = Date.now() - startTime;
    console.log(`[${getTimeString()}] 🌊 [STREAM] ${duration}ms | ${status}`);
  };

  return {
    signal: abortController.signal,
    startTime,

    isConnected: () => !disconnected,

    // Call when client disconnects
    handleDisconnect: (reason: unknown = "client_closed") => {
      if (disconnected) return;
      disconnected = true;

      logStream(`disconnect: ${reason}`);

      // Delay abort to allow cleanup
      abortTimeout = setTimeout(() => {
        abortController.abort();
      }, 500);

      onDisconnect?.({ reason, duration: Date.now() - startTime });
    },

    // Call when stream completes normally
    handleComplete: () => {
      if (disconnected) return;
      disconnected = true;

      logStream("complete");

      if (abortTimeout) {
        clearTimeout(abortTimeout);
        abortTimeout = null;
      }
    },

    // Call on error
    handleError: (error: unknown) => {
      if (disconnected) return;
      disconnected = true;

      if (abortTimeout) {
        clearTimeout(abortTimeout);
        abortTimeout = null;
      }

      if (errorName(error) === "AbortError") {
        logStream("aborted");
        return;
      }

      logStream(`error: ${errorMessage(error)}`);
      onError?.(error);
    },

    abort: () => abortController.abort(),
  };
}

/**
 * Create transform stream with disconnect detection
 * Wraps existing transform stream and adds abort capability
 */
export function createDisconnectAwareStream(
  transformStream: StreamPair,
  streamController: StreamController,
) {
  const reader = transformStream.readable.getReader();
  const writer = transformStream.writable.getWriter();

  return new ReadableStream({
    async pull(controller: ReadableStreamDefaultController<Uint8Array>) {
      if (!streamController.isConnected()) {
        controller.close();
        return;
      }

      try {
        const { done, value } = await reader.read();
        if (done) {
          streamController.handleComplete();
          controller.close();
          return;
        }
        controller.enqueue(value);
      } catch (error: unknown) {
        streamController.handleError(error);
        // Cleanup reader/writer to avoid orphaned streams
        reader.cancel().catch(() => {
          // Cleanup only; stream is already handling the read error.
        });
        writer.abort().catch(() => {
          // Cleanup only; stream is already handling the read error.
        });
        controller.error(error);
      }
    },

    cancel(reason?: unknown) {
      streamController.handleDisconnect(reason || "cancelled");
      reader.cancel();
      writer.abort();
    },
  });
}

/**
 * Pipe provider response through transform with disconnect detection
 * @param {Response} providerResponse - Response from provider
 * @param {TransformStream} transformStream - Transform stream for SSE
 * @param {object} streamController - Stream controller from createStreamController
 */
export function pipeWithDisconnect(
  providerResponse: Response,
  transformStream: TransformStream,
  streamController: unknown,
) {
  const ctrl = streamController as StreamController;
  const transformedBody = (providerResponse.body as ReadableStream).pipeThrough(transformStream);
  return createDisconnectAwareStream(
    {
      readable: transformedBody,
      writable: { getWriter: () => ({ abort: () => Promise.resolve() }) },
    },
    ctrl,
  );
}
