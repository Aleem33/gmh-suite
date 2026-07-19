<?php

declare(strict_types=1);

namespace GMH\Backend\Service;

use GMH\Backend\Auth\AuthContext;
use GMH\Backend\Auth\Policy;
use GMH\Backend\Http\ApiException;
use GMH\Backend\Repository\DocumentRepository;
use GMH\Backend\Repository\EventRepository;
use PDO;
use Throwable;

final class DocumentService
{
    public function __construct(
        private readonly PDO $pdo,
        private readonly DocumentRepository $documents,
        private readonly EventRepository $events,
        private readonly Policy $policy,
    ) {
    }

    /** @return array<string, mixed> */
    public function get(AuthContext $user, string $collection, string $id): array
    {
        $this->policy->assertKnownCollection($collection);
        $this->assertDocumentId($id);
        $document = $this->documents->find($collection, $id);
        if (!$document || !$this->policy->canRead($user, $collection, $document['data'], $id)) {
            throw new ApiException('The requested record was not found.', 404, 'not_found');
        }
        return $this->publicDocument($document);
    }

    /** @param list<array{field:string,op:string,value:mixed}> $filters @return array<string, mixed> */
    public function list(
        AuthContext $user,
        string $collection,
        array $filters,
        ?string $orderField,
        string $orderDirection,
        int $limit,
        ?string $after,
    ): array {
        $this->policy->assertKnownCollection($collection);
        $result = $this->documents->list($collection, $filters, $orderField, $orderDirection, $limit, $after);
        $visible = array_values(array_filter(
            $result['documents'],
            fn (array $document): bool => $this->policy->canRead($user, $collection, $document['data'], $document['id']),
        ));
        return [
            'documents' => array_map(fn (array $document): array => $this->publicDocument($document), $visible),
            'nextCursor' => $result['nextCursor'],
            'snapshotCursor' => $result['snapshotCursor'],
        ];
    }

    /** @param array<string, mixed> $data @return array<string, mixed> */
    public function write(
        AuthContext $user,
        string $collection,
        string $id,
        array $data,
        ?int $expectedVersion,
        bool $merge,
    ): array {
        $this->policy->assertKnownCollection($collection);
        $this->assertDocumentId($id);
        $existing = $this->documents->find($collection, $id, forUpdate: true, includeDeleted: true);
        $operation = !$existing || $existing['deleted'] ? 'create' : 'update';
        $incoming = $merge && $existing ? array_replace($existing['data'], $data) : $data;
        $this->policy->assertWrite($user, $collection, $operation, $existing['data'] ?? null, $incoming, $id);
        $saved = $this->documents->upsert($collection, $id, $data, $expectedVersion, $user->uid, $user->username(), $merge);
        return $this->publicDocument($saved);
    }

    public function delete(AuthContext $user, string $collection, string $id, ?int $expectedVersion): void
    {
        $this->policy->assertKnownCollection($collection);
        $this->assertDocumentId($id);
        $existing = $this->documents->find($collection, $id, forUpdate: true);
        if (!$existing) {
            throw new ApiException('The requested record was not found.', 404, 'not_found');
        }
        $this->policy->assertWrite($user, $collection, 'delete', $existing['data'], null, $id);
        $this->documents->delete($collection, $id, $expectedVersion, $user->uid, $user->username());
    }

