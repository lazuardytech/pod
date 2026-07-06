import path from "node:path";
import fs from "fs";
import { NextResponse } from "next/server";
import { asString } from "@/app/api/_types";
import { parseJsonBody } from "@/lib/parseJsonBody";
import { sanitizeError } from "@/lib/sanitizeError";
export async function POST(request: any) {
  try {
    const [rawBody, _parseErr] = await parseJsonBody(request);
    if (_parseErr) return _parseErr;
    const body = rawBody as Record<string, unknown>;
    const file = asString(body.file);
    const content = body.content;

    if (!file || content === undefined) {
      return NextResponse.json(
        { success: false, error: "File and content required" },
        { status: 400 },
      );
    }

    // Security: only allow specific filenames
    const allowedFiles = [
      "1_req_client.json",
      "2_req_source.json",
      "3_req_openai.json",
      "4_req_target.json",
      "5_res_provider.txt",
      "6_res_openai.txt",
      "7_res_client.txt",
      "7_res_client.json",
    ];

    if (!allowedFiles.includes(file)) {
      return NextResponse.json({ success: false, error: "Invalid file name" }, { status: 400 });
    }

    const logsDir = path.join(process.cwd(), "logs", "translator");

    // Create directory if not exists
    if (!fs.existsSync(logsDir)) {
      fs.mkdirSync(logsDir, { recursive: true });
    }

    const filePath = path.join(logsDir, file);
    fs.writeFileSync(
      filePath,
      typeof content === "string" ? content : JSON.stringify(content),
      "utf-8",
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error saving file:", error);
    return NextResponse.json({ success: false, error: sanitizeError(error) }, { status: 500 });
  }
}
