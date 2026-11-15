// e2e/seed-fields-drawer.ts
// Complex-data board for e2e/table-fields-drawer.spec.ts: 6 tables / 80
// columns with a long unbroken ENUM type, multi-line, pipe/markdown, URL,
// zh-TW + emoji comments, a 28-field table with a very long name and no
// description, a composite PK+FK, and a comment-less table. Idempotent: it
// deletes its own whiteboard (cascade) before recreating it.
//
// Run under BUN (needs bun:sqlite): `bun run e2e/seed-fields-drawer.ts`
import { Database } from 'bun:sqlite'
import { IDS } from './fixtures'

const DB_PATH =
  process.env.E2E_DB_PATH ?? new URL('../data/app.db', import.meta.url).pathname
const db = new Database(DB_PATH)
db.exec('PRAGMA foreign_keys = ON')
db.exec('PRAGMA busy_timeout = 30000')
const now = Date.now()

const PROJECT = IDS.project
const WB = IDS.fdWhiteboard
db.query('DELETE FROM "Whiteboard" WHERE id = ?').run(WB)
db.query(
  'INSERT INTO "Whiteboard" (id, name, projectId, folderId, canvasState, textSource, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?)',
).run(WB, 'E2E Fields Drawer', PROJECT, null, null, null, now, now)

let seq = 0
const id = (p: string) =>
  `${p}${String(++seq).padStart(4, '0')}-0000-4000-8000-000000000000`.slice(
    0,
    36,
  )

type C = {
  name: string
  type: string
  pk?: 1
  fk?: 1
  uq?: 1
  nul?: 1
  note?: string
}
const colIds = new Map<string, string>()
function table(
  name: string,
  description: string | null,
  x: number,
  y: number,
  cols: Array<C>,
) {
  const tid = id('a000')
  db.query(
    'INSERT INTO "DiagramTable" (id, whiteboardId, name, description, positionX, positionY, width, height, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?,?,?)',
  ).run(tid, WB, name, description, x, y, 300, 40 + cols.length * 28, now, now)
  cols.forEach((c, i) => {
    const cid = id('a001')
    colIds.set(`${name}.${c.name}`, cid)
    db.query(
      'INSERT INTO "Column" (id, tableId, name, dataType, isPrimaryKey, isForeignKey, isUnique, isNullable, description, "order", createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
    ).run(
      cid,
      tid,
      c.name,
      c.type,
      c.pk ?? 0,
      c.fk ?? 0,
      c.uq ?? 0,
      c.nul ?? 0,
      c.note ?? null,
      i,
      now,
      now,
    )
  })
  return tid
}

const T: Record<string, string> = {}

T.customers = table(
  'customers',
  'People and companies that can place orders. Soft-deleted rows keep their history.',
  0,
  0,
  [
    {
      name: 'id',
      type: 'BIGINT',
      pk: 1,
      note: 'Surrogate key. Never exposed in public URLs — use `public_id`.',
    },
    {
      name: 'public_id',
      type: 'UUID',
      uq: 1,
      note: 'Opaque id used in URLs and the public API.',
    },
    {
      name: 'email',
      type: 'VARCHAR(320)',
      uq: 1,
      note: 'Login email. Stored lower-cased; uniqueness is case-insensitive (citext index).',
    },
    {
      name: 'display_name',
      type: 'VARCHAR(120)',
      note: '顯示名稱，可含中文、emoji 😀；前端最多顯示 40 字。',
    },
    {
      name: 'phone_e164',
      type: 'VARCHAR(16)',
      nul: 1,
      note: 'E.164 format, e.g. +886912345678. NULL until the customer verifies a phone.',
    },
    {
      name: 'tier',
      type: "ENUM('free','pro','enterprise')",
      note: 'Billing tier.\nfree → 3 boards\npro → unlimited boards\nenterprise → SSO + audit export',
    },
    {
      name: 'company_id',
      type: 'BIGINT',
      fk: 1,
      nul: 1,
      note: 'Owning company. NULL for individual customers.',
    },
    {
      name: 'marketing_opt_in',
      type: 'BOOLEAN',
      note: 'GDPR consent flag. Default false; only the consent form may set it to true.',
    },
    {
      name: 'metadata',
      type: 'JSONB',
      nul: 1,
      note: 'Free-form CRM fields. Shape: { "source": "ads|referral|organic", "utm": {...} }',
    },
    { name: 'created_at', type: 'TIMESTAMPTZ' },
    { name: 'updated_at', type: 'TIMESTAMPTZ' },
    {
      name: 'deleted_at',
      type: 'TIMESTAMPTZ',
      nul: 1,
      note: 'Soft delete. Rows with a value are hidden from every query except the admin audit view.',
    },
  ],
)

