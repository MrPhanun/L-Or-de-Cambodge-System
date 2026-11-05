<?php
// Read-only mirror of the JSON document into normal tables, so the data can be browsed in phpMyAdmin.
// The app keeps using lodc_store as its source of truth; these tables are rebuilt from it after every save.
// Password / PIN hashes and salts are deliberately not copied.
declare(strict_types=1);

// column type codes: i int, n number, s short text, t long text, b bool, j json
function lodc_spec(): array {
    return [
        'users'        => ['pk' => 'user_id', 'rows' => fn($d) => $d['users'] ?? [], 'cols' => ['user_id' => 'i', 'role' => 's', 'name' => 's', 'email' => 's', 'phone' => 's', 'address' => 't',
            'active' => 'b', 'discount_limit' => 'n', 'commission_pct' => 'n', 'loyalty_points' => 'i', 'created_at' => 's', 'measurements' => 'j']],
        'categories'   => ['pk' => 'category_id', 'rows' => fn($d) => $d['categories'] ?? [], 'cols' => ['category_id' => 'i', 'name' => 's', 'sizes' => 's']],
        'products'     => ['pk' => 'product_id', 'rows' => fn($d) => $d['products'] ?? [], 'cols' => ['product_id' => 'i', 'sku' => 's', 'barcode' => 's', 'category_id' => 'i', 'name' => 's',
            'description' => 't', 'fabric' => 's', 'fit' => 's', 'color_name' => 's', 'color_hex' => 's', 'price' => 'n', 'cost' => 'n', 'rent_per_day' => 'n', 'rent_deposit' => 'n',
            'tailorable' => 'b', 'active' => 'b', 'created_at' => 's']],
        'variants'     => ['pk' => 'variant_id', 'rows' => function ($d) {
                $out = [];
                foreach ($d['products'] ?? [] as $p) foreach ($p['variants'] ?? [] as $v) $out[] = $v + ['product_id' => $p['product_id'] ?? null];
                return $out;
            }, 'cols' => ['variant_id' => 'i', 'product_id' => 'i', 'size' => 's', 'stock' => 'i']],
        'suppliers'    => ['pk' => 'supplier_id', 'rows' => fn($d) => $d['suppliers'] ?? [], 'cols' => ['supplier_id' => 'i', 'name' => 's', 'phone' => 's', 'email' => 's']],
        'orders'       => ['pk' => 'order_id', 'rows' => fn($d) => $d['orders'] ?? [], 'cols' => ['order_id' => 'i', 'order_no' => 's', 'channel' => 's', 'customer_id' => 'i',
            'customer_name' => 's', 'seller_id' => 'i', 'seller_name' => 's', 'tailor_id' => 'i', 'status' => 's', 'fulfilment' => 's', 'address' => 't', 'note' => 't', 'subtotal' => 'n',
            'bundle_discount' => 'n', 'discount_pct' => 'n', 'discount' => 'n', 'promo_code' => 's', 'points_value' => 'n', 'redeemed_points' => 'i', 'points_awarded' => 'i', 'tax' => 'n',
            'deposit' => 'n', 'total' => 'n', 'has_tailor' => 'b', 'has_rental' => 'b', 'created_at' => 's']],
        'order_items'  => ['pk' => 'item_id', 'rows' => fn($d) => lodc_children($d['orders'] ?? [], 'items'), 'cols' => ['item_id' => 'i', 'order_id' => 'i', 'product_id' => 'i',
            'variant_id' => 'i', 'name' => 's', 'category' => 's', 'fabric' => 's', 'fit' => 's', 'color_name' => 's', 'size' => 's', 'qty' => 'i', 'unit_price' => 'n', 'unit_cost' => 'n',
            'kind' => 's', 'rent_from' => 's', 'rent_to' => 's', 'rent_days' => 'i', 'deposit' => 'n', 'tailor_fabric' => 's', 'tailor_style' => 's', 'tailor_fit' => 's', 'tailor_notes' => 't']],
        'payments'     => ['pk' => 'payment_id', 'rows' => fn($d) => lodc_children($d['orders'] ?? [], 'payments'), 'cols' => ['payment_id' => 'i', 'order_id' => 'i', 'method' => 's',
            'amount' => 'n', 'kind' => 's', 'shift_id' => 'i', 'user_id' => 'i', 'at' => 's']],
        'refunds'      => ['pk' => 'refund_id', 'rows' => fn($d) => lodc_children($d['orders'] ?? [], 'refunds'), 'cols' => ['refund_id' => 'i', 'order_id' => 'i', 'amount' => 'n',
            'reason' => 't', 'method' => 's', 'shift_id' => 'i', 'user_id' => 'i', 'by_name' => 's', 'at' => 's', 'lines' => 'j']],
        'purchases'    => ['pk' => 'po_id', 'rows' => fn($d) => $d['purchases'] ?? [], 'cols' => ['po_id' => 'i', 'po_no' => 's', 'supplier_id' => 'i', 'status' => 's', 'note' => 't',
            'created_by' => 'i', 'created_at' => 's', 'received_at' => 's']],
        'purchase_items' => ['pk' => 'po_item_id', 'rows' => fn($d) => lodc_children($d['purchases'] ?? [], 'items'), 'cols' => ['po_item_id' => 'i', 'po_id' => 'i', 'variant_id' => 'i',
            'qty' => 'i', 'unit_cost' => 'n']],
        'movements'    => ['pk' => 'movement_id', 'rows' => fn($d) => $d['movements'] ?? [], 'cols' => ['movement_id' => 'i', 'variant_id' => 'i', 'qty' => 'i', 'type' => 's', 'ref' => 's',
            'user_id' => 'i', 'at' => 's']],
        'promos'       => ['pk' => 'promo_id', 'rows' => fn($d) => $d['promos'] ?? [], 'cols' => ['promo_id' => 'i', 'code' => 's', 'pct' => 'n', 'active' => 'b', 'note' => 's', 'expires_on' => 's']],
        'sales'        => ['pk' => 'sale_id', 'rows' => fn($d) => $d['sales'] ?? [], 'cols' => ['sale_id' => 'i', 'name' => 's', 'pct' => 'n', 'category_id' => 'i', 'date_from' => 's',
            'date_to' => 's', 'active' => 'b']],
        'bundles'      => ['pk' => 'bundle_id', 'rows' => fn($d) => $d['bundles'] ?? [], 'cols' => ['bundle_id' => 'i', 'name' => 's', 'pct' => 'n', 'active' => 'b', 'category_ids' => 'j']],
        'shifts'       => ['pk' => 'shift_id', 'rows' => fn($d) => $d['shifts'] ?? [], 'cols' => ['shift_id' => 'i', 'user_id' => 'i', 'opened_at' => 's', 'closed_at' => 's',
            'float_amount' => 'n', 'expected' => 'n', 'counted' => 'n', 'variance' => 'n', 'note' => 't']],
        'attendance'   => ['pk' => 'attendance_id', 'rows' => fn($d) => $d['attendance'] ?? [], 'cols' => ['attendance_id' => 'i', 'user_id' => 'i', 'clock_in' => 's', 'clock_out' => 's']],
        'alterations'  => ['pk' => 'alteration_id', 'rows' => fn($d) => $d['alterations'] ?? [], 'cols' => ['alteration_id' => 'i', 'alt_no' => 's', 'customer_id' => 'i',
            'customer_name' => 's', 'order_id' => 'i', 'item' => 's', 'work' => 't', 'fee' => 'n', 'due_date' => 's', 'tailor_id' => 'i', 'status' => 's', 'notes' => 't',
            'created_by' => 's', 'created_at' => 's']],
        'appointments' => ['pk' => 'appointment_id', 'rows' => fn($d) => $d['appointments'] ?? [], 'cols' => ['appointment_id' => 'i', 'customer_id' => 'i', 'customer_name' => 's',
            'service' => 's', 'appt_date' => 's', 'appt_time' => 's', 'status' => 's', 'note' => 't', 'assigned_to' => 'i', 'created_at' => 's']],
        'notifications' => ['pk' => 'notification_id', 'rows' => fn($d) => $d['notifications'] ?? [], 'cols' => ['notification_id' => 'i', 'user_id' => 'i', 'title' => 's',
            'body' => 't', 'type' => 's', 'is_read' => 'b', 'at' => 's']],
        'audit_log'    => ['pk' => 'audit_id', 'rows' => fn($d) => $d['audit'] ?? [], 'cols' => ['audit_id' => 'i', 'at' => 's', 'user_id' => 'i', 'user_name' => 's', 'role' => 's',
            'action' => 's', 'detail' => 't']],
    ];
}

