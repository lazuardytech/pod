import { NextResponse } from "next/server";
import { asString } from "@/app/api/_types";
import { getDisabledModels } from "@/lib/disabledModelsDb";
import { parseJsonBody } from "@/lib/parseJsonBody";
import { getModelAliases, setModelAlias } from "@/models";
import { AI_MODELS } from "@/shared/constants/config";
import { getProviderAlias } from "@/shared/constants/providers";

// GET /api/models - Get models with aliases
export async function GET() {
  try {
    const modelAliases = await getModelAliases();
    const disabled = await getDisabledModels();

    const models = AI_MODELS.filter((m) => {
      const alias = getProviderAlias(m.provider) || m.provider;
      const list = disabled[alias] || disabled[m.provider] || [];
      return !list.includes(m.model);
    }).map((m) => {
      const fullModel = `${m.provider}/${m.model}`;
      return {
        ...m,
        fullModel,
        alias: modelAliases[fullModel] || m.model,
      };
    });

    return NextResponse.json({ models });
  } catch (error) {
    console.log("Error fetching models:", error);
    return NextResponse.json({ error: "Failed to fetch models" }, { status: 500 });
  }
}

// PUT /api/models - Update model alias
export async function PUT(request: any) {
  try {
    const [rawBody, _parseErr] = await parseJsonBody(request);
    if (_parseErr) return _parseErr;
    const body = rawBody as Record<string, unknown>;
    const { model, alias } = body ?? ({} as any);

    if (!model || !alias) {
      return NextResponse.json({ error: "Model and alias required" }, { status: 400 });
    }

    const modelAliases = await getModelAliases();

    // Check if alias already exists for different model
    const existingModel = Object.entries(modelAliases).find(
      ([key, val]) => val === alias && key !== model,
    );

    if (existingModel) {
      return NextResponse.json({ error: "Alias already in use" }, { status: 400 });
    }

    // Update alias
    await setModelAlias(asString(model), asString(alias));

    return NextResponse.json({ success: true, model, alias });
  } catch (error) {
    console.log("Error updating alias:", error);
    return NextResponse.json({ error: "Failed to update alias" }, { status: 500 });
  }
}
