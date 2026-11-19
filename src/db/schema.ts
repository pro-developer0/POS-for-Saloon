import {
  pgTable, uuid, text, timestamp, numeric, integer, boolean, jsonb, index, uniqueIndex, date,
} from "drizzle-orm/pg-core";

const id = () => uuid("id").primaryKey().defaultRandom();
const money = (name: string) => numeric(name, { precision: 12, scale: 2 }).notNull().default("0");
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const tenantId = () => uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" });
const tstz = (n: string) => timestamp(n, { withTimezone: true });

export type DayHours = { open: string; close: string } | null; // "HH:MM" in tenant tz; null = closed
export type WeekHours = Record<"0" | "1" | "2" | "3" | "4" | "5" | "6", DayHours>; // 0 = Sunday

// ---------- Platform / identity ----------
export const users = pgTable("users", {
  id: id(),
  email: text("email").notNull(),
  name: text("name").notNull(),
  passwordHash: text("password_hash").notNull(),
  isPlatformAdmin: boolean("is_platform_admin").notNull().default(false),
  disabled: boolean("disabled").notNull().default(false),
  failedLogins: integer("failed_logins").notNull().default(0),
  lockedUntil: tstz("locked_until"),
  emailVerifiedAt: tstz("email_verified_at"),
  tokensValidAfter: tstz("tokens_valid_after"), // sessions issued before this instant are rejected (set on password reset)
  createdAt: createdAt(),
}, (t) => [uniqueIndex("users_email_uq").on(t.email)]);

