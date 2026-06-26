import fs from "node:fs";
import path from "node:path";
import { Low } from "lowdb";
import { JSONFile } from "lowdb/node";
import { DATA_DIR } from "@/lib/dataDir";

const DB_FILE = path.join(DATA_DIR, "disabledModels.json");

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

type DisabledModelsData = { disabled: Record<string, string[]> };

const defaultData: DisabledModelsData = { disabled: {} };

let dbInstance: Low<DisabledModelsData> | null = null;

async function getDb(): Promise<Low<DisabledModelsData>> {
  if (!dbInstance) {
    const adapter = new JSONFile<DisabledModelsData>(DB_FILE);
    dbInstance = new Low<DisabledModelsData>(adapter, defaultData);
    try {
      await dbInstance.read();
    } catch (error) {
      if (error instanceof SyntaxError) {
        dbInstance.data = { ...defaultData };
        await dbInstance.write();
      } else {
        throw error;
      }
    }
    if (!dbInstance.data || typeof dbInstance.data !== "object") dbInstance.data = { ...defaultData };
    if (!dbInstance.data.disabled) dbInstance.data.disabled = {};
  }
  return dbInstance;
}

export async function getDisabledModels(): Promise<Record<string, string[]>> {
  const db = await getDb();
  return db.data.disabled || {};
}

export async function getDisabledByProvider(providerAlias: string): Promise<string[]> {
  const all = await getDisabledModels();
  return all[providerAlias] || [];
}

export async function disableModels(providerAlias: string, ids: string[]): Promise<void> {
  if (!providerAlias || !Array.isArray(ids)) return;
  const db = await getDb();
  const current = new Set(db.data.disabled[providerAlias] || []);
  ids.forEach((id) => current.add(id));
  db.data.disabled[providerAlias] = [...current];
  await db.write();
}

export async function enableModels(providerAlias: string, ids: string[] | undefined | null): Promise<void> {
  if (!providerAlias) return;
  const db = await getDb();
  const current = db.data.disabled[providerAlias] || [];
  if (!Array.isArray(ids) || ids.length === 0) {
    delete db.data.disabled[providerAlias];
  } else {
    const removeSet = new Set(ids);
    const next = current.filter((id) => !removeSet.has(id));
    if (next.length === 0) delete db.data.disabled[providerAlias];
    else db.data.disabled[providerAlias] = next;
  }
  await db.write();
}
