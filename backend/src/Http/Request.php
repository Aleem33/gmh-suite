<?php

declare(strict_types=1);

namespace GMH\Backend\Http;

final class Request
{
    /** @var array<string, mixed>|null */
    private ?array $json = null;

    public function __construct(
        public readonly string $method,
        public readonly string $path,
        /** @var array<string, string> */
        public readonly array $query,
        /** @var array<string, string> */
        public readonly array $headers,
        public readonly string $rawBody,
    ) {
    }

    public static function fromGlobals(int $maxBodyBytes): self
    {
        $contentLength = (int) ($_SERVER['CONTENT_LENGTH'] ?? 0);
        if ($contentLength > $maxBodyBytes) {
            throw new ApiException('Request body is too large.', 413, 'payload_too_large');
        }

        $body = file_get_contents('php://input') ?: '';
        if (strlen($body) > $maxBodyBytes) {
            throw new ApiException('Request body is too large.', 413, 'payload_too_large');
        }

        $headers = [];
        $incomingHeaders = function_exists('getallheaders') ? (getallheaders() ?: []) : [];
        if (!$incomingHeaders) {
            foreach ($_SERVER as $name => $value) {
                if (str_starts_with($name, 'HTTP_')) {
                    $incomingHeaders[str_replace('_', '-', substr($name, 5))] = $value;
                }
            }
        }
        foreach ($incomingHeaders as $name => $value) {
            $headers[strtolower((string) $name)] = trim((string) $value);
        }

        $uri = (string) ($_SERVER['REQUEST_URI'] ?? '/');
        $path = parse_url($uri, PHP_URL_PATH) ?: '/';

        return new self(
            strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET')),
            rtrim($path, '/') ?: '/',
            array_map('strval', $_GET),
            $headers,
            $body,
        );
    }

    /** @return array<string, mixed> */
    public function json(): array
    {
        if ($this->json !== null) {
            return $this->json;
        }
        if ($this->rawBody === '') {
            return $this->json = [];
        }

        $decoded = json_decode($this->rawBody, true);
        if (!is_array($decoded)) {
            throw new ApiException('Request body must be valid JSON.', 400, 'invalid_json');
        }
        return $this->json = $decoded;
    }

    public function header(string $name): ?string
    {
        return $this->headers[strtolower($name)] ?? null;
    }
}
