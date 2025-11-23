<?php
$scheme = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') ? 'https' : 'http';
$defaultOrigin = isset($_SERVER['HTTP_HOST']) ? sprintf('%s://%s', $scheme, $_SERVER['HTTP_HOST']) : '';
$origin = $_SERVER['HTTP_ORIGIN'] ?? $defaultOrigin;
$originHost = parse_url($origin, PHP_URL_HOST);
$hostMatches = $originHost && isset($_SERVER['HTTP_HOST']) && $originHost === $_SERVER['HTTP_HOST'];

if ($origin && $hostMatches) {
    header("Access-Control-Allow-Origin: {$origin}");
    header('Vary: Origin');
}

header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    exit;
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['error' => 'Method not allowed.']);
    exit;
}

$input = json_decode(file_get_contents('php://input'), true);

if (!is_array($input)) {
    http_response_code(400);
    echo json_encode(['error' => 'Invalid JSON body.']);
    exit;
}

$allowedRegions = [
    'us' => 'https://aggregations-dot-pendo-io.gke.us.pendo.io',
    'eu' => 'https://aggregations-dot-pendo-io.gke.eu.pendo.io',
];

$region = $input['region'] ?? '';
$subId = $input['subId'] ?? '';
$token = $input['token'] ?? '';
$payload = $input['payload'] ?? null;

if (!isset($allowedRegions[$region])) {
    http_response_code(400);
    echo json_encode(['error' => 'Unsupported region value.']);
    exit;
}

if (!is_string($subId) || !preg_match('/^\d{4,}$/', $subId)) {
    http_response_code(400);
    echo json_encode(['error' => 'Invalid Sub ID.']);
    exit;
}

if (!is_string($token) || !preg_match('/^[A-Za-z0-9._\-]+=*$/', $token)) {
    http_response_code(400);
    echo json_encode(['error' => 'Invalid or missing pendo.sess.jwt2 token.']);
    exit;
}

if (!is_array($payload)) {
    http_response_code(400);
    echo json_encode(['error' => 'Payload must be a JSON object.']);
    exit;
}

$baseUrl = rtrim($allowedRegions[$region], '/');
$aggregationUrl = sprintf('%s/api/s/%s/aggregation?all=true&cachepolicy=all:ignore', $baseUrl, rawurlencode($subId));

$ch = curl_init($aggregationUrl);

curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_POST => true,
    CURLOPT_FOLLOWLOCATION => true,
    CURLOPT_MAXREDIRS => 5,
    CURLOPT_HTTPHEADER => [
        'Content-Type: application/json',
        'Accept: application/json',
        'Cookie: pendo.sess.jwt2=' . $token,
    ],
    CURLOPT_POSTFIELDS => json_encode($payload),
]);

$responseBody = curl_exec($ch);
$statusCode = curl_getinfo($ch, CURLINFO_RESPONSE_CODE) ?: 500;
$contentType = curl_getinfo($ch, CURLINFO_CONTENT_TYPE) ?: 'application/json';
$error = curl_error($ch);

curl_close($ch);

if ($responseBody === false) {
    http_response_code(502);
    echo json_encode(['error' => 'Failed to contact Aggregations API.', 'details' => $error]);
    exit;
}

header('Content-Type: ' . $contentType);
http_response_code($statusCode);
echo $responseBody;
