/**
 * Business types ("verticals"). One codebase serves all of them: a type picks which modules are switched on
 * and which words the interface uses. A business owner can still toggle modules in Settings.
 */
export const MODULES = ["appointments", "services", "staff", "inventory", "purchases", "expenses", "batches"] as const;
export type Module = (typeof MODULES)[number];

export const MODULE_INFO: Record<Module, { label: string; desc: string }> = {
  appointments: { label: "Appointments & calendar", desc: "Bookings with staff, conflict checking and a calendar." },
  services: { label: "Services catalog", desc: "Time-based services you sell (haircut, consultation, repair…)." },
  staff: { label: "Staff, schedules & commission", desc: "Team profiles, working hours, time off and commission." },
  inventory: { label: "Inventory & products", desc: "Products, stock levels, movements and low-stock alerts." },
  purchases: { label: "Suppliers & purchases", desc: "Suppliers and purchase orders that receive stock." },
  expenses: { label: "Expenses", desc: "Track business costs." },
  batches: { label: "Batches & expiry", desc: "Batch numbers and expiry dates, soonest-expiry-first selling, expired stock blocked, expiry alerts." },
};

export type Labels = {
  staff: string; staffOne: string; service: string; services: string; customer: string; customers: string;
  appointment: string; appointments: string; product: string; products: string; posNote: string;
};
const DEFAULT_LABELS: Labels = {
  staff: "Staff", staffOne: "staff member", service: "Service", services: "Services", customer: "Customer", customers: "Customers",
  appointment: "Appointment", appointments: "Appointments", product: "Product", products: "Products", posNote: "Payment notes (optional)",
};

type Vertical = {
  label: string; group: "beauty" | "health" | "retail" | "food" | "other";
  modules: Module[]; labels?: Partial<Labels>;
  serviceCategories?: string[]; productCategories?: string[]; taxName?: string; hint: string;
};

const BEAUTY: Module[] = ["appointments", "services", "staff", "inventory", "purchases", "expenses"];
export const VERTICALS: Record<string, Vertical> = {
  pharmacy: {
    label: "Pharmacy", group: "health", hint: "Batches, expiry dates, generic names, strips and boxes.",
    modules: ["inventory", "purchases", "expenses", "batches"], taxName: "Sales tax",
    labels: { staff: "Pharmacists & staff", staffOne: "pharmacist", product: "Medicine / item", products: "Medicines & items", customers: "Patients / customers", customer: "Patient / customer", posNote: "Notes (optional)" },
    productCategories: ["Tablets", "Capsules", "Syrups", "Injections", "Ointments & creams", "Drops", "Surgical & devices", "Baby care", "Personal care", "Supplements"],
  },
  retail: {
    label: "Retail shop", group: "retail", hint: "Products, stock, barcode selling, suppliers.",
    modules: ["inventory", "purchases", "expenses"], labels: { staff: "Employees", staffOne: "employee", product: "Item", products: "Items" }, productCategories: ["General"],
  },
  grocery: {
    label: "Grocery / mini-mart", group: "retail", hint: "Fast barcode checkout, stock, suppliers.",
    modules: ["inventory", "purchases", "expenses"], labels: { staff: "Employees", staffOne: "employee", product: "Item", products: "Items" }, productCategories: ["Grocery", "Dairy", "Beverages", "Snacks", "Household"],
  },
  restaurant: {
    label: "Restaurant / café", group: "food", hint: "Menu items sold at the counter or table, expenses, optional stock.",
    modules: ["inventory", "purchases", "expenses", "staff"], labels: { staff: "Team", staffOne: "team member", product: "Menu item", products: "Menu", posNote: "Table / order note" },
    productCategories: ["Starters", "Mains", "Drinks", "Desserts"],
  },
  clinic: {
    label: "Clinic / dental", group: "health", hint: "Appointments, consultation services, billing.",
    modules: ["appointments", "services", "staff", "inventory", "expenses"],
    labels: { staff: "Doctors & staff", staffOne: "doctor", customer: "Patient", customers: "Patients", service: "Treatment", services: "Treatments & services", appointment: "Visit", appointments: "Visits" },
  },
  hair_salon: { label: "Hair salon", group: "beauty", modules: BEAUTY, hint: "Appointments, stylists, services, retail products." },
  beauty_salon: { label: "Beauty salon", group: "beauty", modules: BEAUTY, hint: "Appointments, therapists, services, retail products." },
  barbershop: { label: "Barbershop", group: "beauty", modules: BEAUTY, hint: "Appointments, barbers, services, products." },
  spa: { label: "Spa", group: "beauty", modules: BEAUTY, hint: "Appointments, therapists, treatments, products." },
  nail_studio: { label: "Nail studio", group: "beauty", modules: BEAUTY, hint: "Appointments, nail artists, services, products." },
  makeup_studio: { label: "Makeup studio", group: "beauty", modules: BEAUTY, hint: "Appointments, artists, services, products." },
  hair_clinic: { label: "Hair clinic", group: "beauty", modules: BEAUTY, hint: "Appointments, specialists, treatments, products." },
  other: { label: "Other business", group: "other", modules: ["services", "staff", "inventory", "purchases", "expenses"], hint: "Everything except appointments — switch on what you need in Settings." },
};

/** Order shown in the sign-up dropdown (pharmacy first). */
export const BUSINESS_TYPE_ORDER = ["pharmacy", "retail", "grocery", "restaurant", "clinic", "hair_salon", "beauty_salon", "barbershop", "spa", "nail_studio", "makeup_studio", "hair_clinic", "other"];
export const BUSINESS_TYPE_OPTIONS: [string, string][] = BUSINESS_TYPE_ORDER.map((k) => [k, VERTICALS[k].label]);

export const verticalOf = (type: string) => VERTICALS[type] ?? VERTICALS.other;
export const presetModules = (type: string): Module[] => verticalOf(type).modules;

type T = { businessType: string; modules: string[] | null };
export const modulesOf = (t: T): Set<string> => new Set(t.modules ?? presetModules(t.businessType));
export const hasModule = (t: T, m: Module) => modulesOf(t).has(m);
export const labelsOf = (t: { businessType: string }): Labels => ({ ...DEFAULT_LABELS, ...(verticalOf(t.businessType).labels ?? {}) });
