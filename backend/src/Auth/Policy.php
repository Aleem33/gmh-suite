<?php

declare(strict_types=1);

namespace GMH\Backend\Auth;

use GMH\Backend\Http\ApiException;

final class Policy
{
    /** @var list<string> */
    private array $knownCollections;

    /** @param array<string, mixed> $collectionConfig */
    public function __construct(array $collectionConfig)
    {
        $this->knownCollections = $collectionConfig['allowed'];
    }

    public function assertKnownCollection(string $collection): void
    {
        if (!preg_match('/^[A-Za-z][A-Za-z0-9_-]{0,95}$/', $collection)
            || !in_array($collection, $this->knownCollections, true)) {
            throw new ApiException('This collection is not exposed by the API.', 404, 'unknown_collection');
        }
    }

    /** @param array<string, mixed>|null $document */
    public function canRead(AuthContext $user, string $collection, ?array $document = null, ?string $documentId = null): bool
    {
        if ($user->isAdmin()) {
            return true;
        }

        return match ($collection) {
            'users' => $documentId !== null && $documentId === $user->uid,
            'approvalRequests' => $document !== null && ($document['requestedBy'] ?? null) === $user->uid,
            'auditLogs' => false,
            'expenses', 'posExpenses' => in_array($user->role(), ['accountant', 'receptionist', 'pharmacist'], true)
                || $user->hasPermission('pos.expenses.view')
                || $user->hasPermission('pos.expenses.create'),
            'customerPayments' => $user->role() === 'cashier' || $user->hasPermission('pos.customers.view'),
            default => true,
        };
    }

    /** @param array<string, mixed>|null $existing @param array<string, mixed>|null $incoming */
    public function assertWrite(
        AuthContext $user,
        string $collection,
        string $operation,
        ?array $existing,
        ?array $incoming,
        string $documentId,
    ): void {
        $this->assertKnownCollection($collection);
        if ($collection === 'users'
            && $operation === 'create'
            && $user->profile === null
            && $documentId === $user->uid
            && strtolower($user->email) === 'admin@gmh-suite.internal'
            && ($incoming['role'] ?? null) === 'admin'
            && strtolower((string) ($incoming['email'] ?? '')) === 'admin@gmh-suite.internal') {
            return;
        }
        if ($user->isAdmin()) {
            return;
        }

        $role = $user->role();
        $username = $user->username();
        $isClinical = in_array($role, ['doctor', 'nurse'], true);
        $canReception = $role === 'receptionist' || $user->hasPermission('hms.reception.view');
        $canIpd = $isClinical || $canReception || $user->hasPermission('hms.ipd.view')
            || in_array($username, ['haseeb', 'sohail', 'haider'], true);
        $canHmsBilling = in_array($role, ['receptionist', 'accountant', 'cashier'], true)
            || $user->hasPermission('hms.billing.create') || $canReception || $user->hasPermission('hms.ipd.view');
        $canPosBilling = in_array($role, ['pharmacist', 'cashier'], true) || $user->hasPermission('pos.billing.create');
        $canPurchases = $role === 'pharmacist' || $user->hasPermission('pos.purchases.create');
        $delete = $operation === 'delete';
        $create = $operation === 'create';
        $allowed = false;

        if ($delete) {
            $allowed = in_array($collection, ['prescriptionTemplates'], true) && $role === 'doctor';
        } else {
            $allowed = match ($collection) {
                'users', 'settings', 'plans', 'staff' => false,
                'auditLogs' => $create,
                'patients', 'consultations' => $canReception || $isClinical,
                'appointments' => $create
                    ? ($canReception || $isClinical)
                    : ($canReception || $isClinical || $user->hasPermission('hms.vitals.view') || $user->hasPermission('hms.token.view')),
                'prescriptionTemplates' => $role === 'doctor',
                'medicines' => $create
                    ? ($role === 'pharmacist' || $user->hasPermission('pos.medicines.create') || $username === 'haseeb')
                    : ($canPosBilling || $canPurchases || $user->hasPermission('pos.purchaseReturns.create') || $user->hasPermission('pos.saleReturns.create')),
                'pharmacyOrders' => $create ? $canIpd : ($canPosBilling || $this->isIpdCancellation($user, $existing, $incoming)),
                'labTests' => in_array($role, ['lab', 'lab_technician'], true),
                'labOrders' => $create ? ($isClinical || $canReception) : (in_array($role, ['lab', 'lab_technician'], true) || $isClinical),
                'bills', 'payments' => $canHmsBilling,
                'expenses' => in_array($role, ['accountant'], true) || $this->isOwnPendingExpense($user, $incoming),
                'approvalRequests' => $create && $this->isAllowedApprovalRequest($user, $incoming),
                'suppliers' => in_array($role, ['accountant', 'pharmacist'], true) || ($create && $user->hasPermission('pos.suppliers.create')),
                'admissions', 'bedTreatments' => $canIpd,
                'wards', 'rooms' => $isClinical || $role === 'receptionist',
                'beds' => $create ? ($isClinical || $role === 'receptionist') : $canIpd,
                'notifications' => $create || (($existing['userId'] ?? null) === $user->uid),
                'counters' => true,
                'schedules' => $role === 'receptionist',
                'sales' => $create ? $canPosBilling : (in_array($role, ['pharmacist', 'cashier'], true) || $user->hasPermission('pos.sales.edit')),
                'quotations' => $username === 'haseeb' || $user->hasPermission('pos.quotations.create') || $user->hasPermission('pos.quotations.view'),
                'purchases' => $create ? $canPurchases : $role === 'pharmacist',
                'purchaseReturns' => $role === 'pharmacist' || $user->hasPermission('pos.purchaseReturns.create'),
                'saleReturns' => $role === 'cashier' || $user->hasPermission('pos.saleReturns.create'),
                'customers' => $create
                    ? ($role === 'cashier' || $user->hasPermission('pos.customers.create') || $username === 'haseeb')
                    : ($role === 'cashier' || $user->hasPermission('pos.customers.edit') || $user->hasPermission('pos.billing.create')),
                'customerPayments' => $role === 'cashier' || $user->hasPermission('pos.customers.payments'),
                'posExpenses' => $role === 'pharmacist' || $this->isOwnPendingExpense($user, $incoming),
                'posSales', 'posPurchases' => $role === 'pharmacist',
                default => false,
            };
        }

        if (!$allowed) {
            throw new ApiException('You do not have permission to perform this action.', 403, 'permission_denied', [
                'collection' => $collection,
                'operation' => $operation,
                'documentId' => $documentId,
            ]);
        }
    }

