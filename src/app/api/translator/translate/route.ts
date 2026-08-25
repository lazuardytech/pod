import { NextResponse } from "next/server";
import type { ExecutorCredentials } from "open-sse/executors/base.ts";
import { getExecutor } from "open-sse/executors/index.ts";
import { parseModel } from "open-sse/services/model.ts";
import { detectFormat, getTargetFormat } from "open-sse/services/provider.ts";
import { FORMATS } from "open-sse/translator/formats.ts";
import { translateRequest } from "open-sse/translator/index.ts";
import { asApiRecord, asOptionalString, asString } from "@/app/api/_types";
import { getProviderConnections } from "@/lib/localDb";
import { parseJsonBody } from "@/lib/parseJsonBody";
import { sanitizeError } from "@/lib/sanitizeError";
import { checkDashboardApiAuth } from "@/lib/routeAuth";
export async function POST(request: Request) {
  const denied = await checkDashboardApiAuth(request);
  if (denied) return denied;

  try {
    const [json, _parseErr] = await parseJsonBody(request);
    if (_parseErr) return _parseErr;
    const payload = json as Record<string, unknown>;
    const step = payload.step;
    const body = payload.body;

    if (!step || !body) {
      return NextResponse.json(
        { success: false, error: "Step and body required" },
        { status: 400 },
      );
    }

    const reqBody = asApiRecord(body);

    switch (step) {
      case 1: {
        // Detect provider + formats from 1_req_client.json
        const clientBody = asApiRecord(reqBody.body || body);
        const { provider, model } = parseModel(asString(clientBody.model));
        const sourceFormat = detectFormat(clientBody);
        const targetFormat = getTargetFormat(provider ?? "");
        return NextResponse.json({
          success: true,
          result: { provider, model, sourceFormat, targetFormat },
        });
      }

      case 2: {
        // source → OpenAI intermediate (mirrors 3_req_openai.json)
        // Translate source→openai only (half of the pipeline)
        const clientBody = asApiRecord(reqBody.body || body);
        const { provider, model } = parseModel(asString(clientBody.model));
        const sourceFormat = detectFormat(clientBody);
        const stream = clientBody.stream !== false;

        // translateRequest(source, OPENAI) = only the first half
        const result = translateRequest(
          sourceFormat,
          FORMATS.OPENAI,
          model ?? "",
          clientBody,
          stream,
          undefined,
          provider,
        );
        delete result._toolNameMap;

        return NextResponse.json({ success: true, result: { body: result } });
      }

      case 3: {
        // OpenAI intermediate → target + build URL/headers (mirrors 4_req_target.json)
        const openaiBody = asApiRecord(reqBody.body || body);
        const provider = asString(reqBody.provider);
        const model = asString(reqBody.model);

        if (!provider || !model) {
          return NextResponse.json(
            { success: false, error: "provider and model required" },
            { status: 400 },
          );
        }

        const targetFormat = getTargetFormat(provider);
        const stream = openaiBody.stream !== false;

        // translateRequest(OPENAI, target) = second half of pipeline
        const translated = translateRequest(
          FORMATS.OPENAI,
          targetFormat,
          model,
          openaiBody,
          stream,
          undefined,
          provider,
        );
        delete translated._toolNameMap;

        // Build URL + headers via executor (same as chatCore → executor.execute)
        const connections = await getProviderConnections({ provider });
        const connection = connections.find((c) => c.isActive !== false);
        if (!connection) {
          return NextResponse.json(
            { success: false, error: `No active connection for provider: ${provider}` },
            { status: 400 },
          );
        }

        const credentials: ExecutorCredentials = {
          apiKey: asOptionalString(connection.apiKey),
          accessToken: asOptionalString(connection.accessToken),
          refreshToken: asOptionalString(connection.refreshToken),
          copilotToken: asOptionalString(connection.copilotToken),
          projectId: asOptionalString(connection.projectId),
          providerSpecificData:
            connection.providerSpecificData &&
            typeof connection.providerSpecificData === "object" &&
            !Array.isArray(connection.providerSpecificData)
              ? (connection.providerSpecificData as ExecutorCredentials["providerSpecificData"])
              : undefined,
        };

        const executor = getExecutor(provider);
        const url = executor.buildUrl(model, stream, 0, credentials);
        const headers = executor.buildHeaders(credentials, stream);
        const finalBody = executor.transformRequest(model, translated, stream, credentials);

        return NextResponse.json({ success: true, result: { url, headers, body: finalBody } });
      }

      default:
        return NextResponse.json({ success: false, error: "Invalid step (1-3)" }, { status: 400 });
    }
  } catch (error) {
    console.error("Error in translator:", error);
    return NextResponse.json({ success: false, error: sanitizeError(error) }, { status: 500 });
  }
}
