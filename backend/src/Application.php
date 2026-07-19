<?php

declare(strict_types=1);

namespace GMH\Backend;

use GMH\Backend\Auth\AuthContext;
use GMH\Backend\Auth\FirebaseTokenVerifier;
use GMH\Backend\Auth\Policy;
use GMH\Backend\Http\ApiException;
use GMH\Backend\Http\Request;
use GMH\Backend\Http\Response;
use GMH\Backend\Http\Router;
use GMH\Backend\Repository\DocumentRepository;
use GMH\Backend\Repository\EventRepository;
use GMH\Backend\Service\BackupService;
use GMH\Backend\Service\DocumentService;
use GMH\Backend\Service\DomainCommandService;
use GMH\Backend\Service\IdempotencyService;
use PDO;
use Throwable;

final class Application
{
    private readonly Config $config;
    private readonly PDO $pdo;
    /** @var array<string,mixed> */
    private readonly array $collectionConfig;
    private readonly DocumentRepository $documents;
    private readonly EventRepository $events;
    private readonly DocumentService $documentService;
    private readonly DomainCommandService $commands;
    private readonly IdempotencyService $idempotency;
    private readonly BackupService $backups;
    private ?FirebaseTokenVerifier $tokenVerifier = null;

    public function __construct(?string $root = null)
    {
        $root ??= dirname(__DIR__);
        $this->config = new Config($root);
        $this->pdo = (new Database($this->config))->pdo();
        $this->collectionConfig = require $root . '/config/collections.php';
        $policy = new Policy($this->collectionConfig);
        $this->documents = new DocumentRepository($this->pdo, $this->collectionConfig);
        $this->events = new EventRepository($this->pdo);
        $this->documentService = new DocumentService($this->pdo, $this->documents, $this->events, $policy);
        $this->commands = new DomainCommandService($this->pdo, $this->documents, $this->documentService);
        $this->idempotency = new IdempotencyService($this->pdo);
        $this->backups = new BackupService(
            $this->pdo,
            $this->documents,
            $this->collectionConfig,
            $this->config->int('IMPORT_MAX_DOCUMENTS', 100000),
        );
    }

    public function run(): never
    {
        $request = null;
        try {
            $request = Request::fromGlobals($this->config->int('API_MAX_BODY_BYTES', 8 * 1024 * 1024));
            $this->cors($request);
            if (!$this->config->bool('BACKEND_FEATURE_ENABLED', true)) {
                throw new ApiException('The Hostinger data backend is temporarily disabled.', 503, 'backend_disabled');
            }
            $this->router()->dispatch($request);
            Response::json(['error' => ['code' => 'empty_response', 'message' => 'Endpoint returned no response.']], 500);
        } catch (ApiException $exception) {
            Response::json(['error' => [
                'code' => $exception->errorCode,
                'message' => $exception->getMessage(),
                'details' => $exception->details,
            ]], $exception->status);
        } catch (Throwable $exception) {
            error_log((string) $exception);
            $details = $this->config->bool('APP_DEBUG') ? ['exception' => $exception->getMessage()] : [];
            Response::json(['error' => [
                'code' => 'internal_error',
                'message' => 'The data service could not complete this request.',
                'details' => $details,
            ]], 500);
        }
    }

