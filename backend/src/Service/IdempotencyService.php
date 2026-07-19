<?php

declare(strict_types=1);

namespace GMH\Backend\Service;

use DateTimeImmutable;
use GMH\Backend\Auth\AuthContext;
use GMH\Backend\Http\ApiException;
use PDO;
use Throwable;

final class IdempotencyService
{
    public function __construct(private readonly PDO $pdo)
    {
    }

    /** @param callable():array<string,mixed> $operation @return array{status:int,body:array<string,mixed>,replayed:bool} */
    public function execute(AuthContext $user, ?string $key, string $requestBody, callable $operation): array
    {
        if (!$key || !preg_match('/^[A-Za-z0-9._:-]{8,128}$/', $key)) {
            throw new ApiException('A valid Idempotency-Key header is required for writes.', 400, 'idempotency_key_required');
        }
        $hash = hash('sha256', $requestBody);
        $this->pdo->beginTransaction();
        try {
            $select = $this->pdo->prepare(
                'SELECT request_hash, status_code, response_body, locked_until
                   FROM idempotency_keys WHERE actor_uid = ? AND idempotency_key = ? FOR UPDATE'
            );
            $select->execute([$user->uid, $key]);
            $existing = $select->fetch();
            if ($existing) {
                if (!hash_equals((string) $existing['request_hash'], $hash)) {
                    throw new ApiException('This Idempotency-Key was already used for a different request.', 409, 'idempotency_conflict');
                }
                if ($existing['response_body'] !== null) {
                    $body = json_decode((string) $existing['response_body'], true, 512, JSON_THROW_ON_ERROR);
                    $this->pdo->commit();
                    return ['status' => (int) $existing['status_code'], 'body' => $body, 'replayed' => true];
                }
                $lockedUntil = new DateTimeImmutable((string) $existing['locked_until']);
                if ($lockedUntil > new DateTimeImmutable()) {
                    throw new ApiException('An identical request is already being processed.', 409, 'request_in_progress');
                }
                $this->pdo->prepare(
                    'UPDATE idempotency_keys SET locked_until = DATE_ADD(UTC_TIMESTAMP(6), INTERVAL 2 MINUTE)
                      WHERE actor_uid = ? AND idempotency_key = ?'
                )->execute([$user->uid, $key]);
            } else {
                $this->pdo->prepare(
                    'INSERT INTO idempotency_keys
                     (actor_uid, idempotency_key, request_hash, locked_until, expires_at)
                     VALUES (?, ?, ?, DATE_ADD(UTC_TIMESTAMP(6), INTERVAL 2 MINUTE), DATE_ADD(UTC_TIMESTAMP(6), INTERVAL 7 DAY))'
                )->execute([$user->uid, $key, $hash]);
            }

            $body = $operation();
            $encoded = json_encode($body, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
            $this->pdo->prepare(
                'UPDATE idempotency_keys SET status_code = 200, response_body = ?, locked_until = NULL
                  WHERE actor_uid = ? AND idempotency_key = ?'
            )->execute([$encoded, $user->uid, $key]);
            $this->pdo->commit();
            return ['status' => 200, 'body' => $body, 'replayed' => false];
        } catch (Throwable $exception) {
            if ($this->pdo->inTransaction()) {
                $this->pdo->rollBack();
            }
            throw $exception;
        }
    }
}
