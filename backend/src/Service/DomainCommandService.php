<?php

declare(strict_types=1);

namespace GMH\Backend\Service;

use GMH\Backend\Auth\AuthContext;
use GMH\Backend\Http\ApiException;
use GMH\Backend\Repository\DocumentRepository;
use PDO;

final class DomainCommandService
{
    public const COMMANDS = [
        'transaction', 'pharmacy-checkout', 'purchase-create', 'purchase-stock-repair',
        'purchase-return', 'sale-return', 'approval-review', 'customer-payment',
        'ipd-admit', 'ipd-order-create', 'ipd-order-cancel', 'ipd-discharge', 'pharmacy-dispense',
        'notifications-read',
    ];

    public function __construct(
        private readonly PDO $pdo,
        private readonly DocumentRepository $documents,
        private readonly DocumentService $documentService,
    ) {
    }

    /** @param array<string,mixed> $payload @return array<string,mixed> */
    public function execute(AuthContext $user, string $command, array $payload): array
    {
        if (!in_array($command, self::COMMANDS, true)) {
            throw new ApiException('Unknown atomic command.', 404, 'unknown_command');
        }
        if ($command === 'notifications-read' && isset($payload['ids'])) {
            return $this->notificationsRead($user, $payload);
        }

        $mutations = $payload['mutations'] ?? null;
        $reads = $payload['reads'] ?? [];
        if (!is_array($mutations) || !is_array($reads)) {
            throw new ApiException('This command requires reads and mutations arrays.', 422, 'invalid_command_payload');
        }
        $this->validateShape($user, $command, $mutations);
        return $this->documentService->atomic($user, $mutations, $reads);
    }

    /** @return array<string,mixed> */
    public function nextCounter(AuthContext $user, string $counter, string $prefix): array
    {
        if (!preg_match('/^[a-z][a-z0-9_-]{0,31}$/', $counter) || !preg_match('/^[A-Z][A-Z0-9-]{0,15}$/', $prefix)) {
            throw new ApiException('Invalid counter.', 422, 'invalid_counter');
        }
        if ($counter === 'mrn' && $prefix === 'MRN') {
            $this->acquireMrnLock();
            try {
                return $this->allocateMrn($user);
            } finally {
                $this->releaseMrnLock();
            }
        }
        $existing = $this->documents->find('counters', $counter, forUpdate: true, includeDeleted: true);
        $value = max(0, (int) ($existing['data']['value'] ?? 0)) + 1;
        $saved = $this->documents->upsert(
            'counters', $counter, ['value' => $value], $existing ? (int) $existing['version'] : 0,
            $user->uid, $user->username(), true,
        );
        return [
            'value' => $value,
            'formatted' => $prefix . '-' . str_pad((string) $value, 5, '0', STR_PAD_LEFT),
            'documentVersion' => $saved['version'],
        ];
    }

    /** @param array<string,mixed> $data @return array{document:array<string,mixed>,mrn:string} */
    public function createPatient(AuthContext $user, array $data): array
    {
        if (array_key_exists('mrn', $data)) {
            throw new ApiException('MRN is assigned by the server.', 422, 'mrn_server_managed');
        }
        $this->acquireMrnLock();
        try {
            $allocated = $this->allocateMrn($user);
            $id = rtrim(strtr(base64_encode(random_bytes(15)), '+/', '-_'), '=');
            $document = $this->documentService->write(
                $user,
                'patients',
                $id,
                [...$data, 'mrn' => $allocated['formatted']],
                0,
                false,
            );
            return ['document' => $document, 'mrn' => $allocated['formatted']];
        } finally {
            $this->releaseMrnLock();
        }
    }

    /** @param array<string,mixed> $data @return array<string,mixed> */
    public function createPatientWithReservedMrn(AuthContext $user, string $id, array $data): array
    {
        $mrn = (string) ($data['mrn'] ?? '');
        if (!preg_match('/^MRN-(\d+)$/', $mrn, $matches) || (int) $matches[1] < 1) {
            throw new ApiException('A valid reserved MRN is required.', 422, 'invalid_mrn');
        }
        $number = (int) $matches[1];
        $this->acquireMrnLock();
        try {
            $patientMrns = $this->lockActivePatientMrns();
            if (isset($patientMrns['numbers'][$number])) {
                throw new ApiException('This MRN is already assigned to another patient.', 409, 'duplicate_mrn');
            }
            $counter = $this->documents->find('counters', 'mrn', forUpdate: true, includeDeleted: true);
            if (!$counter || $number > max(0, (int) ($counter['data']['value'] ?? 0))) {
                throw new ApiException('This MRN was not reserved by the server.', 409, 'unreserved_mrn');
            }
            return $this->documentService->write($user, 'patients', $id, $data, 0, false);
        } finally {
            $this->releaseMrnLock();
        }
    }

