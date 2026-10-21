# Sample data and test scenarios

Loaded by `npm run setup-db` (rebuild any time with `npm run setup-db -- --reset`, which wipes the database).

## Accounts
One sign-in form for everyone: type the email and password and you land in the right view. (Staff PIN: use the "Staff: sign in with PIN" link.)

| Role | Email | Password | PIN |
|---|---|---|---|---|
| Client | client@lordecambodge.com | Client@1234 | - |
| Client (VIP) | client2@lordecambodge.com | Client@1234 | - |
| Seller (15% limit, 3% commission) | seller@lordecambodge.com | Seller@1234 | 1234 |
| Seller (10% limit, 2.5%) | seller2@lordecambodge.com | Seller@1234 | 2345 |
| Tailor | tailor@lordecambodge.com | Tailor@1234 | 3456 |
| Manager | manager@lordecambodge.com | Manager@1234 | 4567 |
| Admin | admin@lordecambodge.com | Admin@1234 | 0000 |

Phone sign-in also works: +855 12 000 004 (client), +855 12 000 002 (seller).

## Promotions
* Codes: **WELCOME10** (10%), **KHMER15** (15%)
* Seasonal sale: Linen Season, 10% off Shirts (automatic)
* Bundles: Suit + Tie = 10% off; Suit + Shirt + Shoes = 12% off (automatic)

## Products (24)
| SKU | Name | Category | Fabric / Fit / Color | Price | Cost | Rent | Stock by size |
|---|---|---|---|---|---|---|---|
| LDC-1001 | Phnom Penh Navy Two-Piece | Suits | Wool / Slim / Navy | $420 | $210 | $45/day | 46:3 48:6 50:4 52:6 54:5 56:10 |
| LDC-1002 | Angkor Charcoal Two-Piece | Suits | Wool / Regular / Charcoal | $450 | $225 | $45/day | 46:8 48:6 50:11 52:7 54:3 56:8 |
| LDC-1003 | Royal Black Tuxedo | Suits | Wool / Slim / Black | $590 | $290 | $70/day | 46:6 48:1 50:9 52:5 54:10 56:6 |
| LDC-1004 | Mekong Linen Summer Suit | Suits | Linen / Classic / Sand | $380 | $180 | $40/day | 46:6 48:11 50:7 52:3 54:8 56:4 |
| LDC-1005 | Bayon Burgundy Velvet Suit | Suits | Velvet / Slim / Burgundy | $640 | $310 | $80/day | 46:0 48:8 50:5 52:10 54:6 56:11 |
| LDC-1006 | Siem Reap Grey Three-Piece | Suits | Wool / Classic / Grey | $520 | $255 | $55/day | 46:10 48:7 50:3 52:8 54:4 56:9 |
| LDC-1007 | Harris Tweed Blazer | Blazers | Tweed / Regular / Brown | $260 | $120 | $30/day | 46:6 48:5 50:10 52:6 54:11 56:7 |
| LDC-1008 | Midnight Velvet Blazer | Blazers | Velvet / Slim / Midnight | $300 | $140 | $35/day | 46:6 48:3 50:8 52:4 54:9 56:5 |
| LDC-1009 | Cotton Navy Blazer | Blazers | Cotton / Classic / Navy | $220 | $100 | $25/day | 46:5 48:10 50:6 52:11 54:7 56:3 |
| LDC-1010 | Tailored Wool Trousers | Trousers | Wool / Slim / Charcoal | $120 | $52 | - | 30:3 32:6 34:4 36:8 38:5 |
| LDC-1011 | Linen Pleated Trousers | Trousers | Linen / Classic / Sand | $95 | $40 | - | 30:6 32:6 34:9 36:7 38:3 |
| LDC-1012 | Classic Navy Trousers | Trousers | Cotton / Regular / Navy | $85 | $36 | - | 30:7 32:4 34:9 36:5 38:10 |
| LDC-1013 | Poplin White Dress Shirt | Shirts | Cotton / Slim / White | $65 | $26 | - | S:6 M:8 L:7 XL:3 |
| LDC-1014 | Sky Blue Oxford Shirt | Shirts | Cotton / Regular / Sky Blue | $70 | $28 | - | S:4 M:6 L:5 XL:10 |
| LDC-1015 | Linen Ivory Shirt | Shirts | Linen / Classic / Ivory | $78 | $32 | - | S:8 M:7 L:3 XL:8 |
| LDC-1016 | Silk Crimson Tie | Ties | Silk / Regular / Crimson | $45 | $16 | - | One size:5 |
| LDC-1017 | Silk Royal Blue Tie | Ties | Silk / Regular / Royal Blue | $45 | $16 | - | One size:6 |
| LDC-1018 | Black Satin Bow Tie | Ties | Silk / Slim / Black | $35 | $12 | - | One size:5 |
| LDC-1019 | Oxford Brown Leather Shoes | Shoes | Leather / Classic / Brown | $180 | $80 | - | 40:3 41:6 42:4 43:9 44:5 45:10 |
| LDC-1020 | Black Patent Derby Shoes | Shoes | Leather / Slim / Black | $210 | $95 | - | 40:8 41:6 42:11 43:7 44:3 45:8 |
| LDC-1021 | Leather Belt | Accessories | Leather / Regular / Black | $55 | $20 | - | One size:6 |
| LDC-1022 | Gold Cufflinks | Accessories | Silk / Regular / Gold | $85 | $30 | - | One size:6 |
| LDC-1023 | Silk Pocket Square | Accessories | Silk / Regular / Burgundy | $25 | $8 | - | One size:4 |
| LDC-1024 | Cambodian Silk Scarf | Accessories | Silk / Regular / Gold | $60 | $22 | - | One size:10 |

