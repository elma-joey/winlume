import { handleKyrenWebhook } from "@/lib/console/plan-purchases";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  try { return await handleKyrenWebhook(request); }
  catch { return new Response("Retry later", {status:503,headers:{"Cache-Control":"no-store"}}); }
}
