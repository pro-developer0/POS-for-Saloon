export const PERMISSIONS = [
  "dashboard.view", "appointments.view", "appointments.manage", "customers.view", "customers.manage",
  "services.view", "services.manage", "staff.view", "staff.manage", "staff.salary",
  "pos.use", "inventory.view", "inventory.manage", "suppliers.manage", "expenses.view", "expenses.manage",
  "invoices.view", "invoices.manage", "reports.view", "settings.manage", "ai.use", "members.manage",
  "sales.refund", "coupons.manage",
] as const;
export type Permission = (typeof PERMISSIONS)[number];
export const ROLES = ["owner", "manager", "pharmacist", "receptionist", "cashier", "staff"] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  owner: [...PERMISSIONS],
  manager: PERMISSIONS.filter((p) => p !== "members.manage" && p !== "settings.manage" && p !== "staff.salary"),
  receptionist: ["dashboard.view", "appointments.view", "appointments.manage", "customers.view", "customers.manage", "services.view", "staff.view", "inventory.view", "pos.use"],
  // dispenses, manages stock/purchases and sees reports; no settings, team or salary access
  pharmacist: ["dashboard.view", "customers.view", "customers.manage", "services.view", "inventory.view", "inventory.manage", "suppliers.manage", "pos.use", "invoices.view", "invoices.manage", "reports.view", "expenses.view", "sales.refund"],
  cashier: ["dashboard.view", "appointments.view", "customers.view", "customers.manage", "services.view", "inventory.view", "pos.use", "invoices.view", "invoices.manage"],
  staff: ["appointments.view", "customers.view", "services.view"],
};

export function permissionsFor(role: string, override?: string[] | null): Set<string> {
  if (override) return new Set(override);
  return new Set(ROLE_PERMISSIONS[role as Role] ?? []);
}
