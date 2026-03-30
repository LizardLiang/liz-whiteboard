// prisma/seed-ecommerce-demo.ts
// E-Commerce Demo seed script for the ER Diagram Whiteboard
// Populates a 14-table e-commerce schema demonstrating all supported modeling primitives

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

// ─── Canvas Position Constants ────────────────────────────────────────────────
// Organized by cluster to avoid overlaps on a ~2000x1500 canvas

const POSITIONS = {
  // Customer Cluster (top-left)
  customers: { x: 50, y: 50 },
  addresses: { x: 50, y: 350 },

  // Product Cluster (top-right)
  categories: { x: 600, y: 50 },
  products: { x: 950, y: 50 },
  product_images: { x: 1300, y: 50 },
  tags: { x: 600, y: 350 },
  product_tags: { x: 950, y: 350 },
  inventory: { x: 1300, y: 350 },

  // Review Cluster (middle-left, bridges customer and product)
  reviews: { x: 350, y: 500 },

  // Order Cluster (bottom-center)
  orders: { x: 350, y: 700 },
  order_items: { x: 700, y: 700 },
  payments: { x: 350, y: 1000 },
  coupons: { x: 1050, y: 1000 },
  order_coupons: { x: 700, y: 1000 },
} as const

async function main() {
  console.log('[seed-demo] Checking for existing E-Commerce Demo project...')

  // Idempotency check — runs outside transaction (read-only)
  const existing = await prisma.project.findFirst({
    where: { name: 'E-Commerce Demo' },
  })

  if (existing) {
    console.log(
      `[seed-demo] E-Commerce Demo project already exists (id: ${existing.id}). Skipping seed.`,
    )
    return
  }

  console.log('[seed-demo] No existing project found. Proceeding with seed...')

  // ─── Step 1: Create Project ───────────────────────────────────────────────
  console.log('[seed-demo] Creating project "E-Commerce Demo"...')
  const project = await prisma.project.create({
    data: {
      name: 'E-Commerce Demo',
      description:
        'A comprehensive e-commerce schema demonstrating all relationship cardinalities and data types.',
    },
  })

  // ─── Step 2: Create Whiteboard ────────────────────────────────────────────
  console.log('[seed-demo] Creating whiteboard "E-Commerce Platform Schema"...')
  const whiteboard = await prisma.whiteboard.create({
    data: {
      name: 'E-Commerce Platform Schema',
      projectId: project.id,
    },
  })

  const wbId = whiteboard.id

  // ─── Step 3: Create 14 DiagramTables ─────────────────────────────────────
  console.log('[seed-demo] Creating tables (14)...')

  const tCustomers = await prisma.diagramTable.create({
    data: {
      whiteboardId: wbId,
      name: 'customers',
      description: 'Registered customer accounts',
      positionX: POSITIONS.customers.x,
      positionY: POSITIONS.customers.y,
    },
  })

  const tAddresses = await prisma.diagramTable.create({
    data: {
      whiteboardId: wbId,
      name: 'addresses',
      description: 'Customer shipping and billing addresses',
      positionX: POSITIONS.addresses.x,
      positionY: POSITIONS.addresses.y,
    },
  })

  const tCategories = await prisma.diagramTable.create({
    data: {
      whiteboardId: wbId,
      name: 'categories',
      description: 'Hierarchical product categories',
      positionX: POSITIONS.categories.x,
      positionY: POSITIONS.categories.y,
    },
  })

  const tProducts = await prisma.diagramTable.create({
    data: {
      whiteboardId: wbId,
      name: 'products',
      description: 'Product catalog',
      positionX: POSITIONS.products.x,
      positionY: POSITIONS.products.y,
    },
  })

  const tProductImages = await prisma.diagramTable.create({
    data: {
      whiteboardId: wbId,
      name: 'product_images',
      description: 'Product gallery images',
      positionX: POSITIONS.product_images.x,
      positionY: POSITIONS.product_images.y,
    },
  })

  const tTags = await prisma.diagramTable.create({
    data: {
      whiteboardId: wbId,
      name: 'tags',
      description: 'Product classification tags',
      positionX: POSITIONS.tags.x,
      positionY: POSITIONS.tags.y,
    },
  })

  const tProductTags = await prisma.diagramTable.create({
    data: {
      whiteboardId: wbId,
      name: 'product_tags',
      description: 'Join table: products <-> tags',
      positionX: POSITIONS.product_tags.x,
      positionY: POSITIONS.product_tags.y,
    },
  })

  const tInventory = await prisma.diagramTable.create({
    data: {
      whiteboardId: wbId,
      name: 'inventory',
      description: 'Per-product stock levels',
      positionX: POSITIONS.inventory.x,
      positionY: POSITIONS.inventory.y,
    },
  })

  const tOrders = await prisma.diagramTable.create({
    data: {
      whiteboardId: wbId,
      name: 'orders',
      description: 'Customer purchase orders',
      positionX: POSITIONS.orders.x,
      positionY: POSITIONS.orders.y,
    },
  })

  const tOrderItems = await prisma.diagramTable.create({
    data: {
      whiteboardId: wbId,
      name: 'order_items',
      description: 'Individual line items within an order',
      positionX: POSITIONS.order_items.x,
      positionY: POSITIONS.order_items.y,
    },
  })

  const tPayments = await prisma.diagramTable.create({
    data: {
      whiteboardId: wbId,
      name: 'payments',
      description: 'Payment transactions for orders',
      positionX: POSITIONS.payments.x,
      positionY: POSITIONS.payments.y,
    },
  })

  const tCoupons = await prisma.diagramTable.create({
    data: {
      whiteboardId: wbId,
      name: 'coupons',
      description: 'Discount coupon codes',
      positionX: POSITIONS.coupons.x,
      positionY: POSITIONS.coupons.y,
    },
  })

  const tOrderCoupons = await prisma.diagramTable.create({
    data: {
      whiteboardId: wbId,
      name: 'order_coupons',
      description: 'Join table: orders <-> coupons',
      positionX: POSITIONS.order_coupons.x,
      positionY: POSITIONS.order_coupons.y,
    },
  })

  const tReviews = await prisma.diagramTable.create({
    data: {
      whiteboardId: wbId,
      name: 'reviews',
      description: 'Customer product reviews',
      positionX: POSITIONS.reviews.x,
      positionY: POSITIONS.reviews.y,
    },
  })

  console.log(
    '[seed-demo]   Created: customers, addresses, categories, products, product_images, tags, product_tags, inventory, orders, order_items, payments, coupons, order_coupons, reviews',
  )

  // ─── Step 4: Create Columns ───────────────────────────────────────────────
  console.log('[seed-demo] Creating columns...')

  // ── customers ──────────────────────────────────────────────────────────────
  const cCustomersId = await prisma.column.create({
    data: {
      tableId: tCustomers.id,
      name: 'id',
      dataType: 'uuid',
      isPrimaryKey: true,
      isForeignKey: false,
      isUnique: true,
      isNullable: false,
      order: 0,
    },
  })

  const cCustomersEmail = await prisma.column.create({
    data: {
      tableId: tCustomers.id,
      name: 'email',
      dataType: 'string',
      isPrimaryKey: false,
      isForeignKey: false,
      isUnique: true,
      isNullable: false,
      description: 'FORMAT: valid email address',
      order: 1,
    },
  })

  await prisma.column.createMany({
    data: [
      {
        tableId: tCustomers.id,
        name: 'first_name',
        dataType: 'string',
        isPrimaryKey: false,
        isForeignKey: false,
        isUnique: false,
        isNullable: false,
        order: 2,
      },
      {
        tableId: tCustomers.id,
        name: 'last_name',
        dataType: 'string',
        isPrimaryKey: false,
        isForeignKey: false,
        isUnique: false,
        isNullable: false,
        order: 3,
      },
      {
        tableId: tCustomers.id,
        name: 'created_at',
        dataType: 'date',
        isPrimaryKey: false,
        isForeignKey: false,
        isUnique: false,
        isNullable: false,
        description: 'DEFAULT: CURRENT_TIMESTAMP',
        order: 4,
      },
      {
        tableId: tCustomers.id,
        name: 'is_active',
        dataType: 'boolean',
        isPrimaryKey: false,
        isForeignKey: false,
        isUnique: false,
        isNullable: false,
        description: 'DEFAULT: true',
        order: 5,
      },
    ],
  })

  // ── addresses ──────────────────────────────────────────────────────────────
  const cAddressesId = await prisma.column.create({
    data: {
      tableId: tAddresses.id,
      name: 'id',
      dataType: 'uuid',
      isPrimaryKey: true,
      isForeignKey: false,
      isUnique: true,
      isNullable: false,
      order: 0,
    },
  })

  const cAddressesCustomerId = await prisma.column.create({
    data: {
      tableId: tAddresses.id,
      name: 'customer_id',
      dataType: 'uuid',
      isPrimaryKey: false,
      isForeignKey: true,
      isUnique: false,
      isNullable: false,
      order: 1,
    },
  })

  await prisma.column.createMany({
    data: [
      {
        tableId: tAddresses.id,
        name: 'street',
        dataType: 'string',
        isPrimaryKey: false,
        isForeignKey: false,
        isUnique: false,
        isNullable: false,
        order: 2,
      },
      {
        tableId: tAddresses.id,
        name: 'city',
        dataType: 'string',
        isPrimaryKey: false,
        isForeignKey: false,
        isUnique: false,
        isNullable: false,
        order: 3,
      },
      {
        tableId: tAddresses.id,
        name: 'state',
        dataType: 'string',
        isPrimaryKey: false,
        isForeignKey: false,
        isUnique: false,
        isNullable: false,
        order: 4,
      },
      {
        tableId: tAddresses.id,
        name: 'zip_code',
        dataType: 'string',
        isPrimaryKey: false,
        isForeignKey: false,
        isUnique: false,
        isNullable: false,
        order: 5,
      },
      {
        tableId: tAddresses.id,
        name: 'is_default',
        dataType: 'boolean',
        isPrimaryKey: false,
        isForeignKey: false,
        isUnique: false,
        isNullable: false,
        order: 6,
      },
    ],
  })

  // ── categories ─────────────────────────────────────────────────────────────
  const cCategoriesId = await prisma.column.create({
    data: {
      tableId: tCategories.id,
      name: 'id',
      dataType: 'uuid',
      isPrimaryKey: true,
      isForeignKey: false,
      isUnique: true,
      isNullable: false,
      order: 0,
    },
  })

  const cCategoriesParentId = await prisma.column.create({
    data: {
      tableId: tCategories.id,
      name: 'parent_category_id',
      dataType: 'uuid',
      isPrimaryKey: false,
      isForeignKey: true,
      isUnique: false,
      isNullable: true,
      description: 'SELF-REF: references categories.id',
      order: 1,
    },
  })

  await prisma.column.createMany({
    data: [
      {
        tableId: tCategories.id,
        name: 'name',
        dataType: 'string',
        isPrimaryKey: false,
        isForeignKey: false,
        isUnique: true,
        isNullable: false,
        order: 2,
      },
      {
        tableId: tCategories.id,
        name: 'description',
        dataType: 'text',
        isPrimaryKey: false,
        isForeignKey: false,
        isUnique: false,
        isNullable: true,
        order: 3,
      },
      {
        tableId: tCategories.id,
        name: 'level',
        dataType: 'int',
        isPrimaryKey: false,
        isForeignKey: false,
        isUnique: false,
        isNullable: false,
        description: 'CHECK: value >= 0; root categories have level 0',
        order: 4,
      },
    ],
  })

  // ── products ───────────────────────────────────────────────────────────────
  const cProductsId = await prisma.column.create({
    data: {
      tableId: tProducts.id,
      name: 'id',
      dataType: 'uuid',
      isPrimaryKey: true,
      isForeignKey: false,
      isUnique: true,
      isNullable: false,
      order: 0,
    },
  })

  const cProductsCategoryId = await prisma.column.create({
    data: {
      tableId: tProducts.id,
      name: 'category_id',
      dataType: 'uuid',
      isPrimaryKey: false,
      isForeignKey: true,
      isUnique: false,
      isNullable: false,
      order: 1,
    },
  })

  await prisma.column.createMany({
    data: [
      {
        tableId: tProducts.id,
        name: 'name',
        dataType: 'string',
        isPrimaryKey: false,
        isForeignKey: false,
        isUnique: false,
        isNullable: false,
        order: 2,
      },
      {
        tableId: tProducts.id,
        name: 'description',
        dataType: 'text',
        isPrimaryKey: false,
        isForeignKey: false,
        isUnique: false,
        isNullable: true,
        order: 3,
      },
      {
        tableId: tProducts.id,
        name: 'base_price',
        dataType: 'float',
        isPrimaryKey: false,
        isForeignKey: false,
        isUnique: false,
        isNullable: false,
        description: 'CHECK: value >= 0',
        order: 4,
      },
      {
        tableId: tProducts.id,
        name: 'sku',
        dataType: 'string',
        isPrimaryKey: false,
        isForeignKey: false,
        isUnique: true,
        isNullable: false,
        order: 5,
      },
      {
        tableId: tProducts.id,
        name: 'is_available',
        dataType: 'boolean',
        isPrimaryKey: false,
        isForeignKey: false,
        isUnique: false,
        isNullable: false,
        order: 6,
      },
      {
        tableId: tProducts.id,
        name: 'metadata',
        dataType: 'json',
        isPrimaryKey: false,
        isForeignKey: false,
        isUnique: false,
        isNullable: true,
        description:
          'JSONB: flexible product attributes (color, size, weight, etc.)',
        order: 7,
      },
    ],
  })

  // ── product_images ─────────────────────────────────────────────────────────
  const cProductImagesId = await prisma.column.create({
    data: {
      tableId: tProductImages.id,
      name: 'id',
      dataType: 'uuid',
      isPrimaryKey: true,
      isForeignKey: false,
      isUnique: true,
      isNullable: false,
      order: 0,
    },
  })

  const cProductImagesProductId = await prisma.column.create({
    data: {
      tableId: tProductImages.id,
      name: 'product_id',
      dataType: 'uuid',
      isPrimaryKey: false,
      isForeignKey: true,
      isUnique: false,
      isNullable: false,
      order: 1,
    },
  })

  await prisma.column.createMany({
    data: [
      {
        tableId: tProductImages.id,
        name: 'url',
        dataType: 'text',
        isPrimaryKey: false,
        isForeignKey: false,
        isUnique: false,
        isNullable: false,
        order: 2,
      },
      {
        tableId: tProductImages.id,
        name: 'alt_text',
        dataType: 'string',
        isPrimaryKey: false,
        isForeignKey: false,
        isUnique: false,
        isNullable: true,
        order: 3,
      },
      {
        tableId: tProductImages.id,
        name: 'display_order',
        dataType: 'int',
        isPrimaryKey: false,
        isForeignKey: false,
        isUnique: false,
        isNullable: false,
        description: 'CHECK: value >= 0; determines gallery sequence',
        order: 4,
      },
      {
        tableId: tProductImages.id,
        name: 'is_primary',
        dataType: 'boolean',
        isPrimaryKey: false,
        isForeignKey: false,
        isUnique: false,
        isNullable: false,
        order: 5,
      },
    ],
  })

  // ── tags ───────────────────────────────────────────────────────────────────
  const cTagsId = await prisma.column.create({
    data: {
      tableId: tTags.id,
      name: 'id',
      dataType: 'uuid',
      isPrimaryKey: true,
      isForeignKey: false,
      isUnique: true,
      isNullable: false,
      order: 0,
    },
  })

  await prisma.column.createMany({
    data: [
      {
        tableId: tTags.id,
        name: 'name',
        dataType: 'string',
        isPrimaryKey: false,
        isForeignKey: false,
        isUnique: true,
        isNullable: false,
        order: 1,
      },
    ],
  })

  // ── product_tags (join table, no PK) ────────────────────────────────────────
  const cProductTagsProductId = await prisma.column.create({
    data: {
      tableId: tProductTags.id,
      name: 'product_id',
      dataType: 'uuid',
      isPrimaryKey: false,
      isForeignKey: true,
      isUnique: false,
      isNullable: false,
      order: 0,
    },
  })

  const cProductTagsTagId = await prisma.column.create({
    data: {
      tableId: tProductTags.id,
      name: 'tag_id',
      dataType: 'uuid',
      isPrimaryKey: false,
      isForeignKey: true,
      isUnique: false,
      isNullable: false,
      order: 1,
    },
  })

  // ── inventory ──────────────────────────────────────────────────────────────
  const cInventoryId = await prisma.column.create({
    data: {
      tableId: tInventory.id,
      name: 'id',
      dataType: 'uuid',
      isPrimaryKey: true,
      isForeignKey: false,
      isUnique: true,
      isNullable: false,
      order: 0,
    },
  })

  const cInventoryProductId = await prisma.column.create({
    data: {
      tableId: tInventory.id,
      name: 'product_id',
      dataType: 'uuid',
      isPrimaryKey: false,
      isForeignKey: true,
      isUnique: true,
      isNullable: false,
      order: 1,
    },
  })

  await prisma.column.createMany({
    data: [
      {
        tableId: tInventory.id,
        name: 'quantity',
        dataType: 'int',
        isPrimaryKey: false,
        isForeignKey: false,
        isUnique: false,
        isNullable: false,
        description: 'CHECK: value >= 0',
        order: 2,
      },
      {
        tableId: tInventory.id,
        name: 'low_stock_threshold',
        dataType: 'int',
        isPrimaryKey: false,
        isForeignKey: false,
        isUnique: false,
        isNullable: false,
        description: 'CHECK: value >= 0; triggers restock alert',
        order: 3,
      },
      {
        tableId: tInventory.id,
        name: 'last_restocked',
        dataType: 'date',
        isPrimaryKey: false,
        isForeignKey: false,
        isUnique: false,
        isNullable: true,
        order: 4,
      },
    ],
  })

  // ── orders ─────────────────────────────────────────────────────────────────
  const cOrdersId = await prisma.column.create({
    data: {
      tableId: tOrders.id,
      name: 'id',
      dataType: 'uuid',
      isPrimaryKey: true,
      isForeignKey: false,
      isUnique: true,
      isNullable: false,
      order: 0,
    },
  })

  const cOrdersCustomerId = await prisma.column.create({
    data: {
      tableId: tOrders.id,
      name: 'customer_id',
      dataType: 'uuid',
      isPrimaryKey: false,
      isForeignKey: true,
      isUnique: false,
      isNullable: false,
      order: 1,
    },
  })

  const cOrdersShippingAddressId = await prisma.column.create({
    data: {
      tableId: tOrders.id,
      name: 'shipping_address_id',
      dataType: 'uuid',
      isPrimaryKey: false,
      isForeignKey: true,
      isUnique: false,
      isNullable: false,
      order: 2,
    },
  })

  await prisma.column.createMany({
    data: [
      {
        tableId: tOrders.id,
        name: 'order_date',
        dataType: 'date',
        isPrimaryKey: false,
        isForeignKey: false,
        isUnique: false,
        isNullable: false,
        order: 3,
      },
      {
        tableId: tOrders.id,
        name: 'status',
        dataType: 'string',
        isPrimaryKey: false,
        isForeignKey: false,
        isUnique: false,
        isNullable: false,
        description: 'ENUM: pending, processing, shipped, delivered, cancelled',
        order: 4,
      },
      {
        tableId: tOrders.id,
        name: 'total_amount',
        dataType: 'float',
        isPrimaryKey: false,
        isForeignKey: false,
        isUnique: false,
        isNullable: false,
        description: 'CHECK: value >= 0',
        order: 5,
      },
      {
        tableId: tOrders.id,
        name: 'notes',
        dataType: 'text',
        isPrimaryKey: false,
        isForeignKey: false,
        isUnique: false,
        isNullable: true,
        order: 6,
      },
    ],
  })

  // ── order_items ────────────────────────────────────────────────────────────
  const cOrderItemsId = await prisma.column.create({
    data: {
      tableId: tOrderItems.id,
      name: 'id',
      dataType: 'uuid',
      isPrimaryKey: true,
      isForeignKey: false,
      isUnique: true,
      isNullable: false,
      order: 0,
    },
  })

  const cOrderItemsOrderId = await prisma.column.create({
    data: {
      tableId: tOrderItems.id,
      name: 'order_id',
      dataType: 'uuid',
      isPrimaryKey: false,
      isForeignKey: true,
      isUnique: false,
      isNullable: false,
      order: 1,
    },
  })

  const cOrderItemsProductId = await prisma.column.create({
    data: {
      tableId: tOrderItems.id,
      name: 'product_id',
      dataType: 'uuid',
      isPrimaryKey: false,
      isForeignKey: true,
      isUnique: false,
      isNullable: false,
      order: 2,
    },
  })

  await prisma.column.createMany({
    data: [
      {
        tableId: tOrderItems.id,
        name: 'quantity',
        dataType: 'int',
        isPrimaryKey: false,
        isForeignKey: false,
        isUnique: false,
        isNullable: false,
        description: 'CHECK: value >= 1',
        order: 3,
      },
      {
        tableId: tOrderItems.id,
        name: 'unit_price',
        dataType: 'float',
        isPrimaryKey: false,
        isForeignKey: false,
        isUnique: false,
        isNullable: false,
        description: 'CHECK: value >= 0',
        order: 4,
      },
    ],
  })

  // ── payments ───────────────────────────────────────────────────────────────
  const cPaymentsId = await prisma.column.create({
    data: {
      tableId: tPayments.id,
      name: 'id',
      dataType: 'uuid',
      isPrimaryKey: true,
      isForeignKey: false,
      isUnique: true,
      isNullable: false,
      order: 0,
    },
  })

  const cPaymentsOrderId = await prisma.column.create({
    data: {
      tableId: tPayments.id,
      name: 'order_id',
      dataType: 'uuid',
      isPrimaryKey: false,
      isForeignKey: true,
      isUnique: false,
      isNullable: false,
      order: 1,
    },
  })

  await prisma.column.createMany({
    data: [
      {
        tableId: tPayments.id,
        name: 'amount',
        dataType: 'float',
        isPrimaryKey: false,
        isForeignKey: false,
        isUnique: false,
        isNullable: false,
        description: 'CHECK: value > 0',
        order: 2,
      },
      {
        tableId: tPayments.id,
        name: 'method',
        dataType: 'string',
        isPrimaryKey: false,
        isForeignKey: false,
        isUnique: false,
        isNullable: false,
        order: 3,
      },
      {
        tableId: tPayments.id,
        name: 'transaction_id',
        dataType: 'string',
        isPrimaryKey: false,
        isForeignKey: false,
        isUnique: true,
        isNullable: false,
        order: 4,
      },
      {
        tableId: tPayments.id,
        name: 'paid_at',
        dataType: 'date',
        isPrimaryKey: false,
        isForeignKey: false,
        isUnique: false,
        isNullable: false,
        order: 5,
      },
      {
        tableId: tPayments.id,
        name: 'payment_details',
        dataType: 'json',
        isPrimaryKey: false,
        isForeignKey: false,
        isUnique: false,
        isNullable: true,
        description: 'JSONB: gateway response, card last 4, billing address',
        order: 6,
      },
    ],
  })

  // ── coupons ────────────────────────────────────────────────────────────────
  const cCouponsId = await prisma.column.create({
    data: {
      tableId: tCoupons.id,
      name: 'id',
      dataType: 'uuid',
      isPrimaryKey: true,
      isForeignKey: false,
      isUnique: true,
      isNullable: false,
      order: 0,
    },
  })

  await prisma.column.createMany({
    data: [
      {
        tableId: tCoupons.id,
        name: 'code',
        dataType: 'string',
        isPrimaryKey: false,
        isForeignKey: false,
        isUnique: true,
        isNullable: false,
        order: 1,
      },
      {
        tableId: tCoupons.id,
        name: 'discount_percent',
        dataType: 'float',
        isPrimaryKey: false,
        isForeignKey: false,
        isUnique: false,
        isNullable: false,
        description: 'CHECK: value BETWEEN 0 AND 100',
        order: 2,
      },
      {
        tableId: tCoupons.id,
        name: 'valid_from',
        dataType: 'date',
        isPrimaryKey: false,
        isForeignKey: false,
        isUnique: false,
        isNullable: false,
        order: 3,
      },
      {
        tableId: tCoupons.id,
        name: 'valid_until',
        dataType: 'date',
        isPrimaryKey: false,
        isForeignKey: false,
        isUnique: false,
        isNullable: false,
        description: 'CHECK: valid_until > valid_from',
        order: 4,
      },
      {
        tableId: tCoupons.id,
        name: 'is_active',
        dataType: 'boolean',
        isPrimaryKey: false,
        isForeignKey: false,
        isUnique: false,
        isNullable: false,
        order: 5,
      },
      {
        tableId: tCoupons.id,
        name: 'usage_limit',
        dataType: 'int',
        isPrimaryKey: false,
        isForeignKey: false,
        isUnique: false,
        isNullable: false,
        description: 'CHECK: value >= 0; 0 means unlimited',
        order: 6,
      },
    ],
  })

  // ── order_coupons (join table, no PK) ──────────────────────────────────────
  const cOrderCouponsOrderId = await prisma.column.create({
    data: {
      tableId: tOrderCoupons.id,
      name: 'order_id',
      dataType: 'uuid',
      isPrimaryKey: false,
      isForeignKey: true,
      isUnique: false,
      isNullable: false,
      order: 0,
    },
  })

  const cOrderCouponsCouponId = await prisma.column.create({
    data: {
      tableId: tOrderCoupons.id,
      name: 'coupon_id',
      dataType: 'uuid',
      isPrimaryKey: false,
      isForeignKey: true,
      isUnique: false,
      isNullable: false,
      order: 1,
    },
  })

  // ── reviews ────────────────────────────────────────────────────────────────
  const cReviewsId = await prisma.column.create({
    data: {
      tableId: tReviews.id,
      name: 'id',
      dataType: 'uuid',
      isPrimaryKey: true,
      isForeignKey: false,
      isUnique: true,
      isNullable: false,
      order: 0,
    },
  })

  const cReviewsProductId = await prisma.column.create({
    data: {
      tableId: tReviews.id,
      name: 'product_id',
      dataType: 'uuid',
      isPrimaryKey: false,
      isForeignKey: true,
      isUnique: false,
      isNullable: false,
      order: 1,
    },
  })

  const cReviewsCustomerId = await prisma.column.create({
    data: {
      tableId: tReviews.id,
      name: 'customer_id',
      dataType: 'uuid',
      isPrimaryKey: false,
      isForeignKey: true,
      isUnique: false,
      isNullable: false,
      order: 2,
    },
  })

  await prisma.column.createMany({
    data: [
      {
        tableId: tReviews.id,
        name: 'rating',
        dataType: 'int',
        isPrimaryKey: false,
        isForeignKey: false,
        isUnique: false,
        isNullable: false,
        description: 'CHECK: value BETWEEN 1 AND 5',
        order: 3,
      },
      {
        tableId: tReviews.id,
        name: 'title',
        dataType: 'string',
        isPrimaryKey: false,
        isForeignKey: false,
        isUnique: false,
        isNullable: false,
        order: 4,
      },
      {
        tableId: tReviews.id,
        name: 'body',
        dataType: 'text',
        isPrimaryKey: false,
        isForeignKey: false,
        isUnique: false,
        isNullable: true,
        order: 5,
      },
      {
        tableId: tReviews.id,
        name: 'is_verified',
        dataType: 'boolean',
        isPrimaryKey: false,
        isForeignKey: false,
        isUnique: false,
        isNullable: false,
        order: 6,
      },
      {
        tableId: tReviews.id,
        name: 'reviewed_at',
        dataType: 'date',
        isPrimaryKey: false,
        isForeignKey: false,
        isUnique: false,
        isNullable: false,
        order: 7,
      },
    ],
  })

  // Suppress unused variable warnings — these IDs are kept for future reference
  void cCustomersEmail
  void cProductImagesId
  void cInventoryId
  void cOrderItemsId
  void cPaymentsId
  void cReviewsId
  void cOrdersCustomerId
  void cOrderCouponsOrderId

  console.log('[seed-demo]   Created ~85 columns across 14 tables')

  // ─── Step 5: Create Relationships ─────────────────────────────────────────
  console.log('[seed-demo] Creating relationships (18)...')

  // #1: customers -> addresses (ONE_TO_MANY)
  await prisma.relationship.create({
    data: {
      whiteboardId: wbId,
      sourceTableId: tCustomers.id,
      targetTableId: tAddresses.id,
      sourceColumnId: cCustomersId.id,
      targetColumnId: cAddressesCustomerId.id,
      cardinality: 'ONE_TO_MANY',
      label: 'has addresses',
    },
  })
  console.log('[seed-demo]   Created: customers -> addresses (ONE_TO_MANY)')

  // #2: customers -> orders (ONE_TO_MANY)
  await prisma.relationship.create({
    data: {
      whiteboardId: wbId,
      sourceTableId: tCustomers.id,
      targetTableId: tOrders.id,
      sourceColumnId: cCustomersId.id,
      targetColumnId: cOrdersCustomerId.id,
      cardinality: 'ONE_TO_MANY',
      label: 'places orders',
    },
  })
  console.log('[seed-demo]   Created: customers -> orders (ONE_TO_MANY)')

  // #3: customers -> reviews (ONE_TO_MANY)
  await prisma.relationship.create({
    data: {
      whiteboardId: wbId,
      sourceTableId: tCustomers.id,
      targetTableId: tReviews.id,
      sourceColumnId: cCustomersId.id,
      targetColumnId: cReviewsCustomerId.id,
      cardinality: 'ONE_TO_MANY',
      label: 'writes reviews',
    },
  })
  console.log('[seed-demo]   Created: customers -> reviews (ONE_TO_MANY)')

  // #4: categories -> categories (SELF_REFERENCING)
  await prisma.relationship.create({
    data: {
      whiteboardId: wbId,
      sourceTableId: tCategories.id,
      targetTableId: tCategories.id,
      sourceColumnId: cCategoriesId.id,
      targetColumnId: cCategoriesParentId.id,
      cardinality: 'SELF_REFERENCING',
      label: 'parent category',
    },
  })
  console.log(
    '[seed-demo]   Created: categories -> categories (SELF_REFERENCING)',
  )

  // #5: categories -> products (ONE_TO_MANY)
  await prisma.relationship.create({
    data: {
      whiteboardId: wbId,
      sourceTableId: tCategories.id,
      targetTableId: tProducts.id,
      sourceColumnId: cCategoriesId.id,
      targetColumnId: cProductsCategoryId.id,
      cardinality: 'ONE_TO_MANY',
      label: 'contains products',
    },
  })
  console.log('[seed-demo]   Created: categories -> products (ONE_TO_MANY)')

  // #6: products -> product_images (ONE_TO_MANY)
  await prisma.relationship.create({
    data: {
      whiteboardId: wbId,
      sourceTableId: tProducts.id,
      targetTableId: tProductImages.id,
      sourceColumnId: cProductsId.id,
      targetColumnId: cProductImagesProductId.id,
      cardinality: 'ONE_TO_MANY',
      label: 'has images',
    },
  })
  console.log('[seed-demo]   Created: products -> product_images (ONE_TO_MANY)')

  // #7: products -> inventory (ONE_TO_ONE)
  await prisma.relationship.create({
    data: {
      whiteboardId: wbId,
      sourceTableId: tProducts.id,
      targetTableId: tInventory.id,
      sourceColumnId: cProductsId.id,
      targetColumnId: cInventoryProductId.id,
      cardinality: 'ONE_TO_ONE',
      label: 'has inventory',
    },
  })
  console.log('[seed-demo]   Created: products -> inventory (ONE_TO_ONE)')

  // #8: products -> reviews (ZERO_TO_MANY)
  await prisma.relationship.create({
    data: {
      whiteboardId: wbId,
      sourceTableId: tProducts.id,
      targetTableId: tReviews.id,
      sourceColumnId: cProductsId.id,
      targetColumnId: cReviewsProductId.id,
      cardinality: 'ZERO_TO_MANY',
      label: 'may have reviews',
    },
  })
  console.log('[seed-demo]   Created: products -> reviews (ZERO_TO_MANY)')

  // #9: orders -> order_items (ONE_TO_MANY)
  await prisma.relationship.create({
    data: {
      whiteboardId: wbId,
      sourceTableId: tOrders.id,
      targetTableId: tOrderItems.id,
      sourceColumnId: cOrdersId.id,
      targetColumnId: cOrderItemsOrderId.id,
      cardinality: 'ONE_TO_MANY',
      label: 'contains items',
    },
  })
  console.log('[seed-demo]   Created: orders -> order_items (ONE_TO_MANY)')

  // #10: order_items -> products (MANY_TO_ONE)
  await prisma.relationship.create({
    data: {
      whiteboardId: wbId,
      sourceTableId: tOrderItems.id,
      targetTableId: tProducts.id,
      sourceColumnId: cOrderItemsProductId.id,
      targetColumnId: cProductsId.id,
      cardinality: 'MANY_TO_ONE',
      label: 'references product',
    },
  })
  console.log('[seed-demo]   Created: order_items -> products (MANY_TO_ONE)')

  // #11: orders -> payments (ZERO_TO_ONE)
  await prisma.relationship.create({
    data: {
      whiteboardId: wbId,
      sourceTableId: tOrders.id,
      targetTableId: tPayments.id,
      sourceColumnId: cOrdersId.id,
      targetColumnId: cPaymentsOrderId.id,
      cardinality: 'ZERO_TO_ONE',
      label: 'may have payment',
    },
  })
  console.log('[seed-demo]   Created: orders -> payments (ZERO_TO_ONE)')

  // #12: orders -> addresses (MANY_TO_ONE)
  await prisma.relationship.create({
    data: {
      whiteboardId: wbId,
      sourceTableId: tOrders.id,
      targetTableId: tAddresses.id,
      sourceColumnId: cOrdersShippingAddressId.id,
      targetColumnId: cAddressesId.id,
      cardinality: 'MANY_TO_ONE',
      label: 'ships to address',
    },
  })
  console.log('[seed-demo]   Created: orders -> addresses (MANY_TO_ONE)')

  // #13: products -> tags (MANY_TO_MANY, conceptual via product_tags)
  await prisma.relationship.create({
    data: {
      whiteboardId: wbId,
      sourceTableId: tProducts.id,
      targetTableId: tTags.id,
      sourceColumnId: cProductTagsProductId.id,
      targetColumnId: cProductTagsTagId.id,
      cardinality: 'MANY_TO_MANY',
      label: 'tagged with (via product_tags)',
    },
  })
  console.log('[seed-demo]   Created: products -> tags (MANY_TO_MANY)')

  // #14: products -> product_tags (ONE_TO_MANY, join table product side)
  await prisma.relationship.create({
    data: {
      whiteboardId: wbId,
      sourceTableId: tProducts.id,
      targetTableId: tProductTags.id,
      sourceColumnId: cProductsId.id,
      targetColumnId: cProductTagsProductId.id,
      cardinality: 'ONE_TO_MANY',
      label: 'join: product side',
    },
  })
  console.log('[seed-demo]   Created: products -> product_tags (ONE_TO_MANY)')

  // #15: tags -> product_tags (ONE_TO_MANY, join table tag side)
  await prisma.relationship.create({
    data: {
      whiteboardId: wbId,
      sourceTableId: tTags.id,
      targetTableId: tProductTags.id,
      sourceColumnId: cTagsId.id,
      targetColumnId: cProductTagsTagId.id,
      cardinality: 'ONE_TO_MANY',
      label: 'join: tag side',
    },
  })
  console.log('[seed-demo]   Created: tags -> product_tags (ONE_TO_MANY)')

  // #16: orders -> order_coupons (ONE_TO_MANY, join table order side)
  await prisma.relationship.create({
    data: {
      whiteboardId: wbId,
      sourceTableId: tOrders.id,
      targetTableId: tOrderCoupons.id,
      sourceColumnId: cOrdersId.id,
      targetColumnId: cOrderCouponsOrderId.id,
      cardinality: 'ONE_TO_MANY',
      label: 'join: order side',
    },
  })
  console.log('[seed-demo]   Created: orders -> order_coupons (ONE_TO_MANY)')

  // #17: coupons -> order_coupons (ONE_TO_MANY, join table coupon side)
  await prisma.relationship.create({
    data: {
      whiteboardId: wbId,
      sourceTableId: tCoupons.id,
      targetTableId: tOrderCoupons.id,
      sourceColumnId: cCouponsId.id,
      targetColumnId: cOrderCouponsCouponId.id,
      cardinality: 'ONE_TO_MANY',
      label: 'join: coupon side',
    },
  })
  console.log('[seed-demo]   Created: coupons -> order_coupons (ONE_TO_MANY)')

  // #18: orders -> coupons (MANY_TO_MANY, conceptual via order_coupons)
  await prisma.relationship.create({
    data: {
      whiteboardId: wbId,
      sourceTableId: tOrders.id,
      targetTableId: tCoupons.id,
      sourceColumnId: cOrderCouponsOrderId.id,
      targetColumnId: cOrderCouponsCouponId.id,
      cardinality: 'MANY_TO_MANY',
      label: 'uses coupons (via order_coupons)',
    },
  })
  console.log('[seed-demo]   Created: orders -> coupons (MANY_TO_MANY)')

  // ─── Step 6: Create "Cardinality Reference" Whiteboard ───────────────────
  console.log(
    '[seed-demo] Creating whiteboard "Cardinality Reference"...',
  )
  const refWb = await prisma.whiteboard.create({
    data: {
      name: 'Cardinality Reference',
      projectId: project.id,
    },
  })
  const refWbId = refWb.id

  // Grid layout: 2 rows × 5 columns, each cell 380px wide × 350px tall.
  // Source table at (x, y), target table at (x+180, y+100).
  //
  // Row 1 (y=50):  types 1-5  — x = 50, 430, 810, 1190, 1570
  // Row 2 (y=400): types 6-10 — x = 50, 430, 810, 1190, 1570

  const REF_ROWS: Array<{ x: number; y: number }> = [
    { x: 50, y: 50 },   // 1
    { x: 430, y: 50 },  // 2
    { x: 810, y: 50 },  // 3
    { x: 1190, y: 50 }, // 4
    { x: 1570, y: 50 }, // 5
    { x: 50, y: 400 },  // 6
    { x: 430, y: 400 }, // 7
    { x: 810, y: 400 }, // 8
    { x: 1190, y: 400 },// 9
    { x: 1570, y: 400 },// 10
  ]

  console.log('[seed-demo] Creating reference tables (20)...')

  // ── 1. MANY_TO_ZERO_OR_ONE: employees → departments ──────────────────────
  const tEmployees = await prisma.diagramTable.create({
    data: {
      whiteboardId: refWbId,
      name: 'employees',
      description: 'Employee records',
      positionX: REF_ROWS[0].x,
      positionY: REF_ROWS[0].y,
    },
  })
  const cEmployeesId = await prisma.column.create({
    data: {
      tableId: tEmployees.id,
      name: 'id',
      dataType: 'uuid',
      isPrimaryKey: true,
      isForeignKey: false,
      isUnique: true,
      isNullable: false,
      order: 0,
    },
  })
  const cEmployeesDepartmentId = await prisma.column.create({
    data: {
      tableId: tEmployees.id,
      name: 'department_id',
      dataType: 'uuid',
      isPrimaryKey: false,
      isForeignKey: true,
      isUnique: false,
      isNullable: true,
      description: 'Nullable FK to departments',
      order: 1,
    },
  })
  await prisma.column.create({
    data: {
      tableId: tEmployees.id,
      name: 'name',
      dataType: 'string',
      isPrimaryKey: false,
      isForeignKey: false,
      isUnique: false,
      isNullable: false,
      order: 2,
    },
  })

  const tDepartments = await prisma.diagramTable.create({
    data: {
      whiteboardId: refWbId,
      name: 'departments',
      description: 'Organizational departments',
      positionX: REF_ROWS[0].x + 180,
      positionY: REF_ROWS[0].y + 100,
    },
  })
  const cDepartmentsId = await prisma.column.create({
    data: {
      tableId: tDepartments.id,
      name: 'id',
      dataType: 'uuid',
      isPrimaryKey: true,
      isForeignKey: false,
      isUnique: true,
      isNullable: false,
      order: 0,
    },
  })
  await prisma.column.create({
    data: {
      tableId: tDepartments.id,
      name: 'name',
      dataType: 'string',
      isPrimaryKey: false,
      isForeignKey: false,
      isUnique: false,
      isNullable: false,
      order: 1,
    },
  })

  // ── 2. MANY_TO_ZERO_OR_MANY: students → courses ───────────────────────────
  const tStudents = await prisma.diagramTable.create({
    data: {
      whiteboardId: refWbId,
      name: 'students',
      description: 'Enrolled students',
      positionX: REF_ROWS[1].x,
      positionY: REF_ROWS[1].y,
    },
  })
  const cStudentsId = await prisma.column.create({
    data: {
      tableId: tStudents.id,
      name: 'id',
      dataType: 'uuid',
      isPrimaryKey: true,
      isForeignKey: false,
      isUnique: true,
      isNullable: false,
      order: 0,
    },
  })
  await prisma.column.create({
    data: {
      tableId: tStudents.id,
      name: 'name',
      dataType: 'string',
      isPrimaryKey: false,
      isForeignKey: false,
      isUnique: false,
      isNullable: false,
      order: 1,
    },
  })

  const tCourses = await prisma.diagramTable.create({
    data: {
      whiteboardId: refWbId,
      name: 'courses',
      description: 'Available courses',
      positionX: REF_ROWS[1].x + 180,
      positionY: REF_ROWS[1].y + 100,
    },
  })
  const cCoursesStudentId = await prisma.column.create({
    data: {
      tableId: tCourses.id,
      name: 'student_id',
      dataType: 'uuid',
      isPrimaryKey: false,
      isForeignKey: true,
      isUnique: false,
      isNullable: true,
      description: 'Nullable FK to students',
      order: 0,
    },
  })
  await prisma.column.create({
    data: {
      tableId: tCourses.id,
      name: 'title',
      dataType: 'string',
      isPrimaryKey: false,
      isForeignKey: false,
      isUnique: false,
      isNullable: false,
      order: 1,
    },
  })

  // ── 3. ZERO_OR_ONE_TO_ONE: profiles → users ───────────────────────────────
  const tProfiles = await prisma.diagramTable.create({
    data: {
      whiteboardId: refWbId,
      name: 'profiles',
      description: 'Optional user profiles',
      positionX: REF_ROWS[2].x,
      positionY: REF_ROWS[2].y,
    },
  })
  const cProfilesId = await prisma.column.create({
    data: {
      tableId: tProfiles.id,
      name: 'id',
      dataType: 'uuid',
      isPrimaryKey: true,
      isForeignKey: false,
      isUnique: true,
      isNullable: false,
      order: 0,
    },
  })
  const cProfilesUserId = await prisma.column.create({
    data: {
      tableId: tProfiles.id,
      name: 'user_id',
      dataType: 'uuid',
      isPrimaryKey: false,
      isForeignKey: true,
      isUnique: false,
      isNullable: true,
      description: 'Nullable FK to users',
      order: 1,
    },
  })
  await prisma.column.create({
    data: {
      tableId: tProfiles.id,
      name: 'bio',
      dataType: 'string',
      isPrimaryKey: false,
      isForeignKey: false,
      isUnique: false,
      isNullable: false,
      order: 2,
    },
  })

  const tUsers = await prisma.diagramTable.create({
    data: {
      whiteboardId: refWbId,
      name: 'users',
      description: 'System users',
      positionX: REF_ROWS[2].x + 180,
      positionY: REF_ROWS[2].y + 100,
    },
  })
  const cUsersId = await prisma.column.create({
    data: {
      tableId: tUsers.id,
      name: 'id',
      dataType: 'uuid',
      isPrimaryKey: true,
      isForeignKey: false,
      isUnique: true,
      isNullable: false,
      order: 0,
    },
  })
  await prisma.column.create({
    data: {
      tableId: tUsers.id,
      name: 'username',
      dataType: 'string',
      isPrimaryKey: false,
      isForeignKey: false,
      isUnique: false,
      isNullable: false,
      order: 1,
    },
  })

  // ── 4. ZERO_OR_ONE_TO_MANY: managers → teams ──────────────────────────────
  const tManagers = await prisma.diagramTable.create({
    data: {
      whiteboardId: refWbId,
      name: 'managers',
      description: 'Team managers',
      positionX: REF_ROWS[3].x,
      positionY: REF_ROWS[3].y,
    },
  })
  const cManagersId = await prisma.column.create({
    data: {
      tableId: tManagers.id,
      name: 'id',
      dataType: 'uuid',
      isPrimaryKey: true,
      isForeignKey: false,
      isUnique: true,
      isNullable: false,
      order: 0,
    },
  })
  await prisma.column.create({
    data: {
      tableId: tManagers.id,
      name: 'name',
      dataType: 'string',
      isPrimaryKey: false,
      isForeignKey: false,
      isUnique: false,
      isNullable: false,
      order: 1,
    },
  })

  const tTeams = await prisma.diagramTable.create({
    data: {
      whiteboardId: refWbId,
      name: 'teams',
      description: 'Work teams',
      positionX: REF_ROWS[3].x + 180,
      positionY: REF_ROWS[3].y + 100,
    },
  })
  const cTeamsManagerId = await prisma.column.create({
    data: {
      tableId: tTeams.id,
      name: 'manager_id',
      dataType: 'uuid',
      isPrimaryKey: false,
      isForeignKey: true,
      isUnique: false,
      isNullable: false,
      description: 'FK to managers',
      order: 0,
    },
  })
  await prisma.column.create({
    data: {
      tableId: tTeams.id,
      name: 'name',
      dataType: 'string',
      isPrimaryKey: false,
      isForeignKey: false,
      isUnique: false,
      isNullable: false,
      order: 1,
    },
  })

  // ── 5. ZERO_OR_ONE_TO_ZERO_OR_ONE: passports → citizens ───────────────────
  const tPassports = await prisma.diagramTable.create({
    data: {
      whiteboardId: refWbId,
      name: 'passports',
      description: 'Passport documents',
      positionX: REF_ROWS[4].x,
      positionY: REF_ROWS[4].y,
    },
  })
  const cPassportsId = await prisma.column.create({
    data: {
      tableId: tPassports.id,
      name: 'id',
      dataType: 'uuid',
      isPrimaryKey: true,
      isForeignKey: false,
      isUnique: true,
      isNullable: false,
      order: 0,
    },
  })
  const cPassportsCitizenId = await prisma.column.create({
    data: {
      tableId: tPassports.id,
      name: 'citizen_id',
      dataType: 'uuid',
      isPrimaryKey: false,
      isForeignKey: true,
      isUnique: false,
      isNullable: true,
      description: 'Nullable FK to citizens',
      order: 1,
    },
  })
  await prisma.column.create({
    data: {
      tableId: tPassports.id,
      name: 'number',
      dataType: 'string',
      isPrimaryKey: false,
      isForeignKey: false,
      isUnique: false,
      isNullable: false,
      order: 2,
    },
  })

  const tCitizens = await prisma.diagramTable.create({
    data: {
      whiteboardId: refWbId,
      name: 'citizens',
      description: 'Citizen records',
      positionX: REF_ROWS[4].x + 180,
      positionY: REF_ROWS[4].y + 100,
    },
  })
  const cCitizensId = await prisma.column.create({
    data: {
      tableId: tCitizens.id,
      name: 'id',
      dataType: 'uuid',
      isPrimaryKey: true,
      isForeignKey: false,
      isUnique: true,
      isNullable: false,
      order: 0,
    },
  })
  await prisma.column.create({
    data: {
      tableId: tCitizens.id,
      name: 'name',
      dataType: 'string',
      isPrimaryKey: false,
      isForeignKey: false,
      isUnique: false,
      isNullable: false,
      order: 1,
    },
  })

  // ── 6. ZERO_OR_ONE_TO_ZERO_OR_MANY: campaigns → leads ────────────────────
  const tCampaigns = await prisma.diagramTable.create({
    data: {
      whiteboardId: refWbId,
      name: 'campaigns',
      description: 'Marketing campaigns',
      positionX: REF_ROWS[5].x,
      positionY: REF_ROWS[5].y,
    },
  })
  const cCampaignsId = await prisma.column.create({
    data: {
      tableId: tCampaigns.id,
      name: 'id',
      dataType: 'uuid',
      isPrimaryKey: true,
      isForeignKey: false,
      isUnique: true,
      isNullable: false,
      order: 0,
    },
  })
  await prisma.column.create({
    data: {
      tableId: tCampaigns.id,
      name: 'title',
      dataType: 'string',
      isPrimaryKey: false,
      isForeignKey: false,
      isUnique: false,
      isNullable: false,
      order: 1,
    },
  })

  const tLeads = await prisma.diagramTable.create({
    data: {
      whiteboardId: refWbId,
      name: 'leads',
      description: 'Sales leads',
      positionX: REF_ROWS[5].x + 180,
      positionY: REF_ROWS[5].y + 100,
    },
  })
  const cLeadsCampaignId = await prisma.column.create({
    data: {
      tableId: tLeads.id,
      name: 'campaign_id',
      dataType: 'uuid',
      isPrimaryKey: false,
      isForeignKey: true,
      isUnique: false,
      isNullable: true,
      description: 'Nullable FK to campaigns',
      order: 0,
    },
  })
  await prisma.column.create({
    data: {
      tableId: tLeads.id,
      name: 'name',
      dataType: 'string',
      isPrimaryKey: false,
      isForeignKey: false,
      isUnique: false,
      isNullable: false,
      order: 1,
    },
  })

  // ── 7. ZERO_OR_MANY_TO_ONE: comments → posts ─────────────────────────────
  const tComments = await prisma.diagramTable.create({
    data: {
      whiteboardId: refWbId,
      name: 'comments',
      description: 'Post comments',
      positionX: REF_ROWS[6].x,
      positionY: REF_ROWS[6].y,
    },
  })
  const cCommentsId = await prisma.column.create({
    data: {
      tableId: tComments.id,
      name: 'id',
      dataType: 'uuid',
      isPrimaryKey: true,
      isForeignKey: false,
      isUnique: true,
      isNullable: false,
      order: 0,
    },
  })
  const cCommentsPostId = await prisma.column.create({
    data: {
      tableId: tComments.id,
      name: 'post_id',
      dataType: 'uuid',
      isPrimaryKey: false,
      isForeignKey: true,
      isUnique: false,
      isNullable: false,
      description: 'FK to posts',
      order: 1,
    },
  })
  await prisma.column.create({
    data: {
      tableId: tComments.id,
      name: 'body',
      dataType: 'string',
      isPrimaryKey: false,
      isForeignKey: false,
      isUnique: false,
      isNullable: false,
      order: 2,
    },
  })

  const tPosts = await prisma.diagramTable.create({
    data: {
      whiteboardId: refWbId,
      name: 'posts',
      description: 'Blog posts',
      positionX: REF_ROWS[6].x + 180,
      positionY: REF_ROWS[6].y + 100,
    },
  })
  const cPostsId = await prisma.column.create({
    data: {
      tableId: tPosts.id,
      name: 'id',
      dataType: 'uuid',
      isPrimaryKey: true,
      isForeignKey: false,
      isUnique: true,
      isNullable: false,
      order: 0,
    },
  })
  await prisma.column.create({
    data: {
      tableId: tPosts.id,
      name: 'title',
      dataType: 'string',
      isPrimaryKey: false,
      isForeignKey: false,
      isUnique: false,
      isNullable: false,
      order: 1,
    },
  })

  // ── 8. ZERO_OR_MANY_TO_MANY: tickets → agents ────────────────────────────
  const tTickets = await prisma.diagramTable.create({
    data: {
      whiteboardId: refWbId,
      name: 'tickets',
      description: 'Support tickets',
      positionX: REF_ROWS[7].x,
      positionY: REF_ROWS[7].y,
    },
  })
  const cTicketsId = await prisma.column.create({
    data: {
      tableId: tTickets.id,
      name: 'id',
      dataType: 'uuid',
      isPrimaryKey: true,
      isForeignKey: false,
      isUnique: true,
      isNullable: false,
      order: 0,
    },
  })
  const cTicketsAgentId = await prisma.column.create({
    data: {
      tableId: tTickets.id,
      name: 'agent_id',
      dataType: 'uuid',
      isPrimaryKey: false,
      isForeignKey: true,
      isUnique: false,
      isNullable: true,
      description: 'Nullable FK to agents',
      order: 1,
    },
  })
  await prisma.column.create({
    data: {
      tableId: tTickets.id,
      name: 'title',
      dataType: 'string',
      isPrimaryKey: false,
      isForeignKey: false,
      isUnique: false,
      isNullable: false,
      order: 2,
    },
  })

  const tAgents = await prisma.diagramTable.create({
    data: {
      whiteboardId: refWbId,
      name: 'agents',
      description: 'Support agents',
      positionX: REF_ROWS[7].x + 180,
      positionY: REF_ROWS[7].y + 100,
    },
  })
  const cAgentsId = await prisma.column.create({
    data: {
      tableId: tAgents.id,
      name: 'id',
      dataType: 'uuid',
      isPrimaryKey: true,
      isForeignKey: false,
      isUnique: true,
      isNullable: false,
      order: 0,
    },
  })
  await prisma.column.create({
    data: {
      tableId: tAgents.id,
      name: 'name',
      dataType: 'string',
      isPrimaryKey: false,
      isForeignKey: false,
      isUnique: false,
      isNullable: false,
      order: 1,
    },
  })

  // ── 9. ZERO_OR_MANY_TO_ZERO_OR_ONE: bookings → rooms ─────────────────────
  const tBookings = await prisma.diagramTable.create({
    data: {
      whiteboardId: refWbId,
      name: 'bookings',
      description: 'Room bookings',
      positionX: REF_ROWS[8].x,
      positionY: REF_ROWS[8].y,
    },
  })
  const cBookingsId = await prisma.column.create({
    data: {
      tableId: tBookings.id,
      name: 'id',
      dataType: 'uuid',
      isPrimaryKey: true,
      isForeignKey: false,
      isUnique: true,
      isNullable: false,
      order: 0,
    },
  })
  const cBookingsRoomId = await prisma.column.create({
    data: {
      tableId: tBookings.id,
      name: 'room_id',
      dataType: 'uuid',
      isPrimaryKey: false,
      isForeignKey: true,
      isUnique: false,
      isNullable: true,
      description: 'Nullable FK to rooms',
      order: 1,
    },
  })
  await prisma.column.create({
    data: {
      tableId: tBookings.id,
      name: 'title',
      dataType: 'string',
      isPrimaryKey: false,
      isForeignKey: false,
      isUnique: false,
      isNullable: false,
      order: 2,
    },
  })

  const tRooms = await prisma.diagramTable.create({
    data: {
      whiteboardId: refWbId,
      name: 'rooms',
      description: 'Available rooms',
      positionX: REF_ROWS[8].x + 180,
      positionY: REF_ROWS[8].y + 100,
    },
  })
  const cRoomsId = await prisma.column.create({
    data: {
      tableId: tRooms.id,
      name: 'id',
      dataType: 'uuid',
      isPrimaryKey: true,
      isForeignKey: false,
      isUnique: true,
      isNullable: false,
      order: 0,
    },
  })
  await prisma.column.create({
    data: {
      tableId: tRooms.id,
      name: 'name',
      dataType: 'string',
      isPrimaryKey: false,
      isForeignKey: false,
      isUnique: false,
      isNullable: false,
      order: 1,
    },
  })

  // ── 10. ZERO_OR_MANY_TO_ZERO_OR_MANY: projects → skills ──────────────────
  const tRefProjects = await prisma.diagramTable.create({
    data: {
      whiteboardId: refWbId,
      name: 'projects',
      description: 'Work projects',
      positionX: REF_ROWS[9].x,
      positionY: REF_ROWS[9].y,
    },
  })
  const cRefProjectsId = await prisma.column.create({
    data: {
      tableId: tRefProjects.id,
      name: 'id',
      dataType: 'uuid',
      isPrimaryKey: true,
      isForeignKey: false,
      isUnique: true,
      isNullable: false,
      order: 0,
    },
  })
  await prisma.column.create({
    data: {
      tableId: tRefProjects.id,
      name: 'name',
      dataType: 'string',
      isPrimaryKey: false,
      isForeignKey: false,
      isUnique: false,
      isNullable: false,
      order: 1,
    },
  })

  const tSkills = await prisma.diagramTable.create({
    data: {
      whiteboardId: refWbId,
      name: 'skills',
      description: 'Skill definitions',
      positionX: REF_ROWS[9].x + 180,
      positionY: REF_ROWS[9].y + 100,
    },
  })
  const cSkillsProjectId = await prisma.column.create({
    data: {
      tableId: tSkills.id,
      name: 'project_id',
      dataType: 'uuid',
      isPrimaryKey: false,
      isForeignKey: true,
      isUnique: false,
      isNullable: true,
      description: 'Nullable FK to projects',
      order: 0,
    },
  })
  await prisma.column.create({
    data: {
      tableId: tSkills.id,
      name: 'name',
      dataType: 'string',
      isPrimaryKey: false,
      isForeignKey: false,
      isUnique: false,
      isNullable: false,
      order: 1,
    },
  })

  console.log('[seed-demo]   Created 20 reference tables with columns')

  // ─── Step 7: Create Reference Relationships (10) ──────────────────────────
  console.log('[seed-demo] Creating reference relationships (10)...')

  // R1: MANY_TO_ZERO_OR_ONE — employees.department_id → departments.id
  await prisma.relationship.create({
    data: {
      whiteboardId: refWbId,
      sourceTableId: tEmployees.id,
      targetTableId: tDepartments.id,
      sourceColumnId: cEmployeesDepartmentId.id,
      targetColumnId: cDepartmentsId.id,
      cardinality: 'MANY_TO_ZERO_OR_ONE',
      label: 'MANY_TO_ZERO_OR_ONE',
    },
  })
  console.log('[seed-demo]   R1: employees -> departments (MANY_TO_ZERO_OR_ONE)')

  // R2: MANY_TO_ZERO_OR_MANY — students.id → courses.student_id
  await prisma.relationship.create({
    data: {
      whiteboardId: refWbId,
      sourceTableId: tStudents.id,
      targetTableId: tCourses.id,
      sourceColumnId: cStudentsId.id,
      targetColumnId: cCoursesStudentId.id,
      cardinality: 'MANY_TO_ZERO_OR_MANY',
      label: 'MANY_TO_ZERO_OR_MANY',
    },
  })
  console.log('[seed-demo]   R2: students -> courses (MANY_TO_ZERO_OR_MANY)')

  // R3: ZERO_OR_ONE_TO_ONE — profiles.user_id → users.id
  await prisma.relationship.create({
    data: {
      whiteboardId: refWbId,
      sourceTableId: tProfiles.id,
      targetTableId: tUsers.id,
      sourceColumnId: cProfilesUserId.id,
      targetColumnId: cUsersId.id,
      cardinality: 'ZERO_OR_ONE_TO_ONE',
      label: 'ZERO_OR_ONE_TO_ONE',
    },
  })
  console.log('[seed-demo]   R3: profiles -> users (ZERO_OR_ONE_TO_ONE)')

  // R4: ZERO_OR_ONE_TO_MANY — managers.id → teams.manager_id
  await prisma.relationship.create({
    data: {
      whiteboardId: refWbId,
      sourceTableId: tManagers.id,
      targetTableId: tTeams.id,
      sourceColumnId: cManagersId.id,
      targetColumnId: cTeamsManagerId.id,
      cardinality: 'ZERO_OR_ONE_TO_MANY',
      label: 'ZERO_OR_ONE_TO_MANY',
    },
  })
  console.log('[seed-demo]   R4: managers -> teams (ZERO_OR_ONE_TO_MANY)')

  // R5: ZERO_OR_ONE_TO_ZERO_OR_ONE — passports.citizen_id → citizens.id
  await prisma.relationship.create({
    data: {
      whiteboardId: refWbId,
      sourceTableId: tPassports.id,
      targetTableId: tCitizens.id,
      sourceColumnId: cPassportsCitizenId.id,
      targetColumnId: cCitizensId.id,
      cardinality: 'ZERO_OR_ONE_TO_ZERO_OR_ONE',
      label: 'ZERO_OR_ONE_TO_ZERO_OR_ONE',
    },
  })
  console.log(
    '[seed-demo]   R5: passports -> citizens (ZERO_OR_ONE_TO_ZERO_OR_ONE)',
  )

  // R6: ZERO_OR_ONE_TO_ZERO_OR_MANY — campaigns.id → leads.campaign_id
  await prisma.relationship.create({
    data: {
      whiteboardId: refWbId,
      sourceTableId: tCampaigns.id,
      targetTableId: tLeads.id,
      sourceColumnId: cCampaignsId.id,
      targetColumnId: cLeadsCampaignId.id,
      cardinality: 'ZERO_OR_ONE_TO_ZERO_OR_MANY',
      label: 'ZERO_OR_ONE_TO_ZERO_OR_MANY',
    },
  })
  console.log(
    '[seed-demo]   R6: campaigns -> leads (ZERO_OR_ONE_TO_ZERO_OR_MANY)',
  )

  // R7: ZERO_OR_MANY_TO_ONE — comments.post_id → posts.id
  await prisma.relationship.create({
    data: {
      whiteboardId: refWbId,
      sourceTableId: tComments.id,
      targetTableId: tPosts.id,
      sourceColumnId: cCommentsPostId.id,
      targetColumnId: cPostsId.id,
      cardinality: 'ZERO_OR_MANY_TO_ONE',
      label: 'ZERO_OR_MANY_TO_ONE',
    },
  })
  console.log('[seed-demo]   R7: comments -> posts (ZERO_OR_MANY_TO_ONE)')

  // R8: ZERO_OR_MANY_TO_MANY — tickets.agent_id → agents.id
  await prisma.relationship.create({
    data: {
      whiteboardId: refWbId,
      sourceTableId: tTickets.id,
      targetTableId: tAgents.id,
      sourceColumnId: cTicketsAgentId.id,
      targetColumnId: cAgentsId.id,
      cardinality: 'ZERO_OR_MANY_TO_MANY',
      label: 'ZERO_OR_MANY_TO_MANY',
    },
  })
  console.log('[seed-demo]   R8: tickets -> agents (ZERO_OR_MANY_TO_MANY)')

  // R9: ZERO_OR_MANY_TO_ZERO_OR_ONE — bookings.room_id → rooms.id
  await prisma.relationship.create({
    data: {
      whiteboardId: refWbId,
      sourceTableId: tBookings.id,
      targetTableId: tRooms.id,
      sourceColumnId: cBookingsRoomId.id,
      targetColumnId: cRoomsId.id,
      cardinality: 'ZERO_OR_MANY_TO_ZERO_OR_ONE',
      label: 'ZERO_OR_MANY_TO_ZERO_OR_ONE',
    },
  })
  console.log(
    '[seed-demo]   R9: bookings -> rooms (ZERO_OR_MANY_TO_ZERO_OR_ONE)',
  )

  // R10: ZERO_OR_MANY_TO_ZERO_OR_MANY — projects.id → skills.project_id
  await prisma.relationship.create({
    data: {
      whiteboardId: refWbId,
      sourceTableId: tRefProjects.id,
      targetTableId: tSkills.id,
      sourceColumnId: cRefProjectsId.id,
      targetColumnId: cSkillsProjectId.id,
      cardinality: 'ZERO_OR_MANY_TO_ZERO_OR_MANY',
      label: 'ZERO_OR_MANY_TO_ZERO_OR_MANY',
    },
  })
  console.log(
    '[seed-demo]   R10: projects -> skills (ZERO_OR_MANY_TO_ZERO_OR_MANY)',
  )

  // Suppress unused variable warnings for reference whiteboard columns
  void cEmployeesId
  void cProfilesId
  void cPassportsId
  void cCommentsId
  void cTicketsId
  void cBookingsId

  // ─── Summary ─────────────────────────────────────────────────────────────
  console.log('[seed-demo] ----------------------------------------')
  console.log('[seed-demo] Demo seeded successfully!')
  console.log(
    `[seed-demo]   Project:                  E-Commerce Demo (${project.id})`,
  )
  console.log(
    `[seed-demo]   Whiteboard 1:             E-Commerce Platform Schema (${whiteboard.id})`,
  )
  console.log(
    `[seed-demo]   Whiteboard 2:             Cardinality Reference (${refWb.id})`,
  )
  console.log('[seed-demo]   Whiteboards:              2')
  console.log('[seed-demo]   E-commerce tables:        14')
  console.log('[seed-demo]   E-commerce columns:       ~85')
  console.log('[seed-demo]   E-commerce relationships: 18')
  console.log('[seed-demo]   Reference tables:         20')
  console.log('[seed-demo]   Reference relationships:  10')
  console.log('[seed-demo] ----------------------------------------')
}

main()
  .catch((e) => {
    console.error('[seed-demo] Error during seeding:', e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
