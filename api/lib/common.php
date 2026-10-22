<?php
/**
 * Hamdhi web app — shared PHP helpers (part 1: validation / SSRF guard).
 *
 * Used by api/spec.php and api/proxy.php. Mirrors the behaviour of
 * lib/net.js + lib/handlers.js on the Node side:
 *   - redirects are followed manually and every hop is re-validated
 *   - private / loopback targets are blocked unless explicitly allowed
 *   - response bodies are capped
 */
declare(strict_types=1);

const HAMDHI_MAX_BYTES = 8388608;      // 8 MB
const HAMDHI_TIMEOUT_SECONDS = 30;
const HAMDHI_MAX_REDIRECTS = 4;

/** Private targets are allowed locally (dev) but blocked in production. */
function hamdhi_allow_private_targets(): bool
{
    $env = getenv('HAMDHI_ALLOW_PRIVATE_TARGETS');
    if ($env !== false && $env !== '') {
        return $env === '1';
    }
    return false;
}

/** Optional hard allow-list: comma separated origins. */
function hamdhi_allowed_origins(): array
{
    $raw = getenv('HAMDHI_ALLOWED_ORIGINS');
    if ($raw === false || $raw === '') {
        return [];
    }
    $out = [];
    foreach (explode(',', $raw) as $part) {
        $part = trim($part);
        if ($part !== '') {
            $out[] = $part;
        }
    }
    return $out;
}

function hamdhi_origin_of(string $url): string
{
    $parts = parse_url($url);
    if (!$parts || empty($parts['scheme']) || empty($parts['host'])) {
        return '';
    }
    $port = !empty($parts['port']) ? ':' . $parts['port'] : '';
    return strtolower($parts['scheme'] . '://' . $parts['host'] . $port);
}

/** Returns an error message, or null when the target is allowed. */
function hamdhi_check_allow_list(string $url): ?string
{
    $list = hamdhi_allowed_origins();
    if (!count($list)) {
        return null;
    }
    $origin = hamdhi_origin_of($url);
    if ($origin === '') {
        return 'Target URL is not valid.';
    }
    foreach ($list as $allowed) {
        $allowed = rtrim($allowed, '/');
        if ($allowed === '*' || $origin === $allowed || strpos($origin, $allowed . '/') === 0) {
            return null;
        }
    }
    return 'Target origin "' . $origin . '" is not allowed. Allowed: ' . implode(', ', $list);
}

