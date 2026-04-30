export type PlanId = "free" | "pro" | "business" | "msp";

export interface PlanInfo {
  id: PlanId;
  name: string;
  priceCents: number;
  monthlyLimit: number;
  description: string;
}

export const PLANS: Record<PlanId, PlanInfo> = {
  free: {
    id: "free",
    name: "Free",
    priceCents: 0,
    monthlyLimit: 10,
    description: "Try CallCommand with up to 10 calls per month.",
  },
  pro: {
    id: "pro",
    name: "Pro",
    priceCents: 2900,
    monthlyLimit: 100,
    description: "For solo operators and small teams.",
  },
  business: {
    id: "business",
    name: "Business",
    priceCents: 7900,
    monthlyLimit: 500,
    description: "For growing teams that depend on every call.",
  },
  msp: {
    id: "msp",
    name: "MSP",
    priceCents: 19900,
    monthlyLimit: 2000,
    description: "For agencies and managed-service providers at scale.",
  },
};

export function getPlanInfo(plan: string | null | undefined): PlanInfo {
  if (plan && plan in PLANS) return PLANS[plan as PlanId];
  return PLANS.free;
}
