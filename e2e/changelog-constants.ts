// e2e/changelog-constants.ts
// Ids, table definitions and date helpers shared by the schema-changelog
// seed (e2e/seed-changelog.ts, run under Bun) and its spec (Node). No imports:
// both runtimes load this file.

export const CL_IDS = {
  /** Board with a long seeded change history (read-only tests). */
  history: 'e1000000-0000-4000-8000-000000000001',
  /** Board with 16 tables and no history (the live-edit test writes to it). */
  live: 'e1000000-0000-4000-8000-000000000002',
  /** Board with no tables and no history. */
  empty: 'e1000000-0000-4000-8000-000000000003',
} as const

export interface SeedColumn {
  name: string
  type: string
  pk?: boolean
  fk?: boolean
  nullable?: boolean
}

export interface SeedTable {
  name: string
  columns: Array<SeedColumn>
}

const col = (
  name: string,
  type = 'VARCHAR',
  extra: Partial<SeedColumn> = {},
) => ({
  name,
  type,
  ...extra,
})
const pk = () => col('id', 'UUID', { pk: true })

/** 16 tables: long names, CJK names, one table with 22 columns (last, so its height has a free row below it). */
export const SEED_TABLES: Array<SeedTable> = [
  {
    name: 'accounts',
    columns: [
      pk(),
      col('mail'),
      col('display_name'),
      col('created_at', 'TIMESTAMP'),
    ],
  },
  {
    name: 'orders',
    columns: [
      pk(),
      col('account_id', 'UUID', { fk: true }),
      col('status'),
      col('total', 'DECIMAL'),
      col('placed_at', 'TIMESTAMP'),
    ],
  },
  {
    name: 'order_items',
    columns: [
      pk(),
      col('order_id', 'UUID', { fk: true }),
      col('product_id', 'UUID', { fk: true }),
      col('quantity', 'INT'),
    ],
  },
  {
    name: 'categories',
    columns: [pk(), col('title'), col('parent_id', 'UUID', { fk: true })],
  },
  {
    name: 'inventory',
    columns: [
      pk(),
      col('product_id', 'UUID', { fk: true }),
      col('on_hand', 'INT'),
    ],
  },
  {
    name: 'shipments',
    columns: [
      pk(),
      col('order_id', 'UUID', { fk: true }),
      col('carrier'),
      col('shipped_at', 'TIMESTAMP'),
    ],
  },
  {
    name: 'payments',
    columns: [
      pk(),
      col('order_id', 'UUID', { fk: true }),
      col('amount', 'DECIMAL'),
      col('provider'),
    ],
  },
  {
    name: 'invoices',
    columns: [
      pk(),
      col('payment_id', 'UUID', { fk: true }),
      col('issued_at', 'TIMESTAMP'),
    ],
  },
  {
    name: 'customer_subscription_billing_adjustment_history_archive',
    columns: [
      pk(),
      col('customer_subscription_billing_adjustment_reference_identifier'),
      col('adjusted_at', 'TIMESTAMP'),
    ],
  },
  {
    name: '使用者帳號資料表',
    columns: [
      pk(),
      col('電子郵件'),
      col('顯示名稱'),
      col('建立時間', 'TIMESTAMP'),
    ],
  },
  {
    name: '訂單明細',
    columns: [
      pk(),
      col('訂單編號', 'UUID', { fk: true }),
      col('商品名稱'),
      col('數量', 'INT'),
    ],
  },
  { name: '商品分類', columns: [pk(), col('分類名稱'), col('排序', 'INT')] },
  {
    name: 'audit_log',
    columns: [
      pk(),
      col('actor_id', 'UUID', { fk: true }),
      col('action'),
      col('at', 'TIMESTAMP'),
    ],
  },
  {
    name: 'sessions',
    columns: [
      pk(),
      col('account_id', 'UUID', { fk: true }),
      col('expires_at', 'TIMESTAMP'),
    ],
  },
  {
    name: 'notifications',
    columns: [
      pk(),
      col('account_id', 'UUID', { fk: true }),
      col('body', 'TEXT'),
      col('read', 'BOOLEAN'),
    ],
  },
  {
    name: 'products',
    columns: [
      pk(),
      col('sku'),
      col('title'),
      ...Array.from({ length: 19 }, (_, i) =>
        col(`attribute_${String(i + 1).padStart(2, '0')}`, 'VARCHAR', {
          nullable: true,
        }),
      ),
      col('price', 'DECIMAL'),
    ],
  },
]

/** Epoch ms at `hour`:00 local time, `daysAgo` local days before today. */
export function dayAt(daysAgo: number, hour = 12): number {
  const d = new Date()
  d.setHours(hour, 0, 0, 0)
  d.setDate(d.getDate() - daysAgo)
  return d.getTime()
}

/** `YYYY-MM-DD` of the local day `daysAgo` days before today (a date input value). */
export function dayInput(daysAgo: number): string {
  const d = new Date(dayAt(daysAgo))
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
