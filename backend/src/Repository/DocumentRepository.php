<?php

declare(strict_types=1);

namespace GMH\Backend\Repository;

use DateTimeImmutable;
use DateTimeZone;
use GMH\Backend\Http\ApiException;
use PDO;

final class DocumentRepository
{
    /** @var array<string, mixed> */
    private array $collectionConfig;

    /** @param array<string, mixed> $collectionConfig */
    public function __construct(private readonly PDO $pdo, array $collectionConfig)
    {
        $this->collectionConfig = $collectionConfig;
    }

    /** @return array<string, mixed>|null */
    public function find(string $collection, string $documentId, bool $forUpdate = false, bool $includeDeleted = false): ?array
    {
        $sql = 'SELECT collection_name, document_id, data, version, created_at, updated_at, deleted_at
                  FROM documents WHERE collection_name = ? AND document_id = ?';
        if (!$includeDeleted) {
            $sql .= ' AND deleted_at IS NULL';
        }
        if ($forUpdate) {
            $sql .= ' FOR UPDATE';
        }
        $statement = $this->pdo->prepare($sql);
        $statement->execute([$collection, $documentId]);
        $row = $statement->fetch();
        return $row ? $this->hydrate($row) : null;
    }

    /** @return array<string, mixed>|null */
    public function findData(string $collection, string $documentId, bool $includeDeleted = false): ?array
    {
        $document = $this->find($collection, $documentId, includeDeleted: $includeDeleted);
        return $document['data'] ?? null;
    }

    /** @param list<array{field:string,op:string,value:mixed}> $filters @return array{documents:list<array<string,mixed>>,nextCursor:?string,snapshotCursor:int} */
    public function list(
        string $collection,
        array $filters,
        ?string $orderField,
        string $orderDirection,
        int $limit,
        ?string $afterDocumentId,
    ): array {
        $joinParameters = [];
        $whereParameters = [$collection];
        $joins = [];
        $conditions = ['d.collection_name = ?', 'd.deleted_at IS NULL'];
        foreach ($filters as $index => $filter) {
            $alias = 'i' . $index;
            $this->assertIndexedField($collection, $filter['field']);
            $joins[] = "JOIN document_indexes {$alias} ON {$alias}.collection_name = d.collection_name AND {$alias}.document_id = d.document_id AND {$alias}.field_name = ?";
            $joinParameters[] = $filter['field'];
            [$column, $value] = $this->indexColumnAndValue($filter['value']);
            $operator = match ($filter['op']) {
                '==', '=', 'eq' => '=',
                '>=', 'gte' => '>=',
                '<=', 'lte' => '<=',
                '>', 'gt' => '>',
                '<', 'lt' => '<',
                default => throw new ApiException('Unsupported query operator.', 422, 'invalid_query'),
            };
            $conditions[] = "{$alias}.{$column} {$operator} ?";
            $whereParameters[] = $value;
        }
        if ($afterDocumentId !== null && $afterDocumentId !== '') {
            $conditions[] = 'd.document_id > ?';
            $whereParameters[] = $afterDocumentId;
        }

        $orderSql = 'd.document_id ASC';
        if ($orderField) {
            $this->assertIndexedField($collection, $orderField);
            $joins[] = 'LEFT JOIN document_indexes io ON io.collection_name = d.collection_name AND io.document_id = d.document_id AND io.field_name = ?';
            $joinParameters[] = $orderField;
            $direction = strtoupper($orderDirection) === 'DESC' ? 'DESC' : 'ASC';
            $orderSql = "COALESCE(io.date_value, io.number_value, io.string_value) {$direction}, d.document_id {$direction}";
        }

        $sql = 'SELECT DISTINCT d.collection_name, d.document_id, d.data, d.version, d.created_at, d.updated_at, d.deleted_at
                  FROM documents d ' . implode(' ', $joins) . '
                 WHERE ' . implode(' AND ', $conditions) . " ORDER BY {$orderSql} LIMIT " . ($limit + 1);
        $statement = $this->pdo->prepare($sql);
        $statement->execute(array_merge($joinParameters, $whereParameters));
        $rows = $statement->fetchAll();
        $hasMore = count($rows) > $limit;
        if ($hasMore) {
            array_pop($rows);
        }
        $documents = array_map(fn (array $row): array => $this->hydrate($row), $rows);
        $cursor = (int) $this->pdo->query('SELECT COALESCE(MAX(sequence_id), 0) FROM document_events')->fetchColumn();

        return [
            'documents' => $documents,
            'nextCursor' => $hasMore && $rows ? (string) end($rows)['document_id'] : null,
            'snapshotCursor' => $cursor,
        ];
    }

