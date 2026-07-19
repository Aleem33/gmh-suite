<?php

declare(strict_types=1);

namespace GMH\Backend\Http;

use RuntimeException;

final class ApiException extends RuntimeException
{
    /** @param array<string, mixed> $details */
    public function __construct(
        string $message,
        public readonly int $status = 400,
        public readonly string $errorCode = 'bad_request',
        public readonly array $details = [],
    ) {
        parent::__construct($message);
    }
}
