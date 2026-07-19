<?php

declare(strict_types=1);

namespace GMH\Backend\Auth;

final class AuthContext
{
    /** @param array<string, mixed> $claims @param array<string, mixed>|null $profile */
    public function __construct(
        public readonly string $uid,
        public readonly string $email,
        public readonly array $claims,
        public readonly ?array $profile,
    ) {
    }

    public function role(): string
    {
        return strtolower((string) ($this->profile['role'] ?? ''));
    }

    public function username(): string
    {
        return strtolower((string) ($this->profile['username'] ?? ''));
    }

    public function isAdmin(): bool
    {
        return $this->role() === 'admin';
    }

    public function hasPermission(string $permission): bool
    {
        return $this->isAdmin() || ($this->profile['permissions'][$permission] ?? false) === true;
    }
}
