<?php

declare(strict_types=1);

namespace GMH\Backend\Tests;

use GMH\Backend\Auth\AuthContext;
use GMH\Backend\Auth\Policy;
use GMH\Backend\Http\ApiException;
use PHPUnit\Framework\TestCase;

final class PolicyTest extends TestCase
{
    private Policy $policy;

    protected function setUp(): void
    {
        $this->policy = new Policy(require dirname(__DIR__) . '/config/collections.php');
    }

    public function testAdminCanWriteAnyKnownCollection(): void
    {
        $admin = $this->user('admin', 'admin');
        $this->policy->assertWrite($admin, 'settings', 'update', [], ['name' => 'GMH'], 'hospital');
        self::assertTrue(true);
    }

    public function testHaseebCanRequestReturnsAndCreateQuotations(): void
    {
        $haseeb = $this->user('custom', 'haseeb', [
            'pos.purchaseReturns.request' => true,
            'pos.quotations.create' => true,
        ]);
        $this->policy->assertWrite($haseeb, 'approvalRequests', 'create', null, [
            'type' => 'purchaseReturn', 'status' => 'pending', 'requestedBy' => 'uid-1',
        ], 'request-1');
        $this->policy->assertWrite($haseeb, 'quotations', 'create', null, ['items' => []], 'quote-1');
        self::assertTrue(true);
    }

    public function testSohailHasUsernameFallbackForIpdPharmacyOrder(): void
    {
        $sohail = $this->user('custom', 'sohail');
        $this->policy->assertWrite($sohail, 'pharmacyOrders', 'create', null, [
            'status' => 'pending', 'fulfillmentMode' => 'billing',
        ], 'order-1');
        self::assertTrue(true);
    }

    public function testNonAdminCannotApproveRequest(): void
    {
        $this->expectException(ApiException::class);
        $user = $this->user('custom', 'haseeb');
        $this->policy->assertWrite($user, 'approvalRequests', 'update', [
            'status' => 'pending', 'requestedBy' => 'uid-1',
        ], ['status' => 'approved'], 'request-1');
    }

    /** @param array<string,bool> $permissions */
    private function user(string $role, string $username, array $permissions = []): AuthContext
    {
        return new AuthContext('uid-1', $username . '@gmh-suite.internal', [], [
            'uid' => 'uid-1', 'role' => $role, 'username' => $username, 'permissions' => $permissions,
        ]);
    }
}
