import { headers } from "next/headers";
import { NextResponse } from "next/server";

export async function POST() {
  const secret = process.env.SHUTDOWN_SECRET;
  const authorization = headers().get("authorization");

  if (!secret || authorization !== `Bearer ${secret}`) {
    return NextResponse.json({ success: false, message: "Unauthorized" }, { status: 401 });
  }

  const response = NextResponse.json({ success: true, message: "Restarting..." });

  setTimeout(() => {
    process.exit(1);
  }, 500);

  return response;
}
