<?php
/**
 * Hamdhi web app — PHP endpoint: ANY /api/proxy.php
 *
 * PHP twin of api/proxy.js so the app also works on PHP-only hosts
 * (InfinityFree, shared hosting, cPanel) where Node/serverless is not
 * available.
 *
 * Replays an API request server-side so the browser is never subject to
 * CORS. The browser POSTs { method, url, headers, body }.
 */
declare(strict_types=1);

require_once __DIR__ . '/lib/common.php';

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('Access-Control-Allow-Origin: *');

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'OPTIONS') {
    header('Access-Control-Allow-Methods: GET,POST,PUT,PATCH,DELETE,HEAD,OPTIONS');
    header('Access-Control-Allow-Headers: Content-Type,Authorization');
    http_response_code(204);
    exit;
}

/** Headers we never forward to the target API. */
function hamdhi_blocked_request_headers(): array
{
    return [
        'host', 'connection', 'content-length', 'transfer-encoding', 'upgrade',
        'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'cookie',
        'origin', 'referer', 'sec-fetch-mode', 'sec-fetch-site', 'sec-fetch-dest',
        'sec-ch-ua', 'sec-ch-ua-mobile', 'sec-ch-ua-platform',
    ];
}

$method = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET'));
$payload = [];

if ($method === 'GET' || $method === 'HEAD') {
    $payload = [
        'method' => $method,
        'url' => isset($_GET['url']) ? (string) $_GET['url'] : '',
        'headers' => [],
        'body' => null,
    ];
} else {
    $raw = file_get_contents('php://input');
    if ($raw === false || trim((string) $raw) === '') {
        http_response_code(400);
        echo json_encode(['error' => 'Invalid JSON body.']);
        exit;
    }
    $decoded = json_decode($raw, true);
    if (json_last_error() !== JSON_ERROR_NONE || !is_array($decoded)) {
        http_response_code(400);
        echo json_encode(['error' => 'Invalid JSON body.']);
        exit;
    }
    $payload = $decoded;
}

$target = isset($payload['url']) ? trim((string) $payload['url']) : '';
if ($target === '') {
    http_response_code(400);
    echo json_encode(['error' => 'Missing "url" in request body.']);
    exit;
}

$method = strtoupper((string) ($payload['method'] ?? 'GET'));
$blocked = hamdhi_blocked_request_headers();
$headers = [];
foreach ((array) ($payload['headers'] ?? []) as $key => $value) {
    $lower = strtolower((string) $key);
    if (in_array($lower, $blocked, true) || strpos($lower, 'sec-') === 0) {
        continue;
    }
    if (is_array($value)) {
        $value = implode(', ', $value);
    }
    $value = trim((string) $value);
    if ($value === '') {
        continue;
    }
    $headers[] = $key . ': ' . $value;
}

$body = null;
if ($method !== 'GET' && $method !== 'HEAD' && isset($payload['body']) && $payload['body'] !== '') {
    $body = is_string($payload['body']) ? $payload['body'] : json_encode($payload['body']);
    $hasContentType = false;
    foreach ($headers as $header) {
        if (stripos($header, 'content-type:') === 0) {
            $hasContentType = true;
            break;
        }
    }
    if (!$hasContentType) {
        $headers[] = 'Content-Type: application/json';
    }
}

$startedAt = microtime(true);
$result = hamdhi_fetch($target, $method, $headers, $body);
if (isset($result['error'])) {
    http_response_code(502);
    echo json_encode(['error' => $result['error'], 'url' => $target]);
    exit;
}

http_response_code(200);
echo json_encode([
    'status' => $result['status'],
    'statusText' => '',
    'ok' => $result['status'] >= 200 && $result['status'] < 300,
    'headers' => ['content-type' => $result['contentType']],
    'body' => $result['body'],
    'truncated' => strlen($result['body']) >= HAMDHI_MAX_BYTES,
    'bytes' => strlen($result['body']),
    'finalUrl' => $result['url'],
    'ms' => (int) round((microtime(true) - $startedAt) * 1000),
]);
