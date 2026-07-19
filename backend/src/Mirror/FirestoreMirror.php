<?php

declare(strict_types=1);

namespace GMH\Backend\Mirror;

use GMH\Backend\Config;
use Google\Auth\Credentials\ServiceAccountCredentials;
use GuzzleHttp\Client;
use GuzzleHttp\Exception\RequestException;
use PDO;
use Throwable;

final class FirestoreMirror
{
    private readonly Client $http;
    private readonly ServiceAccountCredentials $credentials;
    private readonly FirestoreValueEncoder $encoder;
    private readonly MirrorFailureClassifier $failureClassifier;
    private ?string $accessToken = null;
    private int $accessTokenExpiresAt = 0;

    public function __construct(
        private readonly PDO $pdo,
        private readonly Config $config,
    ) {
        $serviceAccountPath = $config->string('FIREBASE_SERVICE_ACCOUNT');
        $serviceAccount = json_decode((string) file_get_contents($serviceAccountPath), true, 512, JSON_THROW_ON_ERROR);
        $this->credentials = new ServiceAccountCredentials(
            ['https://www.googleapis.com/auth/datastore'],
            $serviceAccount,
        );
        $this->http = new Client(['timeout' => 30, 'connect_timeout' => 10]);
        $this->encoder = new FirestoreValueEncoder();
        $this->failureClassifier = new MirrorFailureClassifier();
    }

    /** @return array<string,mixed> */
    public function run(string $trigger = 'cron'): array
    {
        if (!$this->config->bool('FIRESTORE_MIRROR_ENABLED', true)) {
            return ['status' => 'disabled'];
        }
        if ((int) $this->pdo->query("SELECT GET_LOCK('gmh_firestore_mirror', 0)")->fetchColumn() !== 1) {
            return ['status' => 'already_running'];
        }

        $runId = self::uuid();
        $this->pdo->prepare(
            'INSERT INTO sync_runs (run_id, trigger_type, status) VALUES (?, ?, \'running\')'
        )->execute([$runId, $trigger === 'manual' ? 'manual' : 'cron']);
        $runDbId = (int) $this->pdo->lastInsertId();
        $stats = ['attempted' => 0, 'synced' => 0, 'retry' => 0, 'failed' => 0, 'lastSequence' => null];

        try {
            $this->pdo->exec(
                "UPDATE document_events SET mirror_status = 'retry', mirror_next_attempt_at = UTC_TIMESTAMP(6),
                        mirror_last_error = 'Recovered stale processing claim.'
                  WHERE mirror_status = 'processing' AND created_at < DATE_SUB(UTC_TIMESTAMP(6), INTERVAL 30 MINUTE)"
            );
            $max = $this->config->int('FIRESTORE_MIRROR_MAX_ATTEMPTS_PER_RUN', 1000);
            $batchSize = min(500, max(1, $this->config->int('FIRESTORE_MIRROR_BATCH_SIZE', 200)));
            while ($stats['attempted'] < $max) {
                $events = $this->claim(min($batchSize, $max - $stats['attempted']));
                if (!$events) {
                    break;
                }
                foreach ($events as $event) {
                    $stats['attempted']++;
                    $stats['lastSequence'] = (int) $event['sequence_id'];
                    try {
                        $this->mirrorEvent($event);
                        $this->markSynced((int) $event['sequence_id']);
                        $stats['synced']++;
                    } catch (Throwable $exception) {
                        [$retryable, $quota] = $this->classify($exception);
                        $this->markFailed((int) $event['sequence_id'], $exception->getMessage(), $retryable, $quota);
                        if ($retryable) {
                            $stats['retry']++;
                            $this->deferRemainingClaims($quota);
                            break 2;
                        } else {
                            $stats['failed']++;
                        }
                    }
                }
            }
            $status = $stats['failed'] > 0 || $stats['retry'] > 0 ? 'partial' : 'completed';
            $this->finishRun($runDbId, $status, $stats);
            return ['status' => $status, ...$stats];
        } catch (Throwable $exception) {
            $this->finishRun($runDbId, 'failed', $stats, $exception->getMessage());
            throw $exception;
        } finally {
            $this->pdo->query("SELECT RELEASE_LOCK('gmh_firestore_mirror')")->fetchColumn();
        }
    }

