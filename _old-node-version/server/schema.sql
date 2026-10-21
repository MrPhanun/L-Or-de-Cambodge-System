/* L'Or de Cambodge - SQL Server schema (run by `npm run setup-db`).  Batches are separated by GO lines. */

CREATE TABLE Roles (
  role_id   INT           NOT NULL PRIMARY KEY,
  name      NVARCHAR(20)  NOT NULL UNIQUE          -- client | seller | tailor | manager | admin
);
GO
CREATE TABLE Permissions (
  code      NVARCHAR(40)  NOT NULL PRIMARY KEY,
  label     NVARCHAR(80)  NOT NULL
);
GO
CREATE TABLE RolePermissions (
  role_id   INT           NOT NULL REFERENCES Roles(role_id),
  code      NVARCHAR(40)  NOT NULL REFERENCES Permissions(code),
  PRIMARY KEY (role_id, code)
);
GO
CREATE TABLE Users (
  user_id         INT IDENTITY(1,1) PRIMARY KEY,
  role_id         INT            NOT NULL REFERENCES Roles(role_id),
  name            NVARCHAR(100)  NOT NULL,
  email           NVARCHAR(150)  NOT NULL UNIQUE,
  phone           NVARCHAR(30)   NULL,
  address         NVARCHAR(250)  NULL,
  pass_hash       VARCHAR(256)   NOT NULL,           -- scrypt hash (hex)
  pass_salt       VARCHAR(64)    NOT NULL,
  pin_hash        VARCHAR(256)   NULL,               -- staff PIN, hashed the same way
  pin_salt        VARCHAR(64)    NULL,
  active          BIT            NOT NULL DEFAULT 1,
  discount_limit  DECIMAL(5,2)   NULL,               -- max manual discount %, NULL = shop default
  commission_pct  DECIMAL(5,2)   NOT NULL DEFAULT 0,
  loyalty_points  INT            NOT NULL DEFAULT 0,
  failed_logins   INT            NOT NULL DEFAULT 0,
  locked_until    DATETIME2      NULL,
  created_at      DATETIME2      NOT NULL DEFAULT SYSUTCDATETIME()
);
GO
CREATE TABLE UserPermissions (                        -- per-user overrides on top of the role's permissions
  user_id   INT           NOT NULL REFERENCES Users(user_id) ON DELETE CASCADE,
  code      NVARCHAR(40)  NOT NULL REFERENCES Permissions(code),
  granted   BIT           NOT NULL,
  PRIMARY KEY (user_id, code)
);
GO
CREATE TABLE Sessions (
  token_hash  CHAR(64)       NOT NULL PRIMARY KEY,    -- sha256 of the cookie token (token itself is never stored)
  user_id     INT            NOT NULL REFERENCES Users(user_id) ON DELETE CASCADE,
  created_at  DATETIME2      NOT NULL DEFAULT SYSUTCDATETIME(),
  expires_at  DATETIME2      NOT NULL,
  ip          VARCHAR(64)    NULL,
  user_agent  NVARCHAR(200)  NULL
);
GO
CREATE TABLE Measurements (
  user_id    INT PRIMARY KEY REFERENCES Users(user_id) ON DELETE CASCADE,
  chest DECIMAL(5,1) NULL, waist DECIMAL(5,1) NULL, shoulder DECIMAL(5,1) NULL,
  sleeve DECIMAL(5,1) NULL, inseam DECIMAL(5,1) NULL, neck DECIMAL(5,1) NULL,
  updated_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
);
GO
CREATE TABLE Categories (
  category_id INT IDENTITY(1,1) PRIMARY KEY,
  name        NVARCHAR(50)  NOT NULL UNIQUE,
  sizes       NVARCHAR(200) NOT NULL                  -- comma-separated size list used for new variants
);
GO
CREATE TABLE Products (
  product_id    INT IDENTITY(1,1) PRIMARY KEY,
  sku           NVARCHAR(30)  NOT NULL UNIQUE,
  barcode       NVARCHAR(30)  NULL,
  category_id   INT           NOT NULL REFERENCES Categories(category_id),
  name          NVARCHAR(150) NOT NULL,
  description   NVARCHAR(600) NULL,
  fabric        NVARCHAR(30)  NULL,
  fit           NVARCHAR(20)  NULL,                   -- Slim | Regular | Classic
  color_name    NVARCHAR(40)  NULL,
  color_hex     CHAR(7)       NOT NULL DEFAULT '#1d2a52',
  price         DECIMAL(10,2) NOT NULL CHECK (price >= 0),
  cost          DECIMAL(10,2) NOT NULL DEFAULT 0 CHECK (cost >= 0),
  rent_per_day  DECIMAL(10,2) NOT NULL DEFAULT 0,     -- 0 = not rentable
  rent_deposit  DECIMAL(10,2) NOT NULL DEFAULT 0,
  image_url     NVARCHAR(MAX) NULL,                   -- optional uploaded image (data URL)
  tailorable    BIT           NOT NULL DEFAULT 0,
  active        BIT           NOT NULL DEFAULT 1,
  created_at    DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME()
);
GO
CREATE TABLE ProductVariants (
  variant_id  INT IDENTITY(1,1) PRIMARY KEY,
  product_id  INT           NOT NULL REFERENCES Products(product_id) ON DELETE CASCADE,
  size        NVARCHAR(20)  NOT NULL,
  stock       INT           NOT NULL DEFAULT 0 CHECK (stock >= 0),
  CONSTRAINT UQ_variant UNIQUE (product_id, size)
);
GO
CREATE TABLE Suppliers (
  supplier_id INT IDENTITY(1,1) PRIMARY KEY,
  name        NVARCHAR(120) NOT NULL,
  phone       NVARCHAR(30)  NULL,
  email       NVARCHAR(150) NULL
);
GO
CREATE TABLE PurchaseOrders (
  po_id        INT IDENTITY(1,1) PRIMARY KEY,
  po_no        NVARCHAR(20)  NULL,
  supplier_id  INT           NOT NULL REFERENCES Suppliers(supplier_id),
  status       NVARCHAR(12)  NOT NULL DEFAULT 'Ordered',   -- Ordered | Received | Cancelled
  note         NVARCHAR(250) NULL,
  created_by   INT           NULL REFERENCES Users(user_id),
  created_at   DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME(),
  received_at  DATETIME2     NULL
);
GO
CREATE TABLE PurchaseOrderItems (
  po_item_id  INT IDENTITY(1,1) PRIMARY KEY,
  po_id       INT           NOT NULL REFERENCES PurchaseOrders(po_id) ON DELETE CASCADE,
  variant_id  INT           NOT NULL REFERENCES ProductVariants(variant_id),
  qty         INT           NOT NULL CHECK (qty > 0),
  unit_cost   DECIMAL(10,2) NOT NULL
);
GO
CREATE TABLE StockMovements (
  movement_id INT IDENTITY(1,1) PRIMARY KEY,
  variant_id  INT           NOT NULL REFERENCES ProductVariants(variant_id) ON DELETE CASCADE,
  qty         INT           NOT NULL,                 -- + in / - out
  type        NVARCHAR(20)  NOT NULL,                 -- sale | refund | cancel | purchase | adjust | rental-out | rental-in | exchange-in | exchange-out
  ref         NVARCHAR(40)  NULL,
  user_id     INT           NULL,
  at          DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME()
);
GO
CREATE TABLE PromoCodes (
  promo_id INT IDENTITY(1,1) PRIMARY KEY,
  code     NVARCHAR(30)  NOT NULL UNIQUE,
  pct      DECIMAL(5,2)  NOT NULL CHECK (pct > 0 AND pct <= 100),
  active   BIT           NOT NULL DEFAULT 1,
  note     NVARCHAR(120) NULL,
  expires_on DATE        NULL
);
GO
CREATE TABLE SeasonalSales (
  sale_id     INT IDENTITY(1,1) PRIMARY KEY,
  name        NVARCHAR(80)  NOT NULL,
  pct         DECIMAL(5,2)  NOT NULL CHECK (pct > 0 AND pct <= 100),
  category_id INT           NULL REFERENCES Categories(category_id),   -- NULL = whole store
  date_from   DATE          NOT NULL,
  date_to     DATE          NOT NULL,
  active      BIT           NOT NULL DEFAULT 1
);
GO
CREATE TABLE Bundles (
  bundle_id INT IDENTITY(1,1) PRIMARY KEY,
  name      NVARCHAR(80)  NOT NULL,
  pct       DECIMAL(5,2)  NOT NULL CHECK (pct > 0 AND pct <= 100),
  active    BIT           NOT NULL DEFAULT 1
);
GO
CREATE TABLE BundleCategories (
  bundle_id   INT NOT NULL REFERENCES Bundles(bundle_id) ON DELETE CASCADE,
  category_id INT NOT NULL REFERENCES Categories(category_id),
  PRIMARY KEY (bundle_id, category_id)
);
GO
CREATE TABLE Orders (
  order_id         INT IDENTITY(1,1) PRIMARY KEY,
  order_no         NVARCHAR(20)  NULL UNIQUE,
  channel          NVARCHAR(10)  NOT NULL,            -- online | pos
  customer_id      INT           NULL REFERENCES Users(user_id),
  customer_name    NVARCHAR(100) NOT NULL,
  seller_id        INT           NULL REFERENCES Users(user_id),
  tailor_id        INT           NULL REFERENCES Users(user_id),
  status           NVARCHAR(12)  NOT NULL,            -- Pending | Tailoring | Ready | Picked Up | Delivered | Returned | Cancelled
  fulfilment       NVARCHAR(10)  NOT NULL,            -- instore | pickup | delivery
  address          NVARCHAR(250) NULL,
  note             NVARCHAR(500) NULL,
  subtotal         DECIMAL(10,2) NOT NULL,
  bundle_discount  DECIMAL(10,2) NOT NULL DEFAULT 0,
  bundle_names     NVARCHAR(250) NULL,
  discount_pct     DECIMAL(5,2)  NOT NULL DEFAULT 0,
  discount         DECIMAL(10,2) NOT NULL DEFAULT 0,
  promo_code       NVARCHAR(30)  NULL,
  points_value     DECIMAL(10,2) NOT NULL DEFAULT 0,
  redeemed_points  INT           NOT NULL DEFAULT 0,
  points_awarded   INT           NULL,
  tax              DECIMAL(10,2) NOT NULL DEFAULT 0,
  deposit          DECIMAL(10,2) NOT NULL DEFAULT 0,  -- rental deposit
  total            DECIMAL(10,2) NOT NULL,
  has_tailor       BIT           NOT NULL DEFAULT 0,
  has_rental       BIT           NOT NULL DEFAULT 0,
  reminded_at      DATETIME2     NULL,
  created_at       DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME()
);
GO
CREATE TABLE OrderItems (
  item_id       INT IDENTITY(1,1) PRIMARY KEY,
  order_id      INT           NOT NULL REFERENCES Orders(order_id) ON DELETE CASCADE,
  product_id    INT           NOT NULL REFERENCES Products(product_id),
  variant_id    INT           NULL REFERENCES ProductVariants(variant_id),   -- NULL for made-to-order items
  name          NVARCHAR(150) NOT NULL,
  category      NVARCHAR(50)  NULL,
  fabric        NVARCHAR(30)  NULL,
  fit           NVARCHAR(20)  NULL,
  color_name    NVARCHAR(40)  NULL,
  size          NVARCHAR(20)  NOT NULL,
  qty           INT           NOT NULL CHECK (qty > 0),
  unit_price    DECIMAL(10,2) NOT NULL,
  unit_cost     DECIMAL(10,2) NOT NULL DEFAULT 0,
  kind          NVARCHAR(6)   NOT NULL,               -- buy | rent | tailor
  rent_from     DATE          NULL,
  rent_to       DATE          NULL,
  rent_days     INT           NULL,
  deposit       DECIMAL(10,2) NOT NULL DEFAULT 0,
  tailor_fabric NVARCHAR(30)  NULL,
  tailor_style  NVARCHAR(60)  NULL,
  tailor_fit    NVARCHAR(20)  NULL,
  tailor_notes  NVARCHAR(500) NULL
);
GO
CREATE TABLE CashShifts (
  shift_id      INT IDENTITY(1,1) PRIMARY KEY,
  user_id       INT           NOT NULL REFERENCES Users(user_id),
  opened_at     DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME(),
  closed_at     DATETIME2     NULL,
  float_amount  DECIMAL(10,2) NOT NULL DEFAULT 0,
  expected      DECIMAL(10,2) NULL,
  counted       DECIMAL(10,2) NULL,
  variance      DECIMAL(10,2) NULL,
  note          NVARCHAR(250) NULL
);
GO
CREATE TABLE OrderPayments (
  payment_id  INT IDENTITY(1,1) PRIMARY KEY,
  order_id    INT           NOT NULL REFERENCES Orders(order_id) ON DELETE CASCADE,
  method      NVARCHAR(20)  NOT NULL,                 -- Cash | Card | ABA Pay | KHQR | ...
  amount      DECIMAL(10,2) NOT NULL CHECK (amount > 0),
  kind        NVARCHAR(10)  NOT NULL DEFAULT 'payment', -- payment | deposit
  shift_id    INT           NULL REFERENCES CashShifts(shift_id),
  user_id     INT           NULL,
  at          DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME()
);
GO
CREATE TABLE OrderStatusHistory (
  id        INT IDENTITY(1,1) PRIMARY KEY,
  order_id  INT           NOT NULL REFERENCES Orders(order_id) ON DELETE CASCADE,
  status    NVARCHAR(12)  NOT NULL,
  by_name   NVARCHAR(100) NULL,
  at        DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME()
);
GO
CREATE TABLE OrderRefunds (
  refund_id INT IDENTITY(1,1) PRIMARY KEY,
  order_id  INT           NOT NULL REFERENCES Orders(order_id) ON DELETE CASCADE,
  amount    DECIMAL(10,2) NOT NULL,
  reason    NVARCHAR(250) NOT NULL,
  method    NVARCHAR(20)  NOT NULL,
  shift_id  INT           NULL REFERENCES CashShifts(shift_id),
  user_id   INT           NULL,
  by_name   NVARCHAR(100) NULL,
  at        DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME()
);
GO
CREATE TABLE OrderRefundLines (
  id        INT IDENTITY(1,1) PRIMARY KEY,
  refund_id INT NOT NULL REFERENCES OrderRefunds(refund_id) ON DELETE CASCADE,
  item_id   INT NOT NULL REFERENCES OrderItems(item_id),
  qty       INT NOT NULL CHECK (qty > 0)
);
GO
CREATE TABLE OrderExchanges (
  id        INT IDENTITY(1,1) PRIMARY KEY,
  order_id  INT NOT NULL REFERENCES Orders(order_id) ON DELETE CASCADE,
  item_id   INT NOT NULL REFERENCES OrderItems(item_id),
  from_size NVARCHAR(20) NOT NULL,
  to_size   NVARCHAR(20) NOT NULL,
  by_name   NVARCHAR(100) NULL,
  at        DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
);
GO
CREATE TABLE RentalReturns (
  order_id        INT PRIMARY KEY REFERENCES Orders(order_id) ON DELETE CASCADE,
  late_days       INT           NOT NULL DEFAULT 0,
  late_fee        DECIMAL(10,2) NOT NULL DEFAULT 0,
  damage_fee      DECIMAL(10,2) NOT NULL DEFAULT 0,
  deposit_kept    DECIMAL(10,2) NOT NULL DEFAULT 0,
  deposit_refund  DECIMAL(10,2) NOT NULL DEFAULT 0,
  extra_due       DECIMAL(10,2) NOT NULL DEFAULT 0,
  note            NVARCHAR(250) NULL,
  by_name         NVARCHAR(100) NULL,
  at              DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
);
GO
CREATE TABLE Alterations (
  alteration_id INT IDENTITY(1,1) PRIMARY KEY,
  alt_no        NVARCHAR(20)  NULL,
  customer_id   INT           NULL REFERENCES Users(user_id),
  customer_name NVARCHAR(100) NOT NULL,
  order_id      INT           NULL REFERENCES Orders(order_id),
  item          NVARCHAR(150) NOT NULL,
  work          NVARCHAR(300) NOT NULL,
  fee           DECIMAL(10,2) NOT NULL DEFAULT 0,
  due_date      DATE          NULL,
  tailor_id     INT           NULL REFERENCES Users(user_id),
  status        NVARCHAR(12)  NOT NULL DEFAULT 'Received',  -- Received | In Progress | Ready | Collected
  notes         NVARCHAR(300) NULL,
  created_by    NVARCHAR(100) NULL,
  created_at    DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME()
);
GO
CREATE TABLE AlterationHistory (
  id            INT IDENTITY(1,1) PRIMARY KEY,
  alteration_id INT NOT NULL REFERENCES Alterations(alteration_id) ON DELETE CASCADE,
  status        NVARCHAR(12) NOT NULL,
  by_name       NVARCHAR(100) NULL,
  at            DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
);
GO
CREATE TABLE Appointments (
  appointment_id INT IDENTITY(1,1) PRIMARY KEY,
  customer_id    INT           NOT NULL REFERENCES Users(user_id),
  customer_name  NVARCHAR(100) NOT NULL,
  service        NVARCHAR(60)  NOT NULL,              -- Fitting | Consultation | Alteration pickup | ...
  appt_date      DATE          NOT NULL,
  appt_time      VARCHAR(5)    NOT NULL,
  status         NVARCHAR(12)  NOT NULL DEFAULT 'Booked',   -- Booked | Confirmed | Completed | Cancelled | No-show
  note           NVARCHAR(250) NULL,
  assigned_to    INT           NULL REFERENCES Users(user_id),
  reminded       BIT           NOT NULL DEFAULT 0,
  created_at     DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME()
);
GO
CREATE TABLE Notifications (
  notification_id INT IDENTITY(1,1) PRIMARY KEY,
  user_id   INT           NOT NULL REFERENCES Users(user_id) ON DELETE CASCADE,
  title     NVARCHAR(120) NOT NULL,
  body      NVARCHAR(300) NULL,
  type      NVARCHAR(12)  NOT NULL DEFAULT 'info',     -- info | order | promo | loyalty | appointment
  is_read   BIT           NOT NULL DEFAULT 0,
  at        DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME()
);
GO
CREATE TABLE Attendance (
  attendance_id INT IDENTITY(1,1) PRIMARY KEY,
  user_id    INT       NOT NULL REFERENCES Users(user_id),
  clock_in   DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  clock_out  DATETIME2 NULL
);
GO
CREATE TABLE HeldOrders (
  held_id     INT IDENTITY(1,1) PRIMARY KEY,
  user_id     INT           NOT NULL REFERENCES Users(user_id),
  customer_id INT           NULL REFERENCES Users(user_id),
  label       NVARCHAR(80)  NULL,
  cart_json   NVARCHAR(MAX) NOT NULL,
  created_at  DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME()
);
GO
CREATE TABLE AuditLog (
  audit_id   BIGINT IDENTITY(1,1) PRIMARY KEY,
  at         DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME(),
  user_id    INT           NULL,
  user_name  NVARCHAR(100) NULL,
  role       NVARCHAR(20)  NULL,
  action     NVARCHAR(40)  NOT NULL,
  detail     NVARCHAR(400) NULL,
  ip         VARCHAR(64)   NULL
);
GO
CREATE TABLE Settings (
  [key]   NVARCHAR(40)  NOT NULL PRIMARY KEY,
  [value] NVARCHAR(MAX) NULL
);
GO
CREATE INDEX IX_Orders_customer ON Orders(customer_id, created_at DESC);
GO
CREATE INDEX IX_Orders_created  ON Orders(created_at DESC);
GO
CREATE INDEX IX_Items_order     ON OrderItems(order_id);
GO
CREATE INDEX IX_Sessions_user   ON Sessions(user_id, expires_at);
GO
CREATE INDEX IX_Audit_at        ON AuditLog(at DESC);
GO
CREATE INDEX IX_Notif_user      ON Notifications(user_id, is_read, at DESC);