    /** @param array<string, mixed> $data @return array<string, mixed> */
    public function upsert(
        string $collection,
        string $documentId,
        array $data,
        ?int $expectedVersion,
        string $actorUid,
        string $actorUsername,
        bool $merge = false,
    ): array {
        $existing = $this->find($collection, $documentId, forUpdate: true, includeDeleted: true);
        $currentVersion = (int) ($existing['version'] ?? 0);
        if ($expectedVersion !== null && $expectedVersion !== $currentVersion) {
            throw new ApiException('This record changed on another device. Refresh and try again.', 409, 'version_conflict', [
                'expectedVersion' => $expectedVersion,
                'actualVersion' => $currentVersion,
            ]);
        }

        $base = $merge && $existing ? $existing['data'] : [];
        $resolved = $this->applyPatch($base, $data);
        $version = $currentVersion + 1;
        $json = json_encode($resolved, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
        $statement = $this->pdo->prepare(
            'INSERT INTO documents (collection_name, document_id, data, version, deleted_at)
             VALUES (?, ?, ?, ?, NULL)
             ON DUPLICATE KEY UPDATE data = VALUES(data), version = VALUES(version), deleted_at = NULL, updated_at = CURRENT_TIMESTAMP(6)'
        );
        $statement->execute([$collection, $documentId, $json, $version]);
        $this->replaceIndexes($collection, $documentId, $resolved);
        $this->appendEvent($collection, $documentId, 'upsert', $version, $resolved, $actorUid, $actorUsername);
        return $this->find($collection, $documentId, includeDeleted: true) ?? throw new \RuntimeException('Failed to reload document.');
    }

    public function delete(
        string $collection,
        string $documentId,
        ?int $expectedVersion,
        string $actorUid,
        string $actorUsername,
    ): void {
        $existing = $this->find($collection, $documentId, forUpdate: true);
        if (!$existing) {
            throw new ApiException('The requested record was not found.', 404, 'not_found');
        }
        if ($expectedVersion !== null && $expectedVersion !== (int) $existing['version']) {
            throw new ApiException('This record changed on another device. Refresh and try again.', 409, 'version_conflict');
        }
        $version = ((int) $existing['version']) + 1;
        $statement = $this->pdo->prepare(
            'UPDATE documents SET version = ?, deleted_at = CURRENT_TIMESTAMP(6), updated_at = CURRENT_TIMESTAMP(6)
              WHERE collection_name = ? AND document_id = ?'
        );
        $statement->execute([$version, $collection, $documentId]);
        $this->pdo->prepare('DELETE FROM document_indexes WHERE collection_name = ? AND document_id = ?')->execute([$collection, $documentId]);
        $this->appendEvent($collection, $documentId, 'delete', $version, $existing['data'], $actorUid, $actorUsername);
    }

    /** @param array<string, mixed> $row @return array<string, mixed> */
    private function hydrate(array $row): array
    {
        return [
            'collection' => $row['collection_name'],
            'id' => $row['document_id'],
            'data' => json_decode((string) $row['data'], true, 512, JSON_THROW_ON_ERROR),
            'version' => (int) $row['version'],
            'createdAt' => $this->iso((string) $row['created_at']),
            'updatedAt' => $this->iso((string) $row['updated_at']),
            'deleted' => $row['deleted_at'] !== null,
        ];
    }

    private function iso(string $mysqlDate): string
    {
        return (new DateTimeImmutable($mysqlDate, new DateTimeZone('UTC')))->format('Y-m-d\TH:i:s.u\Z');
    }

    /** @param array<string, mixed> $base @param array<string, mixed> $patch @return array<string, mixed> */
    private function applyPatch(array $base, array $patch): array
    {
        foreach ($patch as $key => $value) {
            $base[$key] = $this->resolveValue($value, $base[$key] ?? null);
        }
        return $base;
    }

    private function resolveValue(mixed $value, mixed $oldValue): mixed
    {
        if (is_array($value) && isset($value['__gmhTransform'])) {
            return match ($value['__gmhTransform']) {
                'increment' => (float) ($oldValue ?? 0) + (float) ($value['operand'] ?? 0),
                'serverTimestamp' => gmdate('Y-m-d\TH:i:s.v\Z'),
                default => throw new ApiException('Unknown field transform.', 422, 'invalid_transform'),
            };
        }
        if (is_array($value)) {
            $resolved = [];
            foreach ($value as $key => $child) {
                $resolved[$key] = $this->resolveValue($child, is_array($oldValue) ? ($oldValue[$key] ?? null) : null);
            }
            return $resolved;
        }
        return $value;
    }

    /** @param array<string, mixed> $data */
    private function replaceIndexes(string $collection, string $documentId, array $data): void
    {
        $this->pdo->prepare('DELETE FROM document_indexes WHERE collection_name = ? AND document_id = ?')->execute([$collection, $documentId]);
        $fields = array_unique(array_merge($this->collectionConfig['indexes']['*'] ?? [], $this->collectionConfig['indexes'][$collection] ?? []));
        $statement = $this->pdo->prepare(
            'INSERT INTO document_indexes
             (collection_name, document_id, field_name, string_value, number_value, boolean_value, date_value)
             VALUES (?, ?, ?, ?, ?, ?, ?)'
        );
        foreach ($fields as $field) {
            $value = $this->nestedValue($data, $field);
            if ($value === null || is_array($value) || is_object($value)) {
                continue;
            }
            [$string, $number, $boolean, $date] = $this->typedIndexValues($value);
            $statement->execute([$collection, $documentId, $field, $string, $number, $boolean, $date]);
        }
    }

    /** @param array<string, mixed> $data */
    private function nestedValue(array $data, string $field): mixed
    {
        $value = $data;
        foreach (explode('.', $field) as $segment) {
            if (!is_array($value) || !array_key_exists($segment, $value)) {
                return null;
            }
            $value = $value[$segment];
        }
        return $value;
    }

    /** @return array{?string,?float,?int,?string} */
    private function typedIndexValues(mixed $value): array
    {
        if (is_bool($value)) {
            return [null, null, $value ? 1 : 0, null];
        }
        if (is_int($value) || is_float($value)) {
            return [null, (float) $value, null, null];
        }
        $string = mb_substr((string) $value, 0, 512);
        $timestamp = strtotime($string);
        $date = $timestamp !== false && preg_match('/^\d{4}-\d{2}-\d{2}/', $string)
            ? gmdate('Y-m-d H:i:s', $timestamp)
            : null;
        return [$string, null, null, $date];
    }

    private function assertIndexedField(string $collection, string $field): void
    {
        $fields = array_merge($this->collectionConfig['indexes']['*'] ?? [], $this->collectionConfig['indexes'][$collection] ?? []);
        if (!in_array($field, $fields, true)) {
            throw new ApiException('This field is not approved for server-side filtering.', 422, 'field_not_indexed', ['field' => $field]);
        }
    }

    /** @return array{string,mixed} */
    private function indexColumnAndValue(mixed $value): array
    {
        if (is_bool($value)) {
            return ['boolean_value', $value ? 1 : 0];
        }
        if (is_int($value) || is_float($value)) {
            return ['number_value', $value];
        }
        if (is_string($value) && preg_match('/^\d{4}-\d{2}-\d{2}/', $value)) {
            $timestamp = strtotime($value);
            if ($timestamp !== false) {
                return ['date_value', gmdate('Y-m-d H:i:s', $timestamp)];
            }
        }
        return ['string_value', (string) $value];
    }

    /** @param array<string, mixed>|null $payload */
    private function appendEvent(
        string $collection,
        string $documentId,
        string $operation,
        int $version,
        ?array $payload,
        string $actorUid,
        string $actorUsername,
    ): void {
        $statement = $this->pdo->prepare(
            'INSERT INTO document_events
             (event_id, collection_name, document_id, operation, document_version, payload, actor_uid, actor_username)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
        );
        $statement->execute([
            self::uuid(), $collection, $documentId, $operation, $version,
            $payload === null ? null : json_encode($payload, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR),
            $actorUid ?: null, $actorUsername ?: null,
        ]);
    }

    private static function uuid(): string
    {
        $bytes = random_bytes(16);
        $bytes[6] = chr((ord($bytes[6]) & 0x0f) | 0x40);
        $bytes[8] = chr((ord($bytes[8]) & 0x3f) | 0x80);
        return vsprintf('%s%s-%s-%s-%s-%s%s%s', str_split(bin2hex($bytes), 4));
    }
}