    private function router(): Router
    {
        $router = new Router();
        $prefix = '#^(?:/api)?/v1';

        $router->add('GET', $prefix . '/health$#', function (): never {
            $this->pdo->query('SELECT 1')->fetchColumn();
            Response::json([
                'status' => 'ok',
                'service' => 'gmh-suite-api',
                'version' => '3.2.0',
                'time' => gmdate('Y-m-d\TH:i:s\Z'),
                'mirror' => $this->events->mirrorStatus(),
            ]);
        });

        $router->add('GET', $prefix . '/me$#', function (Request $request): never {
            $user = $this->authenticate($request);
            if ($user->profile === null && strtolower($user->email) === 'admin@gmh-suite.internal') {
                $this->pdo->beginTransaction();
                try {
                    $profile = [
                        'uid' => $user->uid,
                        'name' => 'Administrator',
                        'username' => 'admin',
                        'email' => 'admin@gmh-suite.internal',
                        'role' => 'admin',
                        'app' => 'all',
                        'appAccess' => ['hms', 'pos'],
                        'permissions' => [],
                        'createdAt' => gmdate('Y-m-d\TH:i:s.v\Z'),
                    ];
                    $this->documentService->write($user, 'users', $user->uid, $profile, 0, false);
                    $this->pdo->commit();
                    Response::json(['uid' => $user->uid, 'email' => $user->email, 'profile' => $profile]);
                } catch (Throwable $exception) {
                    if ($this->pdo->inTransaction()) {
                        $this->pdo->rollBack();
                    }
                    throw $exception;
                }
            }
            if ($user->profile === null) {
                throw new ApiException('Your account has not been configured by an administrator.', 403, 'profile_not_configured');
            }
            Response::json(['uid' => $user->uid, 'email' => $user->email, 'profile' => $user->profile]);
        });

        $router->add('GET', $prefix . '/collections/(?<collection>[A-Za-z][A-Za-z0-9_-]{0,95})$#', function (Request $request, array $params): never {
            $user = $this->authenticate($request);
            $filters = [];
            if (isset($request->query['filters'])) {
                $filters = json_decode($request->query['filters'], true, 512, JSON_THROW_ON_ERROR);
                if (!is_array($filters)) {
                    throw new ApiException('Invalid filters.', 422, 'invalid_query');
                }
            }
            $limit = min(
                max(1, (int) ($request->query['limit'] ?? $this->config->int('API_PAGE_SIZE', 500))),
                $this->config->int('API_MAX_PAGE_SIZE', 5000),
            );
            Response::json($this->documentService->list(
                $user,
                $params['collection'],
                $filters,
                $request->query['orderBy'] ?? null,
                $request->query['direction'] ?? 'asc',
                $limit,
                $request->query['after'] ?? null,
            ));
        });

        $router->add('GET', $prefix . '/collections/(?<collection>[A-Za-z][A-Za-z0-9_-]{0,95})/(?<id>[^/]+)$#', function (Request $request, array $params): never {
            Response::json($this->documentService->get(
                $this->authenticate($request),
                $params['collection'],
                rawurldecode($params['id']),
            ));
        });

        $router->add('POST', $prefix . '/collections/(?<collection>[A-Za-z][A-Za-z0-9_-]{0,95})$#', function (Request $request, array $params): never {
            $user = $this->authenticate($request);
            $payload = $request->json();
            $id = (string) ($payload['id'] ?? $this->randomDocumentId());
            $data = $payload['data'] ?? null;
            if (!is_array($data)) {
                throw new ApiException('Document data must be an object.', 422, 'invalid_document');
            }
            $result = $this->idempotency->execute($user, $request->header('idempotency-key'), $this->requestFingerprint($request), fn (): array => [
                'document' => $this->documentService->write($user, $params['collection'], $id, $data, 0, false),
            ]);
            Response::json($result['body'], 201);
        });

        foreach (['PUT', 'PATCH'] as $method) {
            $router->add($method, $prefix . '/collections/(?<collection>[A-Za-z][A-Za-z0-9_-]{0,95})/(?<id>[^/]+)$#', function (Request $request, array $params) use ($method): never {
                $user = $this->authenticate($request);
                $payload = $request->json();
                $data = $payload['data'] ?? null;
                if (!is_array($data)) {
                    throw new ApiException('Document data must be an object.', 422, 'invalid_document');
                }
                $expectedVersion = $this->expectedVersion($request, $payload);
                $result = $this->idempotency->execute($user, $request->header('idempotency-key'), $this->requestFingerprint($request), fn (): array => [
                    'document' => $this->documentService->write(
                        $user, $params['collection'], rawurldecode($params['id']), $data,
                        $expectedVersion, $method === 'PATCH' || ($payload['merge'] ?? false) === true,
                    ),
                ]);
                Response::json($result['body']);
            });
        }

        $router->add('DELETE', $prefix . '/collections/(?<collection>[A-Za-z][A-Za-z0-9_-]{0,95})/(?<id>[^/]+)$#', function (Request $request, array $params): never {
            $user = $this->authenticate($request);
            $payload = $request->rawBody === '' ? [] : $request->json();
            $result = $this->idempotency->execute($user, $request->header('idempotency-key'), $this->requestFingerprint($request), function () use ($user, $params, $request, $payload): array {
                $this->documentService->delete(
                    $user, $params['collection'], rawurldecode($params['id']), $this->expectedVersion($request, $payload),
                );
                return ['deleted' => true];
            });
            Response::json($result['body']);
        });

        $router->add('GET', $prefix . '/changes$#', function (Request $request): never {
            $user = $this->authenticate($request);
            $collections = array_values(array_filter(array_map('trim', explode(',', $request->query['collections'] ?? ''))));
            $limit = min(max(1, (int) ($request->query['limit'] ?? 1000)), 5000);
            Response::json($this->documentService->changes($user, max(0, (int) ($request->query['after'] ?? 0)), $collections, $limit));
        });

        $router->add('POST', $prefix . '/commands/counter-next$#', function (Request $request): never {
            $user = $this->authenticate($request);
            $payload = $request->json();
            $result = $this->idempotency->execute($user, $request->header('idempotency-key'), $this->requestFingerprint($request), fn (): array => $this->commands->nextCounter(
                $user, (string) ($payload['counter'] ?? ''), (string) ($payload['prefix'] ?? ''),
            ));
            Response::json($result['body']);
        });

        $router->add('POST', $prefix . '/commands/(?<command>[a-z][a-z0-9-]{0,63})$#', function (Request $request, array $params): never {
            $user = $this->authenticate($request);
            $result = $this->idempotency->execute($user, $request->header('idempotency-key'), $this->requestFingerprint($request), fn (): array => $this->commands->execute(
                $user, $params['command'], $request->json(),
            ));
            Response::json($result['body']);
        });

        $router->add('GET', $prefix . '/admin/backup$#', function (Request $request): never {
            $this->assertAdmin($this->authenticate($request));
            Response::json($this->backups->export());
        });
        $router->add('POST', $prefix . '/admin/import/dry-run$#', function (Request $request): never {
            $this->assertAdmin($this->authenticate($request));
            $result = $this->backups->validate($request->json());
            unset($result['normalized']);
            Response::json($result);
        });
        $router->add('POST', $prefix . '/admin/import$#', function (Request $request): never {
            $user = $this->authenticate($request);
            $this->assertAdmin($user);
            $payload = $request->json();
            $backup = is_array($payload['backup'] ?? null) ? $payload['backup'] : $payload;
            $result = $this->idempotency->execute($user, $request->header('idempotency-key'), $this->requestFingerprint($request), fn (): array => $this->backups->import(
                $backup, $user, ($payload['replace'] ?? false) === true,
            ));
            Response::json($result['body']);
        });
        $router->add('POST', $prefix . '/admin/reset$#', function (Request $request): never {
            $user = $this->authenticate($request);
            $this->assertAdmin($user);
            $result = $this->idempotency->execute(
                $user,
                $request->header('idempotency-key'),
                $this->requestFingerprint($request),
                fn (): array => $this->backups->reset($user),
            );
            Response::json($result['body']);
        });
        $router->add('GET', $prefix . '/admin/sync$#', function (Request $request): never {
            $this->assertAdmin($this->authenticate($request));
            Response::json($this->events->mirrorStatus());
        });
        $router->add('POST', $prefix . '/admin/sync/retry$#', function (Request $request): never {
            $user = $this->authenticate($request);
            $this->assertAdmin($user);
            $result = $this->idempotency->execute($user, $request->header('idempotency-key'), $this->requestFingerprint($request), fn (): array => [
                'queued' => $this->events->makePendingAgain(),
            ]);
            Response::json($result['body']);
        });

        return $router;
    }