    /** @return array{value:int,formatted:string,documentVersion:int} */
    private function allocateMrn(AuthContext $user): array
    {
        $patientMrns = $this->lockActivePatientMrns();
        $maximumPatientMrn = $patientMrns['maximum'];
        $existing = $this->documents->find('counters', 'mrn', forUpdate: true, includeDeleted: true);
        $value = max($maximumPatientMrn, max(0, (int) ($existing['data']['value'] ?? 0))) + 1;
        $saved = $this->documents->upsert(
            'counters',
            'mrn',
            ['value' => $value],
            $existing ? (int) $existing['version'] : 0,
            $user->uid,
            $user->username(),
            true,
        );
        return [
            'value' => $value,
            'formatted' => 'MRN-' . str_pad((string) $value, 5, '0', STR_PAD_LEFT),
            'documentVersion' => $saved['version'],
        ];
    }

    /** @return array{maximum:int,numbers:array<int,bool>} */
    private function lockActivePatientMrns(): array
    {
        $maximum = 0;
        $numbers = [];
        $statement = $this->pdo->query(
            "SELECT data FROM documents
              WHERE collection_name = 'patients' AND deleted_at IS NULL
              ORDER BY document_id FOR UPDATE"
        );
        foreach ($statement->fetchAll() as $row) {
            $data = json_decode((string) $row['data'], true, 512, JSON_THROW_ON_ERROR);
            if (preg_match('/^MRN-(\d+)$/', (string) ($data['mrn'] ?? ''), $matches)) {
                $number = (int) $matches[1];
                if ($number > 0) {
                    $maximum = max($maximum, $number);
                    $numbers[$number] = true;
                }
            }
        }
        return ['maximum' => $maximum, 'numbers' => $numbers];
    }

    private function acquireMrnLock(): void
    {
        $statement = $this->pdo->prepare('SELECT GET_LOCK(?, 15)');
        $statement->execute(['gmh:mrn-sequence']);
        if ((int) $statement->fetchColumn() !== 1) {
            throw new ApiException('Patient registration is busy. Please try again.', 409, 'mrn_lock_timeout');
        }
    }

    private function releaseMrnLock(): void
    {
        $statement = $this->pdo->prepare('SELECT RELEASE_LOCK(?)');
        $statement->execute(['gmh:mrn-sequence']);
    }

    /** @param array<string,mixed> $payload @return array<string,mixed> */
    private function notificationsRead(AuthContext $user, array $payload): array
    {
        $ids = array_values(array_unique(array_filter($payload['ids'] ?? [], 'is_string')));
        $mutations = [];
        foreach ($ids as $id) {
            $document = $this->documents->find('notifications', $id);
            if (!$document || (!$user->isAdmin() && ($document['data']['userId'] ?? null) !== $user->uid)) {
                continue;
            }
            $mutations[] = [
                'type' => 'update', 'collection' => 'notifications', 'id' => $id,
                'expectedVersion' => $document['version'], 'data' => ['read' => true],
            ];
        }
        return $this->documentService->atomic($user, $mutations);
    }

