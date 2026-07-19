<?php

declare(strict_types=1);

namespace GMH\Backend\Mirror;

final class MirrorFailureClassifier
{
    /** @return array{retryable:bool,quota:bool} */
    public function classify(int $status, string $body): array
    {
        $quota = $status === 429 || str_contains($body, 'RESOURCE_EXHAUSTED');
        $retryable = $quota || $status === 0 || $status === 408 || $status >= 500;
        return ['retryable' => $retryable, 'quota' => $quota];
    }
}