function hamdhi_is_private_ipv4(string $ip): bool
{
    $long = ip2long($ip);
    if ($long === false) {
        return false;
    }
    $ranges = [
        ['0.0.0.0', '0.255.255.255'],
        ['10.0.0.0', '10.255.255.255'],
        ['100.64.0.0', '100.127.255.255'],
        ['127.0.0.0', '127.255.255.255'],
        ['169.254.0.0', '169.255.255.255'],
        ['172.16.0.0', '172.31.255.255'],

/** Reject loopback / link-local / private targets (SSRF protection). */
function hamdhi_assert_host_allowed(string $host): ?string
{
    $host = strtolower(trim($host));
    if ($host === '') {
        return 'Target URL has no host.';
    }
    if ($host === 'localhost' || substr($host, -10) === '.localhost') {
        if (!hamdhi_allow_private_targets()) {
            return 'Requests to localhost are blocked.';
        }
        return null;
    }
    if (filter_var($host, FILTER_VALIDATE_IP)) {
        $isPrivate = hamdhi_is_private_ip($host);
        if ($isPrivate && !hamdhi_allow_private_targets()) {
            return 'Blocked request to internal address (' . $host . ').';
        }
        return null;
    }
    // Resolve the hostname and check every address it maps to.
    $addresses = @dns_get_record($host, DNS_A | DNS_AAAA);
    if ($addresses) {
        foreach ($addresses as $record) {
            $ip = $record['ip'] ?? ($record['ipv6'] ?? '');
            if ($ip === '') {
                continue;
            }
            if (hamdhi_is_private_ip($ip) && !hamdhi_allow_private_targets()) {
                return 'Blocked request to internal address (' . $ip . ').';
            }
        }
    }
    return null;
}

/** Loopback / link-local / private ranges, for both IPv4 and IPv6. */
function hamdhi_is_private_ip(string $ip): bool
{
    $ip = strtolower($ip);
    if (strpos($ip, ':') !== false) {
        if ($ip === '::1' || $ip === '::') {
            return true;
        }
        if (strpos($ip, 'fc') === 0 || strpos($ip, 'fd') === 0 || strpos($ip, 'fe80') === 0) {
            return true;
        }
        if (preg_match('/::ffff:(\d+\.\d+\.\d+\.\d+)$/', $ip, $m)) {
            return hamdhi_is_private_ipv4($m[1]);
        }
        return false;
    }
    return hamdhi_is_private_ipv4($ip);
}

/**
 * Validate a user supplied target URL.
 * Returns [url, errorMessage].
 */
function hamdhi_parse_target(string $raw): array
{
    $raw = trim($raw);
    $parts = parse_url($raw);
    if (!$parts || empty($parts['scheme']) || empty($parts['host'])) {
        return ['', '"' . $raw . '" is not a valid URL. Include the full http(s) address.'];
    }
    $scheme = strtolower($parts['scheme']);
    if ($scheme !== 'http' && $scheme !== 'https') {
        return ['', 'Unsupported protocol "' . $scheme . '". Only http and https are allowed.'];
    }
    $allowError = hamdhi_check_allow_list($raw);
    if ($allowError !== null) {
        return ['', $allowError];
    }
    $hostError = hamdhi_assert_host_allowed($parts['host']);
    if ($hostError !== null) {
        return ['', $hostError];
    }
    return [$raw, null];
}

        ['192.0.0.0', '192.0.0.255'],
        ['192.168.0.0', '192.168.255.255'],
        ['198.18.0.0', '198.19.255.255'],
        ['224.0.0.0', '239.255.255.255'],
        ['240.0.0.0', '255.255.255.255'],
    ];
    foreach ($ranges as $range) {

/**
 * Perform an HTTP request, following redirects manually.
 *
 * Returns ['body' => string, 'status' => int, 'contentType' => string,
 *          'url' => string] or ['error' => string].
 */
function hamdhi_fetch(string $targetUrl, string $method, array $headers, ?string $body): array
{
    $url = $targetUrl;
    $redirects = 0;

    for (;;) {
        list($url, $error) = hamdhi_parse_target($url);
        if ($error !== null) {
            return ['error' => $error];
        }

        $ch = curl_init();
        curl_setopt($ch, CURLOPT_URL, $url);
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($ch, CURLOPT_HEADER, true);
        curl_setopt($ch, CURLOPT_FOLLOWLOCATION, false);
        curl_setopt($ch, CURLOPT_TIMEOUT, HAMDHI_TIMEOUT_SECONDS);
        curl_setopt($ch, CURLOPT_CONNECTTIMEOUT, 15);
        curl_setopt($ch, CURLOPT_CUSTOMREQUEST, $method);
        curl_setopt($ch, CURLOPT_ENCODING, '');
        curl_setopt($ch, CURLOPT_USERAGENT, 'Hamdhi/2.0 (+https://github.com/hamdhi)');
        if (count($headers)) {
            curl_setopt($ch, CURLOPT_HTTPHEADER, $headers);
        }
        if ($body !== null && $body !== '' && $method !== 'GET' && $method !== 'HEAD') {
            curl_setopt($ch, CURLOPT_POSTFIELDS, $body);
        }

        $raw = curl_exec($ch);
        if ($raw === false) {
            $message = curl_error($ch);
            curl_close($ch);
            return ['error' => 'Could not reach ' . $url . ' - ' . $message . '.'];
        }
        $status = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        $headerSize = (int) curl_getinfo($ch, CURLINFO_HEADER_SIZE);
        $contentType = (string) curl_getinfo($ch, CURLINFO_CONTENT_TYPE);
        curl_close($ch);

        $responseHeaders = substr($raw, 0, $headerSize);
        $responseBody = substr($raw, $headerSize);

        if ($status >= 300 && $status < 400 && preg_match('/^location:\s*(.+)$/im', $responseHeaders, $m)) {
            if (++$redirects > HAMDHI_MAX_REDIRECTS) {
                return ['error' => 'Too many redirects.'];
            }
            $next = trim($m[1]);
            if (!preg_match('#^https?://#i', $next)) {
                $base = parse_url($url);
                $scheme = $base['scheme'] ?? 'https';
                $host = $base['host'] ?? '';
                $port = !empty($base['port']) ? ':' . $base['port'] : '';
                $next = $scheme . '://' . $host . $port . '/' . ltrim($next, '/');
            }
            $url = $next;
            continue;
        }

        if (strlen($responseBody) > HAMDHI_MAX_BYTES) {
            $responseBody = substr($responseBody, 0, HAMDHI_MAX_BYTES);
        }

        return [
            'body' => $responseBody,
            'status' => $status,
            'contentType' => $contentType,
            'url' => $url,
        ];
    }
}

        $start = ip2long($range[0]);
        $end = ip2long($range[1]);
        if ($long >= $start && $long <= $end) {
            return true;
        }
    }
    return false;
}
