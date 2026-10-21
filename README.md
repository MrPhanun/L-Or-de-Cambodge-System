# L'Or de Cambodge - POS & Store Management System

A suit shop system with **three separate views** - **Client**, **Seller** (cashier / tailor) and **Admin** (owner / manager) - each with its own sign-in, dashboard and permissions.

| Layer | Technology |
|---|---|
| Front end | HTML, CSS, vanilla JavaScript (no framework, no build step) |
| Back end | Node.js + Express 4 |
| Database | Microsoft SQL Server (`mssql` driver, parameterised queries only) |
| Auth | scrypt-hashed passwords & PINs, random session tokens in an HttpOnly cookie, role + permission checks on the server |

> You wrote "Node.js + SQL Server", so that is what this is built on. The browser never decides anything about money, stock or permissions - every price is recalculated on the server and every endpoint checks the signed-in user's permissions.

---

## 1. Setup and run

```text
1. SQL Server is running (default instance, SQL logins enabled).
2. In this folder:   npm install
3. Create the database login (already done on this PC - see .env).  To do it elsewhere, run in SSMS / sqlcmd:
     CREATE DATABASE LorDeCambodgeDB;
     CREATE LOGIN lodc_app WITH PASSWORD = '<strong password>';
     USE LorDeCambodgeDB; CREATE USER lodc_app FOR LOGIN lodc_app; ALTER ROLE db_owner ADD MEMBER lodc_app;
   and put the values in a file named .env (copy .env.example).
4. Create tables + sample data:   npm run setup-db          (add  -- --reset  to wipe and rebuild)
5. Start:                          npm start     (or double-click run.cmd)    ->  http://localhost:5500/login.html
6. Stop:                           stop.cmd
7. Check everything works:         npm test      (92 automated API checks; server must be running)
```

`.env` holds the database password - never share or commit it. Run behind HTTPS in production and set `SECURE_COOKIES=1`.

### Sample accounts (created by `npm run setup-db`)

There is **one sign-in form** (email or phone + password). The server looks up the account's role and sends you to the right view automatically. Staff can also use the small "Staff: sign in with PIN" link at the counter.


| Role | Opens | Email | Password | PIN |
|---|---|---|---|---|
| Client | client.html | client@lordecambodge.com | Client@1234 | - |
| Client (VIP) | client.html | client2@lordecambodge.com | Client@1234 | - |
| Seller (limit 15%, 3% commission) | seller.html | seller@lordecambodge.com | Seller@1234 | 1234 |
| Seller (limit 10%, 2.5%) | seller.html | seller2@lordecambodge.com | Seller@1234 | 2345 |
| Tailor | seller.html | tailor@lordecambodge.com | Tailor@1234 | 3456 |
| Manager | admin.html | manager@lordecambodge.com | Manager@1234 | 4567 |
| Owner / Admin | admin.html | admin@lordecambodge.com | Admin@1234 | 0000 |

Change these before real use (Admin > Staff > Reset password / PIN).

**Sample data:** 24 products in 7 categories with sizes and stock, 2 suppliers, promo codes `WELCOME10` (10%) and `KHMER15` (15%), a Linen Season sale on shirts, two bundle deals (Suit+Tie 10%, Suit+Shirt+Shoes 12%), and about 26 demo orders spread over recent weeks (in-store and online, a custom tailoring order, an overdue rental, alteration tickets, appointments).

---

## 2. System overview

```text
 Browser (HTML/CSS/JS)              Node.js + Express                       SQL Server
 ┌───────────────────┐   fetch   ┌──────────────────────────┐   mssql   ┌─────────────────────┐
 │ login.html        │ ────────► │ middleware: session,     │ ────────► │ LorDeCambodgeDB     │
 │ client.html       │  JSON +   │   CSRF header, rate limit│  params   │  Users, Roles, ...  │
 │ seller.html       │  cookie   │ routes: api.js, admin.js │           │  Orders, Products   │
 │ admin.html        │ ◄──────── │ services.js (all rules,  │ ◄──────── │  Sessions, Audit    │
 └───────────────────┘           │   transactions, pricing) │           └─────────────────────┘
```

### Roles and permissions