T.companies = table('companies', 'B2B accounts.', 0, 520, [
  { name: 'id', type: 'BIGINT', pk: 1 },
  {
    name: 'legal_name',
    type: 'VARCHAR(255)',
    note: 'Name as registered with the tax authority.',
  },
  {
    name: 'tax_id',
    type: 'VARCHAR(32)',
    uq: 1,
    nul: 1,
    note: '統一編號 (8 digits in Taiwan). Validated with the official checksum.',
  },
  { name: 'country_code', type: 'CHAR(2)', note: 'ISO 3166-1 alpha-2.' },
  { name: 'billing_email', type: 'VARCHAR(320)', nul: 1 },
  { name: 'created_at', type: 'TIMESTAMPTZ' },
])

T.orders = table(
  'customer_orders',
  'One row per checkout. Totals are denormalised from order_line_items at the moment of payment so later price changes never rewrite history.',
  520,
  0,
  [
    { name: 'id', type: 'BIGINT', pk: 1, note: 'Internal key.' },
    {
      name: 'order_number',
      type: 'VARCHAR(20)',
      uq: 1,
      note: 'Human-facing number, format `ORD-YYYYMMDD-NNNN`. Printed on invoices and shown to support.',
    },
    {
      name: 'customer_id',
      type: 'BIGINT',
      fk: 1,
      note: 'Who placed the order. ON DELETE RESTRICT — a customer with orders cannot be hard-deleted.',
    },
    {
      name: 'status',
      type: "ENUM('draft','pending','paid','shipped','delivered','cancelled','refunded')",
      note: 'Lifecycle:\ndraft → pending → paid → shipped → delivered\nAny state before shipped → cancelled\npaid | shipped | delivered → refunded',
    },
    {
      name: 'currency',
      type: 'CHAR(3)',
      note: 'ISO 4217 (TWD, USD, JPY). Fixed at checkout.',
    },
    {
      name: 'subtotal_amount',
      type: 'DECIMAL(12,2)',
      note: 'Sum of line_total over all line items, before discount, tax and shipping.',
    },
    {
      name: 'discount_amount',
      type: 'DECIMAL(12,2)',
      note: 'Positive number. Applied before tax.',
    },
    {
      name: 'tax_amount',
      type: 'DECIMAL(12,2)',
      note: 'VAT 5% for TW orders; computed per line and rounded half-up per line, not on the total.',
    },
    { name: 'shipping_amount', type: 'DECIMAL(12,2)' },
    {
      name: 'total_amount',
      type: 'DECIMAL(12,2)',
      note: 'subtotal − discount + tax + shipping. A CHECK constraint enforces the equation.',
    },
    {
      name: 'coupon_code',
      type: 'VARCHAR(32)',
      nul: 1,
      note: 'Code as typed by the customer; may be expired — validation happens at checkout only.',
    },
    {
      name: 'shipping_address',
      type: 'JSONB',
      note: '{ "line1", "line2", "city", "postal_code", "country" } — snapshot, not a FK, so an address edit never changes past orders.',
    },
    {
      name: 'notes',
      type: 'TEXT',
      nul: 1,
      note: 'Free text from the customer. Can contain | pipes | and *markdown* — must render as plain text.',
    },
    {
      name: 'placed_at',
      type: 'TIMESTAMPTZ',
      nul: 1,
      note: 'Set when status leaves draft.',
    },
    { name: 'paid_at', type: 'TIMESTAMPTZ', nul: 1 },
    { name: 'shipped_at', type: 'TIMESTAMPTZ', nul: 1 },
    {
      name: 'cancelled_reason',
      type: 'VARCHAR(255)',
      nul: 1,
      note: 'Required when status = cancelled. See https://wiki.example.com/support/cancellation-reasons for the allowed list.',
    },
    { name: 'created_at', type: 'TIMESTAMPTZ' },
    { name: 'updated_at', type: 'TIMESTAMPTZ' },
  ],
)

T.items = table('order_line_items', 'Products inside an order.', 1100, 0, [
  {
    name: 'order_id',
    type: 'BIGINT',
    pk: 1,
    fk: 1,
    note: 'Part of the composite PK (order_id, line_no).',
  },
  {
    name: 'line_no',
    type: 'SMALLINT',
    pk: 1,
    note: '1-based position inside the order.',
  },
  {
    name: 'product_sku',
    type: 'VARCHAR(64)',
    note: 'SKU at the time of purchase.',
  },
  {
    name: 'product_name',
    type: 'VARCHAR(255)',
    note: 'Snapshot of the product name; the catalog may rename it later.',
  },
  { name: 'quantity', type: 'INTEGER', note: 'CHECK (quantity > 0).' },
  { name: 'unit_price', type: 'DECIMAL(12,2)' },
  {
    name: 'line_total',
    type: 'DECIMAL(12,2)',
    note: 'quantity × unit_price, stored for reporting speed.',
  },
  { name: 'gift_wrap', type: 'BOOLEAN' },
])

