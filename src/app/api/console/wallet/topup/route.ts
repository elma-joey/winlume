import { membership } from "@/lib/console/plan-purchases";
import {
  ConsoleRequestError,
  consoleError,
  consoleJson,
  requireConsoleContext,
} from "@/lib/console/server";
import { requireConsoleOrganization } from "@/lib/console/workspace";
import {
  createConsoleTopupOrder,
  getConsolePaymentOrder,
  getConsoleTopupConfig,
  listConsolePaymentOrders,
} from "@/lib/console/topup";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function resolveOrganizationId(
  context: Awaited<ReturnType<typeof requireConsoleContext>>,
  requested: string | null,
): Promise<string | null> {
  if (requested) return requested;
  const user = await context.repositories.users.findById(context.userId);
  return user?.currentOrganizationId ?? null;
}

export async function GET(request: Request) {
  try {
    const context = await requireConsoleContext();
    const url = new URL(request.url);
    const organizationId = await resolveOrganizationId(
      context,
      url.searchParams.get("organizationId"),
    );
    const orderRef = url.searchParams.get("order");

    let orders: Awaited<ReturnType<typeof listConsolePaymentOrders>> = [];
    let order: Awaited<ReturnType<typeof getConsolePaymentOrder>> = null;
    if (organizationId) {
      // Enforces that the caller is a member of this workspace.
      await requireConsoleOrganization(context, organizationId);
      [orders, order] = await Promise.all([
        listConsolePaymentOrders(organizationId),
        orderRef ? getConsolePaymentOrder(organizationId, orderRef) : Promise.resolve(null),
      ]);
    }

    return consoleJson({
      organizationId,
      config: { ...getConsoleTopupConfig(), topupDiscount: organizationId ? (await membership(context,organizationId))?.discount ?? 1 : 1 },
      orders,
      order,
    });
  } catch (error) {
    return consoleError(error);
  }
}

export async function POST(request: Request) {
  try {
    const context = await requireConsoleContext();
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new ConsoleRequestError("请求内容无效。", 400, "invalid_request");
    }

    const organizationId = await resolveOrganizationId(
      context,
      typeof body.organizationId === "string" && body.organizationId.trim()
        ? body.organizationId.trim()
        : null,
    );
    if (!organizationId) {
      throw new ConsoleRequestError("请选择一个工作区。", 400, "organization_id_required");
    }

    const result = await createConsoleTopupOrder(context, {
      organizationId,
      amount: Number(body.amount),
      paymentMethod: typeof body.paymentMethod === "string" ? body.paymentMethod : "",
      userAgent: request.headers.get("user-agent"),
      expectedPayMoney: typeof body.expectedPayMoney === "string" ? body.expectedPayMoney : undefined,
    });

    return consoleJson(result, { status: 201 });
  } catch (error) {
    return consoleError(error);
  }
}
