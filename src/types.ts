export interface User {
  id: string;
  email?: string | null;
  name?: string | null;
}

export interface AdminUser extends User {
  created_at: string;
  plan: 'none' | 'builder' | 'pro' | 'scale';
}

export function isAdminUser(value: unknown): value is AdminUser {
  return typeof value === 'object' && value !== null
    && 'id' in value && typeof value.id === 'string'
    && 'created_at' in value && typeof value.created_at === 'string'
    && 'plan' in value && (value.plan === 'none' || value.plan === 'builder' || value.plan === 'pro' || value.plan === 'scale')
    && (!('name' in value) || value.name === null || typeof value.name === 'string')
    && (!('email' in value) || value.email === null || typeof value.email === 'string');
}

export interface AdminUserWithBalance extends AdminUser {
  balanceCents: number | null;
}

export function isAdminUserWithBalance(value: unknown): value is AdminUserWithBalance {
  return isAdminUser(value) && 'balanceCents' in value
    && (value.balanceCents === null || (typeof value.balanceCents === 'number' && Number.isSafeInteger(value.balanceCents)));
}

export interface AuthSession {
  user: User;
}