    private function authenticate(Request $request): AuthContext
    {
        $this->tokenVerifier ??= new FirebaseTokenVerifier($this->config, $this->documents);
        return $this->tokenVerifier->verify($request->header('authorization'));
    }

    private function assertAdmin(AuthContext $user): void
    {
        if (!$user->isAdmin()) {
            throw new ApiException('Administrator access is required.', 403, 'permission_denied');
        }
    }

    /** @param array<string,mixed> $payload */
    private function expectedVersion(Request $request, array $payload): ?int
    {
        if (isset($payload['expectedVersion'])) {
            return (int) $payload['expectedVersion'];
        }
        $ifMatch = trim((string) $request->header('if-match'), ' "W/');
        return $ifMatch === '' || $ifMatch === '*' ? null : (int) $ifMatch;
    }

    private function cors(Request $request): void
    {
        $origin = $request->header('origin');
        $allowed = $this->config->csv('API_ALLOWED_ORIGINS');
        if ($origin && !in_array($origin, $allowed, true)) {
            throw new ApiException('This application origin is not allowed to use the data service.', 403, 'cors_denied');
        }
        if ($origin) {
            header('Access-Control-Allow-Origin: ' . $origin);
            header('Vary: Origin');
            header('Access-Control-Allow-Credentials: true');
        }
        header('Access-Control-Allow-Headers: Authorization, Content-Type, Idempotency-Key, If-Match');
        header('Access-Control-Allow-Methods: GET, POST, PUT, PATCH, DELETE, OPTIONS');
        header('X-Content-Type-Options: nosniff');
        if ($request->method === 'OPTIONS') {
            Response::noContent();
        }
    }

    private function randomDocumentId(): string
    {
        return rtrim(strtr(base64_encode(random_bytes(15)), '+/', '-_'), '=');
    }

    private function requestFingerprint(Request $request): string
    {
        return $request->method . ' ' . $request->path . "\n" . $request->rawBody;
    }
}
