import { consoleError,consoleJson,requireConsoleContext,ensureOrganizationKeyManager } from "@/lib/console/server";
import { requireConsoleOrganization } from "@/lib/console/workspace";
import { createPlanPurchase,listPlanOrders,membership,planCatalog,planCashier } from "@/lib/console/plan-purchases";
import { consumeRateLimit } from "@/lib/platform/rate-limit";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export async function GET(request:Request) {
  try {
    const context=await requireConsoleContext(),url=new URL(request.url);
    const user=await context.repositories.users.findById(context.userId), organizationId=url.searchParams.get("organizationId")||user?.currentOrganizationId;
    if (!organizationId) return consoleJson({plans:[],orders:[],membership:null,organizationId:null,canPurchase:false});
    const selected=await requireConsoleOrganization(context,organizationId);
    const reference=url.searchParams.get("order");
    if (reference) { ensureOrganizationKeyManager(selected.membership.role); return consoleJson(await planCashier(organizationId,reference)); }
    return consoleJson({organizationId,plans:await planCatalog(),orders:await listPlanOrders(organizationId),membership:await membership(context,organizationId),canPurchase:["owner","admin"].includes(selected.membership.role)});
  } catch(e) { return consoleError(e); }
}
export async function POST(request:Request) {
  try {
    const context=await requireConsoleContext();
    if (!request.headers.get("content-type")?.startsWith("application/json")) return consoleJson({error:"请使用 JSON 提交。"},{status:415});
    if (!consumeRateLimit(`plan-create:${context.userId}`,12,60000)) return consoleJson({error:"操作过于频繁。"},{status:429});
    const order=await createPlanPurchase(context,await request.json());
    return consoleJson({order});
  } catch(e) { return consoleError(e); }
}
