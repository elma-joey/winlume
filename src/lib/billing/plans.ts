export const ALLOWANCE_PER_CNY = 300;
export const REIZO_PLANS = [
  { id: "core", name: "基础", productId: "prod_9iIn2Z2RyMTbJ4DM", price: 29, allowance: 10000, discount: 0.975 },
  { id: "plus", name: "进阶", productId: "prod_hvVVVVnK3kb1yQXC", price: 69, allowance: 25000, discount: 0.95 },
  { id: "pro", name: "专业", productId: "prod_FOV1dx3PcMIVXQUW", price: 129, allowance: 45000, discount: 0.925 },
  { id: "max", name: "旗舰", productId: "prod_T4BnkNmgi9vRPjHU", price: 229, allowance: 80000, discount: 0.9 },
] as const;
// Existing gateway quota and stored credit amounts are unchanged. Only display
// units change: one former wallet credit is 300 allowance units.
export const displayAllowance = (credits: number) => credits * ALLOWANCE_PER_CNY;
export const quotaForAllowance = (allowance: number) => Math.ceil(allowance * 500000 / ALLOWANCE_PER_CNY);