T.payments = table(
  'payment_transactions_with_gateway_reconciliation_state',
  null,
  1100,
  480,
  [
    { name: 'id', type: 'UUID', pk: 1 },
    {
      name: 'order_id',
      type: 'BIGINT',
      fk: 1,
      note: 'One order can have many attempts; only one ends as captured.',
    },
    { name: 'gateway', type: "ENUM('stripe','ecpay','linepay','manual')" },
    {
      name: 'gateway_txn_id',
      type: 'VARCHAR(128)',
      uq: 1,
      nul: 1,
      note: 'Provider reference. NULL until the provider answers.',
    },
    {
      name: 'state',
      type: "ENUM('created','authorized','captured','failed','voided','refunded')",
    },
    { name: 'amount', type: 'DECIMAL(12,2)' },
    { name: 'currency', type: 'CHAR(3)' },
    {
      name: 'fee_amount',
      type: 'DECIMAL(12,2)',
      nul: 1,
      note: 'Provider fee; filled by the nightly reconciliation job.',
    },
    { name: 'failure_code', type: 'VARCHAR(64)', nul: 1 },
    {
      name: 'failure_message',
      type: 'TEXT',
      nul: 1,
      note: 'Raw provider message. May contain HTML entities such as &amp; — do not render as HTML.',
    },
    { name: 'raw_request', type: 'JSONB', nul: 1 },
    { name: 'raw_response', type: 'JSONB', nul: 1 },
    {
      name: 'idempotency_key',
      type: 'VARCHAR(64)',
      uq: 1,
      note: 'Sent to the provider so a retried request never charges twice.',
    },
    { name: 'reconciled', type: 'BOOLEAN' },
    { name: 'reconciled_at', type: 'TIMESTAMPTZ', nul: 1 },
    { name: 'settlement_batch', type: 'VARCHAR(32)', nul: 1 },
    { name: 'card_brand', type: 'VARCHAR(16)', nul: 1 },
    {
      name: 'card_last4',
      type: 'CHAR(4)',
      nul: 1,
      note: 'Only the last 4 digits. Never store the full PAN (PCI DSS).',
    },
    { name: 'three_ds_result', type: 'VARCHAR(16)', nul: 1 },
    {
      name: 'risk_score',
      type: 'SMALLINT',
      nul: 1,
      note: '0–100 from the provider fraud check; ≥ 80 blocks capture.',
    },
    { name: 'ip_address', type: 'INET', nul: 1 },
    { name: 'user_agent', type: 'TEXT', nul: 1 },
    { name: 'captured_at', type: 'TIMESTAMPTZ', nul: 1 },
    { name: 'refunded_at', type: 'TIMESTAMPTZ', nul: 1 },
    { name: 'refund_amount', type: 'DECIMAL(12,2)', nul: 1 },
    { name: 'created_at', type: 'TIMESTAMPTZ' },
    { name: 'updated_at', type: 'TIMESTAMPTZ' },
    {
      name: 'version',
      type: 'INTEGER',
      note: 'Optimistic-lock counter; every UPDATE must match and increment it.',
    },
  ],
)

T.audit = table(
  'audit_log',
  'Append-only. No comments on purpose (empty-state check).',
  520,
  760,
  [
    { name: 'id', type: 'BIGSERIAL', pk: 1 },
    { name: 'actor_id', type: 'BIGINT', nul: 1 },
    { name: 'action', type: 'VARCHAR(64)' },
    { name: 'entity', type: 'VARCHAR(64)' },
    { name: 'entity_id', type: 'VARCHAR(64)' },
    { name: 'diff', type: 'JSONB' },
    { name: 'created_at', type: 'TIMESTAMPTZ' },
  ],
)

const rel = (
  src: string,
  srcCol: string,
  tgt: string,
  tgtCol: string,
  label: string,
) =>
  db
    .query(
      'INSERT INTO "Relationship" (id, whiteboardId, sourceTableId, targetTableId, sourceColumnId, targetColumnId, cardinality, label, routingPoints, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
    )
    .run(
      id('a002'),
      WB,
      T[src],
      T[tgt],
      colIds.get(srcCol),
      colIds.get(tgtCol),
      'MANY_TO_ONE',
      label,
      null,
      now,
      now,
    )
rel(
  'orders',
  'customer_orders.customer_id',
  'customers',
  'customers.id',
  'placed by',
)
rel(
  'customers',
  'customers.company_id',
  'companies',
  'companies.id',
  'works at',
)
rel(
  'items',
  'order_line_items.order_id',
  'orders',
  'customer_orders.id',
  'belongs to',
)
rel(
  'payments',
  'payment_transactions_with_gateway_reconciliation_state.order_id',
  'orders',
  'customer_orders.id',
  'pays',
)

db.close()
console.log(
  `[seed-fields-drawer] board ${WB}: ${Object.keys(T).length} tables, ${colIds.size} columns`,
)
