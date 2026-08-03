import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

const CACHE_TTL_MS = 300_000;
let cachedData: string | null = null;
let cacheExpiresAt = 0;

export async function GET() {
  if (cachedData && cacheExpiresAt > Date.now()) {
    return new NextResponse(cachedData, {
      headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=300" },
    });
  }

  try {
    const manifestPath = path.join(process.cwd(), "..", "contracts", "wasm-manifest.json");
    const data = fs.readFileSync(manifestPath, "utf-8");
    cachedData = data;
    cacheExpiresAt = Date.now() + CACHE_TTL_MS;
    return new NextResponse(data, {
      headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=300" },
    });
  } catch {
    return NextResponse.json({ error: "WASM manifest not found" }, { status: 404 });
  }
}
