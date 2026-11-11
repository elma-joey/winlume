import { NextResponse } from "next/server";
import { getAuthMode } from "@/lib/platform/auth";
import { isGitHubOAuthConfigured, isGoogleOAuthConfigured } from "@/lib/platform/social-oauth";

function legacyGatewayUrl(): string | undefined {
  const configured = process.env.NEW_API_URL?.trim();
  return configured ? configured.replace(/\/+$/, "") : undefined;
}

export async function GET() {
  if (getAuthMode() !== "legacy") {
    return NextResponse.json({
      success: true,
      data: {
        allowance_per_cny: 300,
        quota_per_unit: 1_000_000,
        quota_display_type: "custom",
        display_in_currency: false,
        custom_currency_symbol: "credits",
        custom_currency_exchange_rate: 1,
        usd_exchange_rate: 1,
        google_oauth_enabled: isGoogleOAuthConfigured(),
        github_oauth_enabled: isGitHubOAuthConfigured(),
      },
    }, { headers: { "cache-control": "no-store" } });
  }
  const gatewayUrl = legacyGatewayUrl();
  if (!gatewayUrl) {
    return NextResponse.json({ success: false, message: "旧余额配置未配置。" }, { status: 503 });
  }
  try {
    const upstream = await fetch(`${gatewayUrl}/api/status`, { cache: "no-store" });
    const payload = await upstream.json() as { success?: boolean; data?: Record<string, unknown> };
    const data = payload.data ?? {};
    return NextResponse.json({
      success: Boolean(payload.success),
      data: {
        quota_per_unit: data.quota_per_unit,
        quota_display_type: data.quota_display_type,
        display_in_currency: data.display_in_currency,
        custom_currency_symbol: data.custom_currency_symbol,
        custom_currency_exchange_rate: data.custom_currency_exchange_rate,
        usd_exchange_rate: data.usd_exchange_rate,
      },
    });
  } catch {
    return NextResponse.json({ success: false, message: "余额配置暂时不可访问。" }, { status: 502 });
  }
}
