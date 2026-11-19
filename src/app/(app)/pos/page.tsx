import { and, asc, eq } from "drizzle-orm";
import { requireCtx } from "@/server/session";
import { Pos } from "@/components/pos";
import { PageHeader } from "@/components/ui";
import { appointments, products, customers, services, staff } from "@/db/schema";

export const metadata = { title: "Point of Sale" };
export default async function Page({ searchParams }: { searchParams: Promise<{ appointment?: string }> }) {
  const ctx = await requireCtx("pos.use");
  const sp = await searchParams; const t = ctx.tenantId;
  const [svc, prod, cust, st] = await Promise.all([
    ctx.db.select().from(services).where(and(eq(services.tenantId, t), eq(services.active, true), eq(services.archived, false))).orderBy(asc(services.sort), asc(services.name)),
    ctx.db.select().from(products).where(and(eq(products.tenantId, t), eq(products.active, true))).orderBy(asc(products.name)),
    ctx.db.select({ id: customers.id, name: customers.name, phone: customers.phone }).from(customers).where(and(eq(customers.tenantId, t), eq(customers.archived, false))).orderBy(asc(customers.name)),
    ctx.db.select({ id: staff.id, name: staff.name }).from(staff).where(and(eq(staff.tenantId, t), eq(staff.active, true))).orderBy(asc(staff.name)),
  ]);
  let pre;
  if (sp.appointment && /^[0-9a-f-]{36}$/.test(sp.appointment)) {
    const [a] = await ctx.db.select().from(appointments).where(and(eq(appointments.id, sp.appointment), eq(appointments.tenantId, t)));
    if (a && !a.transactionId) pre = { appointmentId: a.id, customerId: a.customerId, staffId: a.staffId, serviceId: a.serviceId, discount: a.discount };
  }
  return (
    <div className="page-in">
      <PageHeader title="Point of Sale" desc="Sell services and products, take split payments and print receipts." />
      <Pos services={svc.map((s) => ({ id: s.id, name: s.name, price: s.price, taxable: s.taxable }))} products={prod.map((p) => ({ id: p.id, name: p.name, price: p.sellPrice, taxable: p.taxable, stock: p.quantity }))}
        customers={cust} staff={st} methods={ctx.tenant.paymentMethods} taxRate={ctx.tenant.taxRate} currency={ctx.tenant.currency} pre={pre} />
    </div>
  );
}
