<?php

declare(strict_types=1);

namespace GMH\Backend;

final class Config
{
    /** @var array<string, mixed> */
    private array $values;

    public function __construct(?string $root = null)
    {
        $root ??= dirname(__DIR__);
        if (is_file($root . '/.env')) {
            \Dotenv\Dotenv::createImmutable($root)->safeLoad();
        }

        $this->values = array_merge($_SERVER, $_ENV);
        date_default_timezone_set($this->string('APP_TIMEZONE', 'Asia/Karachi'));
    }

    public function string(string $key, string $default = ''): string
    {
        $value = $this->values[$key] ?? getenv($key);
        return $value === false || $value === null || $value === '' ? $default : (string) $value;
    }

    public function int(string $key, int $default): int
    {
        $value = filter_var($this->string($key), FILTER_VALIDATE_INT);
        return $value === false ? $default : $value;
    }

    public function bool(string $key, bool $default = false): bool
    {
        $value = $this->string($key);
        if ($value === '') {
            return $default;
        }
        return filter_var($value, FILTER_VALIDATE_BOOL);
    }

    /** @return list<string> */
    public function csv(string $key): array
    {
        return array_values(array_filter(array_map('trim', explode(',', $this->string($key)))));
    }
}
