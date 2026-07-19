<?php

declare(strict_types=1);

namespace GMH\Backend\Repository;

use PDO;

final class EventRepository
{
    public function __construct(private readonly PDO $pdo)
    {
    }

    /** @param list<string> $collections @return array{events:list<array<string,mixed>>,cursor:int,hasMore:bool} */
    public function changesAfter(int $after, array $collections, int $limit): array
    {
        $parameters = [$after];
        $where = ['sequence_id > ?'];
        if ($collections) {
            $placeholders = implode(',', array_fill(0, count($collections), '?'));
            $where[] = "collection_name IN ({$placeholders})";
            array_push($parameters, ...$collections);
        }
        $sql = 'SELECT sequence_id, event_id, collection_name, document_id, operation, document_version,
                       payload, created_at
                  FROM document_events
                 WHERE ' . implode(' AND ', $where) . '
                 ORDER BY sequence_id ASC LIMIT ' . ($limit + 1);
        $statement = $this->pdo->prepare($sql);
        $statement->execute($parameters);
        $rows = $statement->fetchAll();
        $hasMore = count($rows) > $limit;
        if ($hasMore) {
            array_pop($rows);
        }
        $events = array_map(static fn (array $row): array => [
            'cursor' => (int) $row['sequence_id'],
            'eventId' => $row['event_id'],
            'collection' => $row['collection_name'],
            'id' => $row['document_id'],
            'operation' => $row['operation'],
            'version' => (int) $row['document_version'],
            'data' => $row['payload'] === null ? null : json_decode((string) $row['payload'], true, 512, JSON_THROW_ON_ERROR),
            'changedAt' => str_replace(' ', 'T', (string) $row['created_at']) . 'Z',
        ], $rows);
        $cursor = $events ? (int) end($events)['cursor'] : $after;
        return ['events' => $events, 'cursor' => $cursor, 'hasMore' => $hasMore];
    }

    /** @return array<string, mixed> */
    public function mirrorStatus(): array
    {
        $pending = $this->pdo->query(
            "SELECT COUNT(*) AS pending_count, MIN(created_at) AS oldest_event
               FROM document_events WHERE mirror_status IN ('pending', 'retry', 'processing')"
        )->fetch();
        $success = $this->pdo->query(
            "SELECT MAX(mirrored_at) AS last_success FROM document_events WHERE mirror_status = 'synced'"
        )->fetch();
        $lastRun = $this->pdo->query(
            'SELECT run_id, trigger_type, status, started_at, finished_at, attempted_count,
                    synced_count, retry_count, failed_count, error_message
               FROM sync_runs ORDER BY id DESC LIMIT 1'
        )->fetch() ?: null;
        return [
            'pendingCount' => (int) ($pending['pending_count'] ?? 0),
            'oldestPendingAt' => $pending['oldest_event'] ?? null,
            'lastSuccessAt' => $success['last_success'] ?? null,
            'lastRun' => $lastRun,
        ];
    }

    public function makePendingAgain(): int
    {
        $statement = $this->pdo->prepare(
            "UPDATE document_events
                SET mirror_status = 'pending', mirror_next_attempt_at = NULL, mirror_last_error = NULL
              WHERE mirror_status IN ('retry', 'dead')"
        );
        $statement->execute();
        return $statement->rowCount();
    }
}