    /** @param list<array<string,mixed>> $mutations */
    private function validateShape(AuthContext $user, string $command, array $mutations): void
    {
        if ($command === 'transaction') {
            return;
        }
        $collections = array_values(array_unique(array_map(
            static fn (array $mutation): string => (string) ($mutation['collection'] ?? ''),
            $mutations,
        )));
        $required = match ($command) {
            'pharmacy-checkout' => ['sales', 'medicines'],
            'purchase-create', 'purchase-stock-repair' => ['purchases', 'medicines'],
            'purchase-return' => ['purchaseReturns', 'purchases', 'medicines'],
            'sale-return' => ['saleReturns', 'sales', 'medicines'],
            'customer-payment' => ['customerPayments', 'sales', 'customers'],
            'ipd-admit' => ['admissions'],
            'ipd-order-create', 'ipd-order-cancel' => ['pharmacyOrders', 'bedTreatments'],
            'ipd-discharge' => ['admissions', 'bills'],
            'pharmacy-dispense' => ['pharmacyOrders', 'medicines'],
            'notifications-read' => ['notifications'],
            'approval-review' => ['approvalRequests'],
            default => [],
        };
        foreach ($required as $collection) {
            if (!in_array($collection, $collections, true)) {
                throw new ApiException("The {$command} command is missing {$collection} data.", 422, 'invalid_command_shape');
            }
        }
        if (in_array($command, ['approval-review', 'purchase-stock-repair'], true) && !$user->isAdmin()) {
            throw new ApiException('Administrator access is required for this command.', 403, 'permission_denied');
        }
        if ($command === 'purchase-create') {
            $purchase = $this->firstMutation($mutations, 'purchases');
            $data = $purchase['data'] ?? [];
            if (empty($data['stockAppliedAt']) || !isset($data['stockBefore'], $data['stockAfter'])) {
                throw new ApiException('Purchase stock markers are required.', 422, 'purchase_stock_markers_required');
            }
            $units = (float) ($data['totalUnitsAdded'] ?? $data['unitsAdded'] ?? 0);
            if ($units <= 0 || abs(((float) $data['stockAfter'] - (float) $data['stockBefore']) - $units) > 0.00001) {
                throw new ApiException('Purchase quantity does not match its stock before/after markers.', 422, 'purchase_stock_mismatch');
            }
            $medicineId = (string) ($data['medicineId'] ?? '');
            $medicineMutation = $this->findMutation($mutations, 'medicines', $medicineId);
            if ($medicineId === ''
                || !isset($medicineMutation['data']['stock'])
                || abs((float) $medicineMutation['data']['stock'] - (float) $data['stockAfter']) > 0.00001) {
                throw new ApiException('Purchase medicine stock does not match the purchase record.', 422, 'purchase_stock_mismatch');
            }
        }
        if ($command === 'pharmacy-checkout') {
            $sale = $this->firstMutation($mutations, 'sales');
            $items = $sale['data']['items'] ?? null;
            if (!is_array($items) || $items === []) {
                throw new ApiException('A pharmacy checkout must contain sale items.', 422, 'empty_sale');
            }
            $expectedDeductions = [];
            foreach ($items as $item) {
                $medicineId = (string) ($item['medicineId'] ?? '');
                $quantity = (float) ($item['quantity'] ?? 0);
                $unitsPerBox = ($item['sellType'] ?? 'unit') === 'box' ? (float) ($item['unitsPerBox'] ?? 0) : 1.0;
                if ($medicineId === '' || $quantity <= 0 || $unitsPerBox <= 0) {
                    throw new ApiException('The sale contains an invalid stock item.', 422, 'invalid_sale_item');
                }
                $expectedDeductions[$medicineId] = ($expectedDeductions[$medicineId] ?? 0) + ($quantity * $unitsPerBox);
            }
            foreach ($expectedDeductions as $medicineId => $units) {
                $mutation = $this->findMutation($mutations, 'medicines', $medicineId);
                $transform = $mutation['data']['stock'] ?? null;
                if (!is_array($transform)
                    || ($transform['__gmhTransform'] ?? null) !== 'increment'
                    || abs((float) ($transform['operand'] ?? 0) + $units) > 0.00001) {
                    throw new ApiException('Sale stock deductions do not match the saved items.', 422, 'stock_mismatch', [
                        'medicineId' => $medicineId,
                    ]);
                }
            }
        }
        if ($command === 'ipd-discharge') {
            $admission = $this->firstMutation($mutations, 'admissions');
            $this->assertNoPendingIpdOrders((string) ($admission['id'] ?? ''));
        }
    }

    /** @param list<array<string,mixed>> $mutations @return array<string,mixed> */
    private function firstMutation(array $mutations, string $collection): array
    {
        foreach ($mutations as $mutation) {
            if (($mutation['collection'] ?? null) === $collection) {
                return $mutation;
            }
        }
        return [];
    }

    /** @param list<array<string,mixed>> $mutations @return array<string,mixed> */
    private function findMutation(array $mutations, string $collection, string $id): array
    {
        foreach ($mutations as $mutation) {
            if (($mutation['collection'] ?? null) === $collection && ($mutation['id'] ?? null) === $id) {
                return $mutation;
            }
        }
        return [];
    }

    private function assertNoPendingIpdOrders(string $admissionId): void
    {
        if ($admissionId === '') {
            throw new ApiException('The discharge command has no admission ID.', 422, 'invalid_command_shape');
        }
        $statement = $this->pdo->query(
            "SELECT document_id, data FROM documents
              WHERE collection_name = 'pharmacyOrders' AND deleted_at IS NULL FOR UPDATE"
        );
        foreach ($statement->fetchAll() as $row) {
            $order = json_decode((string) $row['data'], true, 512, JSON_THROW_ON_ERROR);
            if (($order['admissionId'] ?? null) === $admissionId
                && ($order['fulfillmentMode'] ?? null) === 'billing'
                && ($order['status'] ?? null) === 'pending') {
                throw new ApiException(
                    'This admission still has a pending Pharmacy order. Complete or cancel it before discharge.',
                    409,
                    'pending_pharmacy_order',
                    ['pharmacyOrderId' => $row['document_id']],
                );
            }
        }
    }
}
