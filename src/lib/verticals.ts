/**
 * SalonPro is built for salons only. A "business type" is just the kind of salon (used for wording and AI context).
 * Core modules (appointments, services, staff) are always on; the owner can switch the optional ones in Settings.
 */
export const MODULES = ["appointments", "services", "staff", "inventory", "purchases", "expenses"] as const;
export type Module = (typeof MODULES)[number];
export const CORE_MODULES: Module[] = ["appointments", "services", "staff"];
export const OPTIONAL_MODULES = MODULES.filter((m) => !CORE_MODULES.includes(m));

export const MODULE_INFO: Record<Module, { label: string; desc: string }> = {
  appointments: { label: "Appointments & calendar", desc: "Bookings with stylists, conflict checking and a calendar." },
  services: { label: "Services catalog", desc: "Haircuts, coloring, facials, bridal packages and more." },
  staff: { label: "Stylists, schedules & commission", desc: "Team profiles, working hours, time off and commission." },
  inventory: { label: "Salon products & stock", desc: "Retail and back-bar products, stock levels, movements and low-stock alerts." },
  purchases: { label: "Suppliers & purchases", desc: "Suppliers and purchase orders that receive stock." },
  expenses: { label: "Expenses", desc: "Track salon costs: rent, utilities, supplies, salaries." },
};

export type Labels = {
  staff: string; staffOne: string; service: string; services: string; customer: string; customers: string;
  appointment: string; appointments: string; product: string; products: string; posNote: string;
};
const LABELS: Labels = {
  staff: "Stylists", staffOne: "stylist", service: "Service", services: "Services", customer: "Customer", customers: "Customers",
  appointment: "Appointment", appointments: "Appointments", product: "Product", products: "Products", posNote: "Payment notes (optional)",
};

type SalonType = { label: string; hint: string };
/** The only salon types offered when creating a salon. */
export const SALON_TYPES: Record<string, SalonType> = {
  mens_salon: { label: "Men's salon", hint: "Haircuts, beard grooming, shaves, facials for men." },
  womens_salon: { label: "Women's salon", hint: "Hair, beauty, makeup, nails and skin care for women." },
  unisex_salon: { label: "Unisex salon", hint: "Hair and beauty services for everyone." },
};
/** Older salons created before the three-type list keep working; these are never offered for new salons. */
const LEGACY_LABELS: Record<string, string> = {
  hair_salon: "Hair salon", beauty_salon: "Beauty salon", barbershop: "Barbershop", spa: "Spa", nail_studio: "Nail studio", makeup_studio: "Makeup studio", hair_clinic: "Hair clinic",
};
/** Kept for the admin screens and tests: the same list under its old name. */
export const VERTICALS = SALON_TYPES;
export const DEFAULT_TYPE = "unisex_salon";
export const BUSINESS_TYPE_ORDER = Object.keys(SALON_TYPES);
export const BUSINESS_TYPE_OPTIONS: [string, string][] = BUSINESS_TYPE_ORDER.map((k) => [k, SALON_TYPES[k].label]);

export const verticalOf = (type: string) => SALON_TYPES[type] ?? { label: LEGACY_LABELS[type] ?? SALON_TYPES[DEFAULT_TYPE].label, hint: SALON_TYPES[DEFAULT_TYPE].hint };
export const presetModules = (): Module[] => [...MODULES];

type T = { modules: string[] | null };
export const modulesOf = (t: T): Set<string> => new Set([...CORE_MODULES, ...(t.modules ?? presetModules())]);
export const hasModule = (t: T, m: Module) => modulesOf(t).has(m);
export const labelsOf = (): Labels => LABELS;
