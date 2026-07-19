<?php

declare(strict_types=1);

namespace GMH\Backend\Auth;

use GMH\Backend\Config;
use GMH\Backend\Http\ApiException;
use GMH\Backend\Repository\DocumentRepository;
use Kreait\Firebase\Contract\Auth;
use Kreait\Firebase\Factory;
use Throwable;

final class FirebaseTokenVerifier
{
    private readonly Auth $auth;

    public function __construct(
        Config $config,
        private readonly DocumentRepository $documents,
    ) {
        $serviceAccount = $config->string('FIREBASE_SERVICE_ACCOUNT');
        if ($serviceAccount === '' || !is_file($serviceAccount)) {
            throw new \RuntimeException('FIREBASE_SERVICE_ACCOUNT is not configured or cannot be read.');
        }
        $this->auth = (new Factory())
            ->withServiceAccount($serviceAccount)
            ->withProjectId($config->string('FIREBASE_PROJECT_ID'))
            ->createAuth();
    }

    public function verify(?string $authorization): AuthContext
    {
        if (!$authorization || !preg_match('/^Bearer\s+(.+)$/i', $authorization, $matches)) {
            throw new ApiException('Firebase authentication is required.', 401, 'unauthenticated');
        }

        try {
            $token = $this->auth->verifyIdToken(trim($matches[1]));
            $claims = $token->claims()->all();
            $uid = (string) ($claims['sub'] ?? '');
            if ($uid === '') {
                throw new ApiException('The Firebase token has no user ID.', 401, 'invalid_token');
            }
            $profile = $this->documents->findData('users', $uid, includeDeleted: false);
            return new AuthContext($uid, (string) ($claims['email'] ?? ''), $claims, $profile);
        } catch (ApiException $exception) {
            throw $exception;
        } catch (Throwable $exception) {
            throw new ApiException('Your session is invalid or expired. Please log in again.', 401, 'invalid_token', [
                'reason' => $exception->getMessage(),
            ]);
        }
    }
}