// One-time tokens for password reset / email verification. Only the SHA-256 hash is stored.
export const authTokens = pgTable("auth_tokens", {
  id: id(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(), // reset | verify
  tokenHash: text("token_hash").notNull(),
  expiresAt: tstz("expires_at").notNull(),
  usedAt: tstz("used_at"),
  createdAt: createdAt(),
}, (t) => [uniqueIndex("auth_tokens_hash_uq").on(t.tokenHash), index("auth_tokens_user").on(t.userId, t.kind)]);

// A tenant == a business workspace (Business + BusinessSettings + BusinessBranding in one row).
export const tenants = pgTable("tenants", {
  id: id(),
  name: text("name").notNull(),
  slug: text("slug").notNull(),
  businessType: text("business_type").notNull().default("hair_salon"),
  status: text("status").notNull().default("active"), // active | suspended (set by the platform admin)
  plan: text("plan").notNull().default("trial"),
  trialEndsAt: tstz("trial_ends_at"),
  isDemo: boolean("is_demo").notNull().default(false),
  onboarded: boolean("onboarded").notNull().default(false),
  // branding
  logoUrl: text("logo_url"),
  faviconUrl: text("favicon_url"),
  brandColor: text("brand_color").notNull().default("#7c3aed"),
  secondaryColor: text("secondary_color").notNull().default("#0f172a"),
  accentColor: text("accent_color").notNull().default("#f59e0b"),
  // locale
  country: text("country").notNull().default("US"),
  currency: text("currency").notNull().default("USD"),
  timezone: text("timezone").notNull().default("UTC"),
  language: text("language").notNull().default("en"),
  dateFormat: text("date_format").notNull().default("MMM d, yyyy"),
  timeFormat: text("time_format").notNull().default("12h"),
  // contact
  address: text("address"), phone: text("phone"), email: text("email"), website: text("website"),
  social: jsonb("social").$type<Record<string, string>>().notNull().default({}),
  // tax
  taxName: text("tax_name").notNull().default("Tax"),
  taxRate: numeric("tax_rate", { precision: 5, scale: 2 }).notNull().default("0"),
  // appointments / ops
  hours: jsonb("hours").$type<WeekHours>().notNull(),
  slotMinutes: integer("slot_minutes").notNull().default(15),
  bufferMinutes: integer("buffer_minutes").notNull().default(0),
  paymentMethods: jsonb("payment_methods").$type<string[]>().notNull().default(["cash", "card"]),
  invoicePrefix: text("invoice_prefix").notNull().default("INV"),
  invoiceCounter: integer("invoice_counter").notNull().default(0),
  invoiceFooter: text("invoice_footer"),
  lowStockDefault: integer("low_stock_default").notNull().default(5),
  loyaltyPointsPerUnit: integer("loyalty_points_per_unit").notNull().default(1), // points per 10 currency units
  // Enabled feature modules. null = use the business type preset (see src/lib/verticals.ts)
  modules: jsonb("modules").$type<string[] | null>(),
  aiEnabled: boolean("ai_enabled").notNull().default(true),
  aiDailyLimit: integer("ai_daily_limit").notNull().default(30),
  createdAt: createdAt(),
}, (t) => [uniqueIndex("tenants_slug_uq").on(t.slug)]);

export const memberships = pgTable("memberships", {
  id: id(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  tenantId: tenantId(),
  role: text("role").notNull().default("staff"), // owner|manager|receptionist|cashier|staff
  permissions: jsonb("permissions").$type<string[] | null>(), // optional override of role defaults
  active: boolean("active").notNull().default(true),
  createdAt: createdAt(),
}, (t) => [uniqueIndex("memberships_uq").on(t.userId, t.tenantId), index("memberships_tenant").on(t.tenantId)]);

// ---------- CRM ----------
export const customers = pgTable("customers", {
  id: id(), tenantId: tenantId(),
  name: text("name").notNull(),
  phone: text("phone"), email: text("email"),
  birthday: date("birthday"), address: text("address"), notes: text("notes"),
  tags: jsonb("tags").$type<string[]>().notNull().default([]),
  preferences: text("preferences"),
  loyaltyPoints: integer("loyalty_points").notNull().default(0),
  marketingConsent: boolean("marketing_consent").notNull().default(false),
  archived: boolean("archived").notNull().default(false),
  createdAt: createdAt(),
}, (t) => [index("customers_tenant").on(t.tenantId, t.name)]);

// ---------- Catalog ----------
export const serviceCategories = pgTable("service_categories", {
  id: id(), tenantId: tenantId(), name: text("name").notNull(), sort: integer("sort").notNull().default(0),
});

export const services = pgTable("services", {
  id: id(), tenantId: tenantId(),
  categoryId: uuid("category_id").references(() => serviceCategories.id, { onDelete: "set null" }),
  name: text("name").notNull(), description: text("description"),
  durationMinutes: integer("duration_minutes").notNull(),
  price: money("price"),
  taxable: boolean("taxable").notNull().default(true),
  commissionPct: numeric("commission_pct", { precision: 5, scale: 2 }).notNull().default("0"),
  bookable: boolean("bookable").notNull().default(true),
  imageUrl: text("image_url"),
  active: boolean("active").notNull().default(true),
  archived: boolean("archived").notNull().default(false),
  sort: integer("sort").notNull().default(0),
  createdAt: createdAt(),
}, (t) => [index("services_tenant").on(t.tenantId)]);

// ---------- Staff ----------
export const staff = pgTable("staff", {
  id: id(), tenantId: tenantId(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
  name: text("name").notNull(), phone: text("phone"), email: text("email"),
  jobTitle: text("job_title"), photoUrl: text("photo_url"),
  color: text("color").notNull().default("#7c3aed"),
  schedule: jsonb("schedule").$type<WeekHours>().notNull(), // weekly availability, tenant tz
  breaks: jsonb("breaks").$type<{ start: string; end: string }[]>().notNull().default([]),
  commissionPct: numeric("commission_pct", { precision: 5, scale: 2 }).notNull().default("0"),
  salary: numeric("salary", { precision: 12, scale: 2 }), // sensitive: staff.salary permission
  active: boolean("active").notNull().default(true),
  createdAt: createdAt(),
}, (t) => [index("staff_tenant").on(t.tenantId)]);

export const staffServices = pgTable("staff_services", {
  staffId: uuid("staff_id").notNull().references(() => staff.id, { onDelete: "cascade" }),
  serviceId: uuid("service_id").notNull().references(() => services.id, { onDelete: "cascade" }),
  tenantId: tenantId(),
}, (t) => [uniqueIndex("staff_services_uq").on(t.staffId, t.serviceId)]);

export const staffTimeOff = pgTable("staff_time_off", {
  id: id(), tenantId: tenantId(),
  staffId: uuid("staff_id").notNull().references(() => staff.id, { onDelete: "cascade" }),
  startsAt: tstz("starts_at").notNull(), endsAt: tstz("ends_at").notNull(), reason: text("reason"),
});

// ---------- Appointments ----------
export const appointments = pgTable("appointments", {
  id: id(), tenantId: tenantId(),
  customerId: uuid("customer_id").notNull().references(() => customers.id),
  serviceId: uuid("service_id").notNull().references(() => services.id),
  staffId: uuid("staff_id").notNull().references(() => staff.id),
  startsAt: tstz("starts_at").notNull(), endsAt: tstz("ends_at").notNull(),
  durationMinutes: integer("duration_minutes").notNull(),
  price: money("price"), discount: money("discount"),
  status: text("status").notNull().default("pending"),
  source: text("source").notNull().default("staff"),
  notes: text("notes"),
  transactionId: uuid("transaction_id"),
  createdBy: uuid("created_by"),
  createdAt: createdAt(),
}, (t) => [index("appt_tenant_time").on(t.tenantId, t.startsAt), index("appt_staff_time").on(t.staffId, t.startsAt)]);

// ---------- Inventory ----------
export const suppliers = pgTable("suppliers", {
  id: id(), tenantId: tenantId(), name: text("name").notNull(),
  contactName: text("contact_name"), phone: text("phone"), email: text("email"), address: text("address"), notes: text("notes"),
  archived: boolean("archived").notNull().default(false), createdAt: createdAt(),
});

export const products = pgTable("products", {
  id: id(), tenantId: tenantId(),
  name: text("name").notNull(), sku: text("sku"), barcode: text("barcode"), category: text("category"),
  description: text("description"), imageUrl: text("image_url"),
  costPrice: money("cost_price"), sellPrice: money("sell_price"),
  quantity: integer("quantity").notNull().default(0),
  minStock: integer("min_stock").notNull().default(5),
  supplierId: uuid("supplier_id").references(() => suppliers.id, { onDelete: "set null" }),
  taxable: boolean("taxable").notNull().default(true),
  // pharmacy / pack selling. Stock quantity is ALWAYS counted in base units (e.g. tablets).
  genericName: text("generic_name"), strength: text("strength"), dosageForm: text("dosage_form"),
  unitLabel: text("unit_label").notNull().default("unit"), packLabel: text("pack_label"),
  unitsPerPack: integer("units_per_pack").notNull().default(1),
  packPrice: numeric("pack_price", { precision: 12, scale: 2 }), // null => sellPrice * unitsPerPack
  trackStock: boolean("track_stock").notNull().default(true), // false for menu items / non-stocked goods
  active: boolean("active").notNull().default(true),
  createdAt: createdAt(),
}, (t) => [index("products_tenant").on(t.tenantId), uniqueIndex("products_sku_uq").on(t.tenantId, t.sku)]);

export const inventoryMovements = pgTable("inventory_movements", {
  id: id(), tenantId: tenantId(),
  productId: uuid("product_id").notNull().references(() => products.id),
  delta: integer("delta").notNull(),
  balanceAfter: integer("balance_after").notNull(),
  reason: text("reason").notNull(), // sale | purchase | adjustment | initial | return
  refType: text("ref_type"), refId: uuid("ref_id"), note: text("note"), batchId: uuid("batch_id"),
  userId: uuid("user_id"), createdAt: createdAt(),
}, (t) => [index("invmov_product").on(t.productId, t.createdAt)]);

// Batches (pharmacy): products.quantity always equals the sum of its batch quantities when batches exist.
export const productBatches = pgTable("product_batches", {
  id: id(), tenantId: tenantId(),
  productId: uuid("product_id").notNull().references(() => products.id, { onDelete: "cascade" }),
  batchNo: text("batch_no").notNull(), expiryDate: date("expiry_date").notNull(),
  quantity: integer("quantity").notNull().default(0), // remaining base units
  costPrice: numeric("cost_price", { precision: 12, scale: 2 }),
  createdAt: createdAt(),
}, (t) => [index("batches_product_expiry").on(t.productId, t.expiryDate), index("batches_tenant_expiry").on(t.tenantId, t.expiryDate), uniqueIndex("batches_uq").on(t.productId, t.batchNo, t.expiryDate)]);

export const purchases = pgTable("purchases", {
  id: id(), tenantId: tenantId(),
  supplierId: uuid("supplier_id").references(() => suppliers.id),
  reference: text("reference"), status: text("status").notNull().default("ordered"), // ordered|received|cancelled
  total: money("total"), notes: text("notes"),
  orderedAt: createdAt(), receivedAt: tstz("received_at"),
});

export const purchaseItems = pgTable("purchase_items", {
  id: id(), tenantId: tenantId(),
  purchaseId: uuid("purchase_id").notNull().references(() => purchases.id, { onDelete: "cascade" }),
  productId: uuid("product_id").notNull().references(() => products.id),
  quantity: integer("quantity").notNull(), unitCost: money("unit_cost"),
  batchNo: text("batch_no"), expiryDate: date("expiry_date"), // required when the business uses batches
  unitsPerLine: integer("units_per_line").notNull().default(1), // base units per ordered unit (e.g. 10 tablets per strip); stock added = quantity x unitsPerLine
});

// ---------- Expenses ----------
export const expenses = pgTable("expenses", {
  id: id(), tenantId: tenantId(),
  name: text("name").notNull(), category: text("category").notNull().default("General"),
  amount: money("amount"), spentOn: date("spent_on").notNull(),
  paymentMethod: text("payment_method").notNull().default("cash"),
  supplierId: uuid("supplier_id").references(() => suppliers.id, { onDelete: "set null" }),
  description: text("description"), receiptUrl: text("receipt_url"),
  createdAt: createdAt(),
}, (t) => [index("expenses_tenant_date").on(t.tenantId, t.spentOn)]);

// ---------- Sales ----------
export const transactions = pgTable("transactions", {
  id: id(), tenantId: tenantId(),
  customerId: uuid("customer_id").references(() => customers.id),
  staffId: uuid("staff_id").references(() => staff.id),
  idempotencyKey: text("idempotency_key"),
  subtotal: money("subtotal"), discount: money("discount"), tax: money("tax"), total: money("total"),
  paid: money("paid"),
  status: text("status").notNull().default("unpaid"), // draft|unpaid|partial|paid|cancelled
  notes: text("notes"), couponCode: text("coupon_code"),
  createdBy: uuid("created_by"), createdAt: createdAt(),
}, (t) => [index("tx_tenant_time").on(t.tenantId, t.createdAt), uniqueIndex("tx_idem_uq").on(t.tenantId, t.idempotencyKey)]);

export const transactionItems = pgTable("transaction_items", {
  id: id(), tenantId: tenantId(),
  transactionId: uuid("transaction_id").notNull().references(() => transactions.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(), // service | product
  serviceId: uuid("service_id").references(() => services.id), productId: uuid("product_id").references(() => products.id),
  staffId: uuid("staff_id").references(() => staff.id),
  name: text("name").notNull(),
  quantity: integer("quantity").notNull(), unitPrice: money("unit_price"),
  stockUnits: integer("stock_units").notNull().default(0), // base units taken from stock (quantity x pack size)
  discount: money("discount"), tax: money("tax"), lineTotal: money("line_total"),
});

// Which batches a sale line was taken from (so a void returns stock to the right batch).
export const transactionItemBatches = pgTable("transaction_item_batches", {
  id: id(), tenantId: tenantId(),
  itemId: uuid("item_id").notNull().references(() => transactionItems.id, { onDelete: "cascade" }),
  batchId: uuid("batch_id").notNull(), quantity: integer("quantity").notNull(),
});

export const payments = pgTable("payments", {
  id: id(), tenantId: tenantId(),
  transactionId: uuid("transaction_id").notNull().references(() => transactions.id),
  method: text("method").notNull(), amount: money("amount"), note: text("note"),
  createdBy: uuid("created_by"), createdAt: createdAt(),
});

export const invoices = pgTable("invoices", {
  id: id(), tenantId: tenantId(),
  transactionId: uuid("transaction_id").notNull().references(() => transactions.id),
  number: text("number").notNull(), dueDate: date("due_date"),
  cancelled: boolean("cancelled").notNull().default(false),
  createdAt: createdAt(),
}, (t) => [uniqueIndex("invoices_number_uq").on(t.tenantId, t.number)]);

export const commissions = pgTable("commissions", {
  id: id(), tenantId: tenantId(),
  staffId: uuid("staff_id").notNull().references(() => staff.id),
  transactionId: uuid("transaction_id").notNull().references(() => transactions.id),
  amount: money("amount"), createdAt: createdAt(),
});

// ---------- Notifications / audit ----------
export const notifications = pgTable("notifications", {
  id: id(), tenantId: tenantId(), userId: uuid("user_id"), // null = all members
  kind: text("kind").notNull(), title: text("title").notNull(), body: text("body"), link: text("link"),
  read: boolean("read").notNull().default(false), dedupeKey: text("dedupe_key"),
  createdAt: createdAt(),
}, (t) => [index("notif_tenant").on(t.tenantId, t.createdAt), uniqueIndex("notif_dedupe").on(t.tenantId, t.dedupeKey)]);

export const auditLogs = pgTable("audit_logs", {
  id: id(), tenantId: uuid("tenant_id"), userId: uuid("user_id"),
  action: text("action").notNull(), entity: text("entity"), entityId: text("entity_id"),
  detail: jsonb("detail"), createdAt: createdAt(),
}, (t) => [index("audit_tenant").on(t.tenantId, t.createdAt)]);

// ---------- AI ----------
export const aiConversations = pgTable("ai_conversations", {
  id: id(), tenantId: tenantId(), userId: uuid("user_id").notNull(),
  title: text("title").notNull().default("New conversation"), createdAt: createdAt(), updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("aiconv_tenant_user").on(t.tenantId, t.userId)]);

export const aiMessages = pgTable("ai_messages", {
  id: id(), tenantId: tenantId(),
  conversationId: uuid("conversation_id").notNull().references(() => aiConversations.id, { onDelete: "cascade" }),
  role: text("role").notNull(), content: text("content").notNull(),
  meta: jsonb("meta"), feedback: text("feedback"), createdAt: createdAt(),
});

export const aiUsage = pgTable("ai_usage", {
  id: id(), tenantId: uuid("tenant_id"), userId: uuid("user_id"),
  feature: text("feature").notNull(), provider: text("provider").notNull(), model: text("model"),
  status: text("status").notNull(), tokens: integer("tokens"), error: text("error"), createdAt: createdAt(),
}, (t) => [index("aiusage_tenant_time").on(t.tenantId, t.createdAt)]);

export const aiSavedContent = pgTable("ai_saved_content", {
  id: id(), tenantId: tenantId(), userId: uuid("user_id"),
  kind: text("kind").notNull(), title: text("title").notNull(), content: text("content").notNull(), createdAt: createdAt(),
});

// Platform-level key/value (AI provider config etc). Secrets are NEVER stored here — env only.
export const platformSettings = pgTable("platform_settings", {
  key: text("key").primaryKey(), value: jsonb("value").notNull(),
});
