<?php
/**
 * Hamdhi web app — PHP endpoint: GET /api/spec.php?url=<openapi url>
 *
 * PHP twin of api/spec.js so the app also works on PHP-only hosts
 * (InfinityFree, shared hosting, cPanel) where Node/serverless is not
 * available.
 *
 * Fetches an OpenAPI document server-side (so the browser never hits CORS)
 * and returns it as JSON. YAML documents are returned as raw text in
 * "body" and are parsed by the browser (js/yaml-subset.js), because PHP
 * has no built-in YAML parser.
 */
declare(strict_types=1);

require_once __DIR__ . '/lib/common.php';

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('Access-Control-Allow-Origin: *');

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'OPTIONS') {
    header('Access-Control-Allow-Methods: GET,OPTIONS');
    header('Access-Control-Allow-Headers: Content-Type,Authorization');
    http_response_code(204);
    exit;
}

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'GET' && ($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'HEAD') {
    http_response_code(405);
    echo json_encode(['error' => 'Use GET.']);
    exit;
}

$target = isset($_GET['url']) ? trim((string) $_GET['url']) : '';
if ($target === '') {
    http_response_code(400);
    echo json_encode(['error' => 'Missing "url" query parameter.']);
    exit;
}

$auth = isset($_GET['auth']) ? trim((string) $_GET['auth']) : '';
$headers = ['Accept: application/json, application/yaml, text/yaml, text/plain, */*'];
if ($auth !== '') {
    $headers[] = 'Authorization: ' . $auth;
}

$result = hamdhi_fetch($target, 'GET', $headers, null);
if (isset($result['error'])) {
    http_response_code(502);
    echo json_encode([
        'error' => $result['error'],
        'url' => $target,
    ]);
    exit;
}

$body = $result['body'];
$contentType = $result['contentType'];
$spec = null;
$decoded = json_decode($body, true);
if (json_last_error() === JSON_ERROR_NONE && is_array($decoded)) {
    $spec = $decoded;
}

// The browser does the YAML parsing (see js/yaml-subset.js).
echo json_encode([
    'ok' => true,
    'url' => $result['url'],
    'contentType' => $contentType,
    'spec' => $spec,
    'body' => $spec === null ? $body : null,
]);
