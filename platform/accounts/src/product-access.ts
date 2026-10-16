import type { Env } from "./env.ts";

export const isOperator = (env: Env, userId: string) => Boolean(env.OPERATOR_USER_ID && env.OPERATOR_USER_ID === userId);

export async function productAllowed(env: Env, product: string, userId: string): Promise<boolean> {
  if (!env.OPERATOR_USER_ID) return false;
  if (product === "voice" && env.VOICE_BILLING_MODE !== "owner_funded") return false;
  if (isOperator(env, userId)) return Boolean(await env.DB.prepare("SELECT id FROM users WHERE id=?").bind(userId).first());
  return Boolean(await env.DB.prepare("SELECT user_id FROM product_access WHERE product=? AND user_id=?").bind(product, userId).first());
}
