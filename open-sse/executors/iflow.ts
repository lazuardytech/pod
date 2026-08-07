import crypto from "node:crypto";
import { PROVIDERS } from "../config/providers.js";
import {
  BaseExecutor,
  type ExecutorConfigInput,
  type ExecutorCredentials,
  type ExecutorHeaders,
} from "./base.js";

/**
 * IFlowExecutor - Executor for iFlow API with HMAC-SHA256 signature
 */
export class IFlowExecutor extends BaseExecutor {
  constructor() {
    super("iflow", (PROVIDERS as Record<string, ExecutorConfigInput>).iflow!);
  }

  /**
   * Generate UUID v4
   * @returns {string} UUID v4 string
   */
  generateUUID() {
    return crypto.randomUUID();
  }

  /**
   * Create iFlow signature using HMAC-SHA256
   * @param {string} userAgent - User agent string
   * @param {string} sessionID - Session ID
   * @param {number} timestamp - Unix timestamp in milliseconds
   * @param {string} apiKey - API key for signing
   * @returns {string} Hex-encoded signature
   */
  createIFlowSignature(userAgent: string, sessionID: string, timestamp: number, apiKey: string) {
    if (!apiKey) return "";
    const payload = `${userAgent}:${sessionID}:${timestamp}`;
    const hmac = crypto.createHmac("sha256", apiKey);
    hmac.update(payload);
    return hmac.digest("hex");
  }

  /**
   * Build headers with iFlow-specific signature
   * @param {object} credentials - Provider credentials
   * @param {boolean} stream - Whether streaming is enabled
   * @returns {object} Headers object
   */
  buildHeaders(credentials: ExecutorCredentials, stream: boolean = true): ExecutorHeaders {
    // Generate session ID and timestamp
    const sessionID = `session-${this.generateUUID()}`;
    const timestamp = Date.now();

    // Get user agent from config
    const userAgent = this.config.headers["User-Agent"] || "iFlow-Cli";

    // Get API key (prefer apiKey, fallback to accessToken)
    const apiKey = credentials.apiKey || credentials.accessToken || "";

    // Create signature
    const signature = this.createIFlowSignature(userAgent, sessionID, timestamp, apiKey);

    // Build headers
    const headers: ExecutorHeaders = {
      "Content-Type": "application/json",
      ...this.config.headers,
      "session-id": sessionID,
      "x-iflow-timestamp": timestamp.toString(),
      "x-iflow-signature": signature,
    };

    // Add authorization
    if (credentials.apiKey) {
      headers["Authorization"] = `Bearer ${credentials.apiKey}`;
    }

    // Add streaming header
    if (stream) {
      headers["Accept"] = "text/event-stream";
    }

    return headers;
  }

  /**
   * Build URL for iFlow API
   * @param {string} model - Model name
   * @param {boolean} stream - Whether streaming is enabled
   * @param {number} urlIndex - URL index for fallback
   * @param {object} credentials - Provider credentials
   * @returns {string} API URL
   */
  buildUrl(
    _model: string,
    _stream: boolean,
    _urlIndex: number = 0,
    _credentials: ExecutorCredentials | null = null,
  ): string {
    return this.config.baseUrl!;
  }

  /**
   * Transform request body - inject stream_options for usage data
   * @param {string} model - Model name
   * @param {object} body - Request body
   * @param {boolean} stream - Whether streaming is enabled
   * @param {object} credentials - Provider credentials
   * @returns {object} Transformed body
   */
  transformRequest(
    model: string,
    body: unknown,
    stream: boolean,
    _credentials: ExecutorCredentials,
  ): unknown {
    void model;
    const record = body as Record<string, unknown>;
    // Inject stream_options for streaming requests to get usage data
    if (stream && record.messages && !record.stream_options) {
      record.stream_options = { include_usage: true };
    }
    return record;
  }
}

export default IFlowExecutor;