| Role | View | Can do (default permissions) |
|---|---|---|
| **client** | client.html | Shop, cart, checkout, own orders/measurements/appointments/rentals/tailoring, loyalty, notifications |
| **seller** | seller.html | POS, orders, refunds/exchanges, customers, alterations, rentals, appointments, stock check, own performance, clock-in & cash shift |
| **tailor** | seller.html | Alteration tickets, appointments, stock check, view orders, own performance |
| **manager** | admin.html | Everything operational: products, inventory & purchasing, promotions, reports, orders, tailoring, rentals, customers, activity log. **Not** staff management or settings |
| **admin** | admin.html | Everything, including staff, per-person permission overrides and settings |

Each person can also have **overrides** (allow / deny a single permission), a **discount limit %** and a **commission %**. A server-side check (`requirePerm(...)`) guards every endpoint and each HTML page is only served to the matching role.

### User flow - Client
1. **Register** (name, email, optional phone, password) or **sign in** with email or phone. *(Google sign-in needs an OAuth client ID and is not connected - the button explains this.)*
2. **Shop**: browse 7 categories; filter by size, color, fabric, fit, price, stock; open a product (3 pictures, description, sizes with stock status).
3. **Cart & checkout**: add items, apply promo code, redeem loyalty points, choose pickup/delivery, pay by KHQR / ABA Pay / card (**simulated - no real money moves**) or **pay in store**. Bundle deals and seasonal sales apply automatically.
4. **My measurements**: save chest, waist, shoulder, sleeve, inseam, neck.
5. **Custom tailoring**: choose garment, fabric, fit, style, notes -> becomes an order that moves *Pending -> Tailoring -> Ready -> Picked Up / Delivered*.
6. **Appointments**: book a fitting or consultation (09:00-18:00, max 2 per slot); reminder the day before.
7. **Suit rental**: choose size and dates, pay rental + refundable deposit; late return fee comes out of the deposit.
8. **My orders**: track status steps, see payments, receipt, cancel an unpaid pending order, reorder.
9. **Loyalty**: 1 point per $1 (before VAT); 100 points = $1; levels Member / Silver (500) / Gold (1,500) / VIP (3,000).
10. **Notifications**: order updates, pickup reminders (Ready for 2+ days), fitting reminders, promotions.

### User flow - Seller
1. **PIN login** at the counter (or password) -> **Clock in** -> **Open cash shift** with a float.
2. **POS**: search by name / SKU / **scan barcode** -> pick size (or rent / made-to-measure) -> choose customer (or walk-in / new) -> discount (limited to *their* limit), promo, points -> take **split payments**, a **deposit**, or a **partial payment** -> print or email the receipt. **Hold** a sale and **resume** it later.
3. **Orders**: fulfil online orders (Ready -> Picked Up/Delivered), collect a remaining balance (goods cannot leave until paid), cancel, **refund** or **exchange a size** (stock adjusts automatically; refund window enforced).
4. **Rentals**: check out (rentals are paid in full) and **check in** (late fee + damage fee taken from the deposit).
5. **Alteration tickets**: create, assign a tailor, update status (Received -> In Progress -> Ready -> Collected); the customer is notified when ready.
6. **Customers**: look up profile, measurements, purchase history; create new customers.
7. **Appointments**: today's fittings, confirm / complete / no-show / cancel.
8. **Stock check** by size and color; **My performance** (sales, commission estimate); **Shift & cash**: end-of-shift report (expected vs counted cash, variance) -> **Clock out**.

### User flow - Admin / Manager
Dashboard (revenue, orders, top products, low stock, chart) -> **Products** (add/edit/delete or archive, categories, sizes, prices, cost, images, rentable/tailorable) -> **Inventory** (levels, adjustments with reason, movement log, suppliers, purchase orders -> receive stock) -> **Promotions** (codes, seasonal sales, bundles, send promo notifications) -> **Orders** (all channels, change status, refunds) -> **Tailoring** (custom orders, workload per tailor, alterations) -> **Rentals** (schedule, overdue, rental items) -> **Customers & loyalty levels** -> **Staff** (create users, roles, discount limits, commission, permissions, reset credentials, attendance, cash shifts) -> **Reports** (daily / weekly / monthly, best sellers by size / color / style, per seller, inventory value & profit, VAT, cash reconciliation, CSV export) -> **Settings** (shop info, logo, VAT, USD/KHR, payment methods, receipt text, rules) -> **Activity log**.

---

## 3. Database design (ERD)

Tables are created by [`server/schema.sql`](server/schema.sql). Diagram (renders on GitHub, VS Code with a Mermaid extension, and mermaid.live):

