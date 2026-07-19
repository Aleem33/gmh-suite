<?php

declare(strict_types=1);

namespace GMH\Backend\Tests;

use GMH\Backend\Mirror\FirestoreValueEncoder;
use PHPUnit\Framework\TestCase;

final class FirestoreValueEncoderTest extends TestCase
{
    public function testEncodesCompleteNestedDocumentWithoutReads(): void
    {
        $encoded = (new FirestoreValueEncoder())->document([
            'name' => 'Medicine A',
            'stock' => 12,
            'price' => 21.5,
            'active' => true,
            'optional' => null,
            'items' => [['medicineId' => 'm1', 'quantity' => 2]],
        ]);

        self::assertSame('Medicine A', $encoded['fields']['name']['stringValue']);
        self::assertSame('12', $encoded['fields']['stock']['integerValue']);
        self::assertSame(21.5, $encoded['fields']['price']['doubleValue']);
        self::assertTrue($encoded['fields']['active']['booleanValue']);
        self::assertArrayHasKey('nullValue', $encoded['fields']['optional']);
        self::assertSame(
            'm1',
            $encoded['fields']['items']['arrayValue']['values'][0]['mapValue']['fields']['medicineId']['stringValue'],
        );
    }
}