Edge cases built in: *Royal Black Tuxedo* size 48 has only 1 left; *Bayon Burgundy Velvet Suit* size 46 is sold out.

## Demo orders (first rows)
| Order | Channel | Customer | Status | Total | Notes |
|---|---|---|---|---|---|
| LDC-10001 | pos | Bopha Lim | Picked Up | $718.30 |  |
| LDC-10002 | pos | Vanna Kim | Picked Up | $484.00 |  |
| LDC-10003 | pos | Vanna Kim | Picked Up | $69.30 |  |
| LDC-10004 | pos | Vanna Kim | Picked Up | $104.50 |  |
| LDC-10005 | pos | Vanna Kim | Picked Up | $704.00 |  |
| LDC-10006 | pos | Vanna Kim | Picked Up | $198.00 |  |
| LDC-10007 | pos | Bopha Lim | Picked Up | $742.72 |  |
| LDC-10009 | pos | Vanna Kim | Picked Up | $165.00 |  |
| LDC-10011 | pos | Vanna Kim | Picked Up | $531.30 |  |
| LDC-10013 | pos | Bopha Lim | Picked Up | $49.50 |  |
| LDC-10014 | pos | Vanna Kim | Picked Up | $781.00 |  |
| LDC-10015 | pos | Bopha Lim | Picked Up | $594.00 |  |
| LDC-10016 | pos | Vanna Kim | Picked Up | $330.00 |  |
| LDC-10017 | pos | Vanna Kim | Picked Up | $817.85 |  |

Also seeded: 1 **overdue rental** (Bopha Lim), 2 alteration tickets, 2 appointments, saved measurements for Vanna Kim.

## Test scenarios (click-through)
1. **Client checkout** - sign in as client -> Shop -> open *Phnom Penh Navy Two-Piece*, size 48 -> add; add *Silk Crimson Tie* -> Cart: bundle discount shows; apply `KHMER15`; pay *Pay in store* -> My orders shows *Pending*.
2. **Sold-out size** - open *Bayon Burgundy Velvet Suit*: size 46 is greyed out.
3. **Custom tailoring** - Custom tailoring -> pick a suit, Slim, note -> Submit -> order appears; as manager (Admin > Tailoring) assign Chenda and press *Start tailoring*; client sees *Tailoring*.
4. **Rental** - Suit rental -> size, dates 2 days ahead -> cart shows deposit; as seller (Rentals) check in the overdue rental and see the late fee taken from the deposit.
5. **POS sale** - seller PIN 1234 -> POS -> Clock in -> Open cash shift ($100) -> add suit + tie -> choose customer -> discount 5% -> Cash $50 + Card rest -> Complete -> receipt.
6. **Discount limit** - in POS enter 20% as seller (limit 15%): refused. Try the same as manager (limit 30%).
7. **Partial payment** - pay only part -> *Save with balance due*; open the order, try *Mark Picked Up* (blocked), collect the balance, then hand over.
8. **Refund / exchange** - Orders -> open a sale -> Refund / exchange -> Size exchange.
9. **Hold / resume** - add items -> Hold order -> Held (1) -> Resume.
10. **End of shift** - Shift & cash -> enter counted cash (e.g. $2 short) -> report shows variance -> Clock out.
11. **Permissions** - as tailor you see no POS; as manager no Staff/Settings; as seller visiting /admin.html redirects to login.
12. **Lockout** - enter a wrong password 5 times for any account: locked for 15 minutes (Admin > Staff > Reset unlocks it).
13. **Reports** - Admin > Reports, 30 days: totals, best sellers by size/color/style, per-seller commission, cash reconciliation.

Run the automated checks with `npm test` (needs the server running and a freshly reset database).
