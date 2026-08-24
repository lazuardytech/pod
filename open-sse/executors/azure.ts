import { DefaultExecutor } from "./default.ts";
import type { ExecutorCredentials, ExecutorHeaders } from "./base.ts";

export class AzureExecutor extends DefaultExecutor {
  constructor() {
    super("azure");
  }

  buildUrl(
    model: string,
    stream: boolean,
    urlIndex: number = 0,
    credentials: ExecutorCredentials | null = null,
  ): string {
    void stream;
    void urlIndex;
    const azureEndpoint =
      credentials?.providerSpecificData?.azureEndpoint ||
      process.env.AZURE_ENDPOINT ||
      "https://api.openai.com";

    const apiVersion =
      credentials?.providerSpecificData?.apiVersion ||
      process.env.AZURE_API_VERSION ||
      "2024-10-01-preview";

    const deployment =
      credentials?.providerSpecificData?.deployment ||
      model ||
      process.env.AZURE_DEPLOYMENT ||
      "gpt-4";

    const endpoint = azureEndpoint.replace(/\/$/, "");
    return `${endpoint}/openai/deployments/${deployment}/chat/completions?api-version=${apiVersion}`;
  }

  buildHeaders(credentials: ExecutorCredentials, stream: boolean = true): ExecutorHeaders {
    const headers: ExecutorHeaders = {
      "Content-Type": "application/json",
      ...this.config.headers,
    };

    const apiKey = credentials?.apiKey || credentials?.accessToken || process.env.OPENAI_API_KEY;

    if (apiKey) {
      headers["api-key"] = apiKey;
    }

    const organization =
      credentials?.providerSpecificData?.organization || process.env.AZURE_ORGANIZATION;

    if (organization) {
      headers["OpenAI-Organization"] = organization;
    }

    if (stream) {
      headers["Accept"] = "text/event-stream";
    }

    return headers;
  }

  transformRequest(
    model: string,
    body: unknown,
    _stream: boolean,
    _credentials: ExecutorCredentials,
  ): unknown {
    void model;
    return body;
  }
}