```mermaid
erDiagram
  Roles ||--o{ Users : has
  Roles ||--o{ RolePermissions : grants
  Permissions ||--o{ RolePermissions : in
  Users ||--o{ UserPermissions : "overrides"
  Permissions ||--o{ UserPermissions : of
  Users ||--o{ Sessions : "signs in"
  Users ||--o| Measurements : "has"
  Users ||--o{ Notifications : receives
  Users ||--o{ Attendance : "clocks"
  Users ||--o{ CashShifts : opens
  Users ||--o{ HeldOrders : holds
  Users ||--o{ Appointments : books
  Users ||--o{ AuditLog : acts

  Categories ||--o{ Products : contains
  Products ||--|{ ProductVariants : "sizes/stock"
  ProductVariants ||--o{ StockMovements : logs
  Categories ||--o{ SeasonalSales : "applies to"
  Bundles ||--|{ BundleCategories : needs
  Categories ||--o{ BundleCategories : in

  Suppliers ||--o{ PurchaseOrders : supplies
  PurchaseOrders ||--|{ PurchaseOrderItems : lines
  ProductVariants ||--o{ PurchaseOrderItems : restocks

  Users ||--o{ Orders : "customer / seller / tailor"
  Orders ||--|{ OrderItems : lines
  Products ||--o{ OrderItems : sold
  ProductVariants ||--o{ OrderItems : "stock source"
  Orders ||--o{ OrderPayments : "paid by"
  CashShifts ||--o{ OrderPayments : "taken in"
  Orders ||--o{ OrderStatusHistory : tracks
  Orders ||--o{ OrderRefunds : refunds
  OrderRefunds ||--|{ OrderRefundLines : lines
  OrderItems ||--o{ OrderRefundLines : returned
  Orders ||--o{ OrderExchanges : "size swap"
  Orders ||--o| RentalReturns : "check-in"
  Orders ||--o{ Alterations : "related to"
  Users ||--o{ Alterations : "customer / tailor"
  Alterations ||--o{ AlterationHistory : tracks

  Users { int user_id PK
    int role_id FK
    string name
    string email UK
    string phone
    string pass_hash "scrypt"
    string pass_salt
    string pin_hash "staff"
    bool active
    decimal discount_limit
    decimal commission_pct
    int loyalty_points
    int failed_logins
    datetime locked_until }
  Products { int product_id PK
    string sku UK
    int category_id FK
    string name
    string fabric
    string fit
    string color_name
    decimal price
    decimal cost
    decimal rent_per_day
    decimal rent_deposit
    bool tailorable
    bool active }
  ProductVariants { int variant_id PK
    int product_id FK
    string size
    int stock "CHECK >= 0" }
  Orders { int order_id PK
    string order_no UK
    string channel "online|pos"
    int customer_id FK
    int seller_id FK
    int tailor_id FK
    string status
    decimal subtotal
    decimal discount
    decimal tax
    decimal deposit
    decimal total }
  OrderItems { int item_id PK
    int order_id FK
    int variant_id FK
    string kind "buy|rent|tailor"
    string size
    int qty
    decimal unit_price
    decimal unit_cost }
  OrderPayments { int payment_id PK
    int order_id FK
    string method
    decimal amount
    string kind "payment|deposit"
    int shift_id FK }
  CashShifts { int shift_id PK
    int user_id FK
    datetime opened_at
    datetime closed_at
    decimal float_amount
    decimal expected
    decimal counted
    decimal variance }
```

**Design notes**
* `Orders.total` = subtotal - bundle - discount - points + VAT + rental deposit. The amount paid is the **sum of `OrderPayments`**, so split payments, deposits and later balance payments are all just more rows; `balance = total - paid`.
* Stock is only changed through one function that does `UPDATE ... WHERE stock + delta >= 0` (atomic, can never go negative) and writes a `StockMovements` row.
* Made-to-measure lines have `variant_id = NULL` (no stock is held).
* `Sessions.token_hash` stores only a SHA-256 of the cookie token, so a database leak does not leak live sessions.
* `AuditLog` records who did what, when, and from which IP.

---

## 4. Main screens