    /** @param list<array<string,mixed>> $mutations @param list<array<string,mixed>> $reads @return array<string,mixed> */
    public function atomic(AuthContext $user, array $mutations, array $reads = []): array
    {
        if (count($mutations) > 500 || count($reads) > 500) {
            throw new ApiException('An atomic command cannot contain more than 500 records.', 422, 'batch_too_large');
        }
        $keys = [];
        foreach (array_merge($reads, $mutations) as $item) {
            $collection = (string) ($item['collection'] ?? '');
            $id = (string) ($item['id'] ?? '');
            $this->assertDocumentId($id);
            $this->policy->assertKnownCollection($collection);
            $keys["{$collection}\0{$id}"] = [$collection, $id];
        }
        ksort($keys);

        $manageTransaction = !$this->pdo->inTransaction();
        if ($manageTransaction) {
            $this->pdo->beginTransaction();
        }
        try {
            $locked = [];
            foreach ($keys as $key => [$collection, $id]) {
                $locked[$key] = $this->documents->find($collection, $id, forUpdate: true, includeDeleted: true);
            }
            foreach ($reads as $read) {
                $key = $read['collection'] . "\0" . $read['id'];
                $actual = (int) ($locked[$key]['version'] ?? 0);
                if (array_key_exists('expectedVersion', $read) && (int) $read['expectedVersion'] !== $actual) {
                    throw new ApiException('A record changed while this operation was in progress. Please retry.', 409, 'version_conflict', [
                        'collection' => $read['collection'], 'id' => $read['id'],
                        'expectedVersion' => (int) $read['expectedVersion'], 'actualVersion' => $actual,
                    ]);
                }
            }

            $saved = [];
            foreach ($mutations as $mutation) {
                $collection = (string) $mutation['collection'];
                $id = (string) $mutation['id'];
                $key = $collection . "\0" . $id;
                $existing = $locked[$key] ?? null;
                $type = (string) ($mutation['type'] ?? 'set');
                $expected = array_key_exists('expectedVersion', $mutation) ? (int) $mutation['expectedVersion'] : null;
                if ($type === 'delete') {
                    if (!$existing || $existing['deleted']) {
                        throw new ApiException('A record required by this operation no longer exists.', 404, 'not_found', compact('collection', 'id'));
                    }
                    $this->policy->assertWrite($user, $collection, 'delete', $existing['data'], null, $id);
                    $this->documents->delete($collection, $id, $expected, $user->uid, $user->username());
                    $saved[] = ['collection' => $collection, 'id' => $id, 'deleted' => true];
                    continue;
                }

                $data = $mutation['data'] ?? null;
                if (!is_array($data)) {
                    throw new ApiException('Mutation data must be an object.', 422, 'invalid_mutation');
                }
                $merge = $type === 'update' || ($mutation['merge'] ?? false) === true;
                $operation = !$existing || $existing['deleted'] ? 'create' : 'update';
                $incoming = $merge && $existing ? array_replace($existing['data'], $data) : $data;
                $this->policy->assertWrite($user, $collection, $operation, $existing['data'] ?? null, $incoming, $id);
                $document = $this->documents->upsert($collection, $id, $data, $expected, $user->uid, $user->username(), $merge);
                $saved[] = $this->publicDocument($document);
                $locked[$key] = $document;
            }
            $this->validateInvariants($saved);
            if ($manageTransaction) {
                $this->pdo->commit();
            }
            return ['documents' => $saved, 'cursor' => $this->latestCursor()];
        } catch (Throwable $exception) {
            if ($manageTransaction && $this->pdo->inTransaction()) {
                $this->pdo->rollBack();
            }
            throw $exception;
        }
    }

    /** @param list<string> $collections @return array<string,mixed> */
    public function changes(AuthContext $user, int $after, array $collections, int $limit): array
    {
        foreach ($collections as $collection) {
            $this->policy->assertKnownCollection($collection);
        }
        $result = $this->events->changesAfter($after, $collections, $limit);
        $result['events'] = array_values(array_filter($result['events'], function (array $event) use ($user): bool {
            return $this->policy->canRead($user, $event['collection'], $event['data'], $event['id']);
        }));
        return $result;
    }

    /** @param array<string,mixed> $document @return array<string,mixed> */
    private function publicDocument(array $document): array
    {
        return [
            'collection' => $document['collection'],
            'id' => $document['id'],
            'data' => $document['data'],
            'version' => $document['version'],
            'createdAt' => $document['createdAt'],
            'updatedAt' => $document['updatedAt'],
        ];
    }

    private function assertDocumentId(string $id): void
    {
        if ($id === '' || strlen($id) > 192 || str_contains($id, '/') || preg_match('/[\x00-\x1F]/', $id)) {
            throw new ApiException('Invalid document ID.', 422, 'invalid_document_id');
        }
    }

    /** @param list<array<string,mixed>> $saved */
    private function validateInvariants(array $saved): void
    {
        foreach ($saved as $document) {
            if (($document['collection'] ?? null) === 'medicines' && isset($document['data']['stock']) && (float) $document['data']['stock'] < 0) {
                throw new ApiException('Insufficient medicine stock for this operation.', 409, 'insufficient_stock', [
                    'medicineId' => $document['id'],
                ]);
            }
            if (($document['collection'] ?? null) === 'customers'
                && isset($document['data']['creditBalance'])
                && (float) $document['data']['creditBalance'] < -0.00001) {
                throw new ApiException('The customer payment exceeds the current credit balance.', 409, 'payment_exceeds_balance', [
                    'customerId' => $document['id'],
                ]);
            }
        }
    }

    private function latestCursor(): int
    {
        return (int) $this->pdo->query('SELECT COALESCE(MAX(sequence_id), 0) FROM document_events')->fetchColumn();
    }
}
