<?php

declare(strict_types=1);

namespace GMH\Backend\Tests;

use GMH\Backend\Mirror\MirrorFailureClassifier;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

final class MirrorFailureClassifierTest extends TestCase
{
    /** @return iterable<string,array{int,string,bool,bool}> */
    public static function failures(): iterable
    {
        yield 'quota HTTP status' => [429, '', true, true];
        yield 'quota response body' => [403, 'RESOURCE_EXHAUSTED: daily quota exceeded', true, true];
        yield 'temporary server failure' => [503, 'unavailable', true, false];
        yield 'network failure' => [0, 'timeout', true, false];
        yield 'permanent invalid payload' => [400, 'invalid document', false, false];
    }

    #[DataProvider('failures')]
    public function testClassifiesRetryAndQuotaStates(int $status, string $body, bool $retryable, bool $quota): void
    {
        $result = (new MirrorFailureClassifier())->classify($status, $body);
        self::assertSame($retryable, $result['retryable']);
        self::assertSame($quota, $result['quota']);
    }
}