function lodc_children(array $parents, string $key): array {
    $out = [];
    foreach ($parents as $p) foreach ($p[$key] ?? [] as $c) $out[] = $c;
    return $out;
}

function lodc_sqltype(string $t): string {
    return ['i' => 'BIGINT NULL', 'n' => 'DECIMAL(14,2) NULL', 's' => 'VARCHAR(255) NULL', 't' => 'TEXT NULL', 'b' => 'TINYINT(1) NULL', 'j' => 'TEXT NULL'][$t];
}

function lodc_value($v, string $t) {
    if ($v === null) return null;
    switch ($t) {
        case 'i': return is_numeric($v) ? (int)$v : null;
        case 'n': return is_numeric($v) ? (float)$v : null;
        case 'b': return $v ? 1 : 0;
        case 'j': return json_encode($v, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        default:  return is_scalar($v) ? (string)$v : json_encode($v, JSON_UNESCAPED_UNICODE);
    }
}

function lodc_mirror(PDO $pdo, array $data): void {
    $spec = lodc_spec();
    foreach ($spec as $name => $s) {   // DDL first: it commits implicitly in MySQL
        $cols = [];
        foreach ($s['cols'] as $c => $t) $cols[] = "`$c` " . lodc_sqltype($t) . ($c === $s['pk'] ? ' NOT NULL' : '');
        $pdo->exec("CREATE TABLE IF NOT EXISTS `lodc_$name` (" . implode(', ', $cols) . ", PRIMARY KEY (`{$s['pk']}`)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
    }
    $pdo->beginTransaction();
    try {
        foreach ($spec as $name => $s) {
            $pdo->exec("DELETE FROM `lodc_$name`");
            $names = array_keys($s['cols']);
            $st = $pdo->prepare("INSERT IGNORE INTO `lodc_$name` (`" . implode('`,`', $names) . '`) VALUES (' . implode(',', array_fill(0, count($names), '?')) . ')');
            foreach (($s['rows'])($data) as $row) {
                if (!is_array($row) || !isset($row[$s['pk']])) continue;
                $vals = [];
                foreach ($s['cols'] as $c => $t) $vals[] = lodc_value($row[$c] ?? null, $t);
                $st->execute($vals);
            }
        }
        $pdo->commit();
    } catch (Throwable $e) { $pdo->rollBack(); throw $e; }
}