    /** @param array<string, mixed>|null $incoming */
    private function isOwnPendingExpense(AuthContext $user, ?array $incoming): bool
    {
        return $incoming !== null
            && ($incoming['status'] ?? null) === 'pending'
            && ($incoming['createdBy'] ?? null) === $user->uid
            && $user->hasPermission('pos.expenses.create');
    }

    /** @param array<string, mixed>|null $incoming */
    private function isAllowedApprovalRequest(AuthContext $user, ?array $incoming): bool
    {
        if ($incoming === null || ($incoming['status'] ?? null) !== 'pending' || ($incoming['requestedBy'] ?? null) !== $user->uid) {
            return false;
        }
        return match ($incoming['type'] ?? '') {
            'customerPayment' => $user->hasPermission('pos.customers.paymentRequests.create') || $user->username() === 'haseeb',
            'purchaseReturn' => $user->hasPermission('pos.purchaseReturns.request') || $user->username() === 'haseeb',
            'saleReturn' => $user->hasPermission('pos.saleReturns.request') || $user->username() === 'haseeb',
            default => false,
        };
    }

    /** @param array<string, mixed>|null $existing @param array<string, mixed>|null $incoming */
    private function isIpdCancellation(AuthContext $user, ?array $existing, ?array $incoming): bool
    {
        if ($existing === null || $incoming === null) {
            return false;
        }
        $changed = [];
        foreach (array_unique(array_merge(array_keys($existing), array_keys($incoming))) as $key) {
            if (json_encode($existing[$key] ?? null) !== json_encode($incoming[$key] ?? null)) {
                $changed[] = $key;
            }
        }
        sort($changed);
        $allowed = ['cancelledAt', 'cancelledBy', 'status'];
        sort($allowed);
        return ($existing['fulfillmentMode'] ?? null) === 'billing'
            && ($existing['status'] ?? null) === 'pending'
            && ($incoming['status'] ?? null) === 'cancelled'
            && ($incoming['cancelledBy'] ?? null) === $user->uid
            && $changed === $allowed;
    }
}
