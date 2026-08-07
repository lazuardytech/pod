import crypto from "node:crypto";
import { PROVIDERS } from "../config/providers.js";
import { BaseExecutor } from "./base.js";

/**
 * IFlowExecutor - Executor for iFlow API with HMAC-SHA256 signature
 */
export class IFlowExecutor extends BaseExecutor {
  constructor() {
    super("iflow", PROVIDERS.iflow);
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
  createIFlowSignature(userAgent: any, sessionID: any, timestamp: any, apiKey: any) {
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
  buildHeaders(credentials: any, stream: any = true) {
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
    const headers: Record<string, string> = {
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
  buildUrl(_model: any, _stream: any, _urlIndex: any = 0, _credentials: any = null) {
    return this.config.baseUrl;
  }

  /**
   * Transform request body - inject stream_options for usage data
   * @param {string} model - Model name
   * @param {object} body - Request body
   * @param {boolean} stream - Whether streaming is enabled
   * @param {object} credentials - Provider credentials
   * @returns {object} Transformed body
   */
  transformRequest(model: any, body: any, stream: any, _credentials: any) {
    // Inject stream_options for streaming requests to get usage data
    if (stream && body.messages && !body.stream_options) {
      body.stream_options = { include_usage: true };
    }
    return body;
  }
}

export default IFlowExecutor;