| View | Screens |
|---|---|
| **Login** | One form: email-or-phone + password (role detected automatically), staff **PIN** link, client registration, lockout messages |
| **Client** (light storefront with a top menu, like a fashion e-shop) | Home (hero, categories, new arrivals, services) - Shop (filter sidebar: size, color, fabric, fit, price) - Product page (3 pictures, sizes with stock, complete the look) - Shopping bag & checkout - Custom tailoring - Suit rental - Book a fitting - My account (overview, orders, measurements, loyalty & VIP, notifications, profile) |
| **Seller** | Dashboard (shift status, today's numbers) - POS checkout (+ customer picker, size/rent/tailor picker, held orders, receipt) - Orders (+ detail, collect balance, refund/exchange) - Rentals - Alterations - Customers (+ profile & measurements) - Appointments - Stock check - My performance - Shift & cash (end-of-shift report) |
| **Admin** | Dashboard - Products (+ categories) - Inventory (levels, movements, suppliers, purchase orders) - Promotions (codes, sales, bundles, broadcasts) - Orders - Tailoring - Rentals - Customers - Staff (team & permissions, attendance & shifts, commission) - Reports - Activity log - Settings |

---

## 5. Code walkthrough (build order)

| Step | File | What it does |
|---|---|---|
| 1 | `server/schema.sql` | All tables, keys, checks, indexes |
| 2 | `server/config.js`, `server/db.js` | `.env` loader, connection pool, `q()` (parameterised query) and `tx()` (transaction) helpers |
| 3 | `server/security.js`, `server/perms.js` | scrypt hashing, session tokens, cookies, rate limiter; permission list and role defaults |
| 4 | `server/services.js` | **All business rules**: pricing (sale, bundle, promo, points, VAT), orders, payments, stock, refunds, exchanges, rentals, alterations, shifts |
| 5 | `server/middleware.js` | session loading, `requirePerm`, CSRF header check, page guards |
| 6 | `server/routes/api.js`, `server/routes/admin.js` | REST endpoints (`/api/...` and `/api/admin/...`) |
| 7 | `server/index.js` | Express app, security headers (CSP etc.), static files, error handling |
| 8 | `server/setup.js` | Creates tables, loads sample data |
| 9 | `public/js/lib.js` | Safe HTML templates (auto-escaping), API client, modals, charts, product art, app shell, receipt |
| 10 | `public/js/client.js`, `seller.js`, `admin.js`, `common.js` | The three views (+ code shared by seller and admin) |
| 11 | `public/login.html`, `script.js` | Sign-in / registration page |
| 12 | `server/test.js` | 92 automated checks (security, permissions, pricing, stock, refunds, rentals, lockout, ...) |

---

## 6. Security summary

* **Passwords & PINs**: scrypt (N=16384) with a unique random salt; compared in constant time. Never returned by any API.
* **Sessions**: 256-bit random token in an `HttpOnly; SameSite=Strict` cookie (add `Secure` via `SECURE_COOKIES=1` on HTTPS); only its SHA-256 is stored; 8-hour expiry; logout and password change revoke sessions.
* **Brute force**: per-IP rate limit on login/register and an account lockout (5 failures -> 15 minutes). Error messages do not reveal whether an account exists.
* **Access control**: every API route checks the permission on the server; clients only ever see their own data; the page for each view is only served to that role; managers cannot touch admin accounts; the last active admin cannot be removed; users cannot disable themselves.
* **Injection**: all SQL is parameterised; all HTML is built with an auto-escaping template tag; a strict Content-Security-Policy blocks inline scripts.
* **CSRF**: SameSite=Strict cookies **plus** a required `X-Requested-With` header on every state-changing request.
* **Money integrity**: prices come from the database, discounts are capped by the seller's limit, payments can't exceed the total, stock can't go below zero, goods can't be handed over with a balance due, refunds can't exceed what was bought/paid. Everything that touches several tables runs in one transaction.
* **Audit**: logins (including failures), orders, payments, refunds, stock changes, staff changes, setting changes are all logged.

## 7. Known limits (be aware)

* **Online payments are simulated** (KHQR, ABA Pay, card): the order is recorded as paid, no gateway is called and no card details are collected. Connecting a real gateway (ABA PayWay / Bakong KHQR) is a separate integration.
* **Google sign-in** and **email / SMS** sending are not connected (receipts open your email app through a `mailto:` link; notifications appear in the app).
* The rate limiter and lockout counters that live in memory reset when the server restarts (lockouts are stored in the database and survive).
* The product image is a generated picture unless the admin uploads one.
* `npm audit` reports one moderate advisory in a dependency of the SQL Server driver (`sprintf-js`, denial of service through format strings). This app never passes user input as a format string, so it is not reachable here; update `mssql` when a fixed non-breaking release exists.
* For production: HTTPS, a reverse proxy, regular database backups, and changing all sample passwords.
