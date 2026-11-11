import { describe, expect, it } from "vitest";
import {
  buildEpayPurchase,
  epayDeviceFromUserAgent,
  epaySign,
  verifyEpayNotification,
} from "./epay";

// Synthetic callback fixture; merchant secrets never belong in tests.
const LIVE_KEY = "fixture-merchant-signing-key";
const LIVE_NOTIFY: Record<string, string> = {
  pid: "merch_yErcefAK2j1ytd2u",
  trade_no: "order_Qm0WUuMg2fkaxtbdhNUk",
  out_trade_no: "USR538NOv7aEB51788427570",
  type: "alipay",
  name: "TUC20",
  money: "20",
  trade_status: "TRADE_SUCCESS",
  sign: "dc4af0b7bb71e9df0d92c7a0a19b685e",
  sign_type: "MD5",
};

describe("epaySign", () => {
  it("matches a synthetic Epay signature vector", () => {
    expect(epaySign(LIVE_NOTIFY, LIVE_KEY)).toBe(LIVE_NOTIFY.sign);
  });

  it("ignores sign, sign_type and empty values, and is key-sensitive", () => {
    const a = epaySign({ b: "2", a: "1", sign: "zzz", sign_type: "MD5", empty: "" }, "k");
    const b = epaySign({ a: "1", b: "2" }, "k");
    expect(a).toBe(b);
    expect(epaySign({ a: "1" }, "k1")).not.toBe(epaySign({ a: "1" }, "k2"));
  });
});

describe("verifyEpayNotification", () => {
  it("accepts a well-signed success callback", () => {
    const result = verifyEpayNotification(LIVE_NOTIFY, LIVE_KEY);
    expect(result.verified).toBe(true);
    expect(result.outTradeNo).toBe("USR538NOv7aEB51788427570");
    expect(result.epayTradeNo).toBe("order_Qm0WUuMg2fkaxtbdhNUk");
    expect(result.tradeStatus).toBe("TRADE_SUCCESS");
    expect(result.type).toBe("alipay");
    expect(result.money).toBe("20");
  });

  it("rejects a tampered amount", () => {
    expect(verifyEpayNotification({ ...LIVE_NOTIFY, money: "2000" }, LIVE_KEY).verified).toBe(false);
  });

  it("rejects the wrong merchant key", () => {
    expect(verifyEpayNotification(LIVE_NOTIFY, "kyren_live_wrong").verified).toBe(false);
  });

  it("rejects a missing signature", () => {
    const rest: Record<string, string> = { ...LIVE_NOTIFY };
    delete rest.sign;
    expect(verifyEpayNotification(rest, LIVE_KEY).verified).toBe(false);
  });
});

describe("buildEpayPurchase", () => {
  const config = { baseUrl: "https://api.kyren.top/epay/", pid: "merch_x", key: "secret" };
  const args = {
    type: "alipay",
    outTradeNo: "RZ1788000000ab12cd34",
    name: "Reizo 充值 20 积分",
    money: "20.00",
    device: "pc" as const,
    notifyUrl: "https://reizo-ai.com/api/pay/epay/notify",
    returnUrl: "https://reizo-ai.com/account/wallet?order=RZ1788000000ab12cd34",
  };

  it("targets <baseUrl>/submit.php with a single trailing slash collapsed", () => {
    expect(buildEpayPurchase(config, args).url).toBe("https://api.kyren.top/epay/submit.php");
  });

  it("emits a self-consistent signature that verifyEpayNotification would accept", () => {
    const { params } = buildEpayPurchase(config, args);
    expect(params.sign_type).toBe("MD5");
    expect(params.sign).toBe(epaySign(params, config.key));
    expect(params.pid).toBe("merch_x");
    expect(params.out_trade_no).toBe(args.outTradeNo);
    expect(params.money).toBe("20.00");
  });
});

describe("epayDeviceFromUserAgent", () => {
  it("classifies mobile and desktop agents", () => {
    expect(epayDeviceFromUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)")).toBe("mobile");
    expect(epayDeviceFromUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64)")).toBe("pc");
    expect(epayDeviceFromUserAgent(null)).toBe("pc");
  });
});