    /** @return list<array<string,mixed>> */
    private function claim(int $limit): array
    {
        $this->pdo->beginTransaction();
        try {
            $rows = $this->pdo->query(
                "SELECT sequence_id, collection_name, document_id, operation, payload
                   FROM document_events
                  WHERE mirror_status IN ('pending', 'retry')
                    AND (mirror_next_attempt_at IS NULL OR mirror_next_attempt_at <= UTC_TIMESTAMP(6))
                  ORDER BY sequence_id ASC
                  LIMIT {$limit} FOR UPDATE"
            )->fetchAll();
            if ($rows) {
                $ids = array_column($rows, 'sequence_id');
                $placeholders = implode(',', array_fill(0, count($ids), '?'));
                $statement = $this->pdo->prepare(
                    "UPDATE document_events SET mirror_status = 'processing', mirror_attempts = mirror_attempts + 1
                      WHERE sequence_id IN ({$placeholders})"
                );
                $statement->execute($ids);
            }
            $this->pdo->commit();
            return $rows;
        } catch (Throwable $exception) {
            if ($this->pdo->inTransaction()) {
                $this->pdo->rollBack();
            }
            throw $exception;
        }
    }

    /** @param array<string,mixed> $event */
    private function mirrorEvent(array $event): void
    {
        $project = rawurlencode($this->config->string('FIREBASE_PROJECT_ID'));
        $collection = rawurlencode((string) $event['collection_name']);
        $document = rawurlencode((string) $event['document_id']);
        $url = "https://firestore.googleapis.com/v1/projects/{$project}/databases/(default)/documents/{$collection}/{$document}";
        $options = ['headers' => ['Authorization' => 'Bearer ' . $this->token(), 'Accept' => 'application/json']];
        if ($event['operation'] === 'delete') {
            try {
                $this->http->delete($url, $options);
            } catch (RequestException $exception) {
                if ($exception->getResponse()?->getStatusCode() !== 404) {
                    throw $exception;
                }
            }
            return;
        }
        $payload = json_decode((string) $event['payload'], true, 512, JSON_THROW_ON_ERROR);
        $options['json'] = $this->encoder->document($payload);
        $this->http->patch($url, $options);
    }

    private function token(): string
    {
        if ($this->accessToken && time() < $this->accessTokenExpiresAt - 60) {
            return $this->accessToken;
        }
        $token = $this->credentials->fetchAuthToken();
        $this->accessToken = (string) ($token['access_token'] ?? '');
        $this->accessTokenExpiresAt = time() + (int) ($token['expires_in'] ?? 3600);
        if ($this->accessToken === '') {
            throw new \RuntimeException('Could not obtain a Firestore service-account access token.');
        }
        return $this->accessToken;
    }

    private function markSynced(int $sequence): void
    {
        $this->pdo->prepare(
            "UPDATE document_events SET mirror_status = 'synced', mirrored_at = UTC_TIMESTAMP(6),
                    mirror_next_attempt_at = NULL, mirror_last_error = NULL WHERE sequence_id = ?"
        )->execute([$sequence]);
    }

    private function markFailed(int $sequence, string $message, bool $retryable, bool $quota): void
    {
        $status = $retryable ? 'retry' : 'dead';
        $hours = $quota ? 5 : 1;
        $statement = $this->pdo->prepare(
            "UPDATE document_events SET mirror_status = ?,
                    mirror_next_attempt_at = IF(? = 'retry', DATE_ADD(UTC_TIMESTAMP(6), INTERVAL {$hours} HOUR), NULL),
                    mirror_last_error = ? WHERE sequence_id = ?"
        );
        $statement->execute([$status, $status, mb_substr($message, 0, 8000), $sequence]);
    }

    private function deferRemainingClaims(bool $quota): void
    {
        $hours = $quota ? 5 : 1;
        $reason = $quota
            ? 'Deferred because Firestore quota was exhausted during this run.'
            : 'Deferred to preserve mirror event ordering after a temporary failure.';
        $statement = $this->pdo->prepare(
            "UPDATE document_events
                SET mirror_status = 'retry', mirror_next_attempt_at = DATE_ADD(UTC_TIMESTAMP(6), INTERVAL {$hours} HOUR),
                    mirror_last_error = ?
              WHERE mirror_status = 'processing'"
        );
        $statement->execute([$reason]);
    }

    /** @return array{bool,bool} */
    private function classify(Throwable $exception): array
    {
        $status = $exception instanceof RequestException && $exception->getResponse()
            ? $exception->getResponse()->getStatusCode()
            : 0;
        $body = $exception instanceof RequestException && $exception->getResponse()
            ? (string) $exception->getResponse()->getBody()
            : $exception->getMessage();
        $classification = $this->failureClassifier->classify($status, $body);
        return [$classification['retryable'], $classification['quota']];
    }

    /** @param array<string,mixed> $stats */
    private function finishRun(int $id, string $status, array $stats, ?string $error = null): void
    {
        $statement = $this->pdo->prepare(
            'UPDATE sync_runs SET status = ?, finished_at = UTC_TIMESTAMP(6), attempted_count = ?, synced_count = ?,
                    retry_count = ?, failed_count = ?, last_sequence_id = ?, error_message = ? WHERE id = ?'
        );
        $statement->execute([
            $status, $stats['attempted'], $stats['synced'], $stats['retry'], $stats['failed'],
            $stats['lastSequence'], $error, $id,
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
