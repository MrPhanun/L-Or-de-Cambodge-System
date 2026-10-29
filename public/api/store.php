<?php
// Shared database for L'Or de Cambodge: one JSON document kept in MySQL with a version number.
//   GET  store.php[?since=N]  -> {version, data} or {unchanged:true} when version == N
//   PUT  store.php            -> body {version, data}; saved only if version still matches (else 409)
declare(strict_types=1);
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');

const MAX_BYTES = 8 * 1024 * 1024;

function out(int $code, array $body): void { http_response_code($code); echo json_encode($body); exit; }

$cfgFile = __DIR__ . '/config.php';
if (!is_file($cfgFile)) out(503, ['error' => 'api/config.php is missing. Copy config.sample.php to config.php and fill in the database details.']);
$cfg = require $cfgFile;

try {
    $pdo = new PDO("mysql:host={$cfg['host']};dbname={$cfg['name']};charset=utf8mb4", $cfg['user'], $cfg['pass'],
        [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]);
    $pdo->exec('CREATE TABLE IF NOT EXISTS lodc_store (id TINYINT UNSIGNED PRIMARY KEY, version INT UNSIGNED NOT NULL, data LONGTEXT NOT NULL, updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4');
} catch (Throwable $e) {
    out(503, ['error' => 'Cannot connect to the database.']);
}

$method = $_SERVER['REQUEST_METHOD'];

if ($method === 'GET') {
    $row = $pdo->query('SELECT version, data FROM lodc_store WHERE id = 1')->fetch();
    if (!$row) out(200, ['version' => 0, 'data' => null]);
    if (isset($_GET['since']) && (int)$_GET['since'] === (int)$row['version']) out(200, ['unchanged' => true]);
    http_response_code(200);
    echo '{"version":' . (int)$row['version'] . ',"data":' . $row['data'] . '}';   // data is already valid JSON
    exit;
}

if ($method === 'PUT') {
    if (($_SERVER['HTTP_X_REQUESTED_WITH'] ?? '') !== 'lodc') out(403, ['error' => 'Forbidden']);
    $raw = file_get_contents('php://input', false, null, 0, MAX_BYTES + 1);
    if ($raw === false || strlen($raw) > MAX_BYTES) out(413, ['error' => 'Data too large']);
    $in = json_decode($raw, true);
    if (!is_array($in) || !isset($in['version']) || !is_array($in['data'] ?? null) || !isset($in['data']['users'])) out(400, ['error' => 'Bad request']);
    $version = (int)$in['version'];
    $json = json_encode($in['data'], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);

    if ($version === 0) {   // first ever save
        $st = $pdo->prepare('INSERT IGNORE INTO lodc_store (id, version, data) VALUES (1, 1, ?)');
        $st->execute([$json]);
        if ($st->rowCount() === 1) out(200, ['version' => 1]);
        out(409, ['error' => 'Conflict']);
    }
    $st = $pdo->prepare('UPDATE lodc_store SET data = ?, version = version + 1 WHERE id = 1 AND version = ?');
    $st->execute([$json, $version]);
    if ($st->rowCount() === 1) out(200, ['version' => $version + 1]);
    out(409, ['error' => 'Conflict']);
}

out(405, ['error' => 'Method not allowed']);
