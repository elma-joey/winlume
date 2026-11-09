import { consoleError, consoleJson } from "@/lib/console/server";
import { readDesktopBilling } from "@/lib/platform/desktop-billing";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try { return consoleJson(await readDesktopBilling(request)); } catch (error) { return consoleError(error); }
}
