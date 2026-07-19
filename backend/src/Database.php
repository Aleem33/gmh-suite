<?php

declare(strict_types=1);

namespace GMH\Backend;

use PDO;

final class Database
{
    private ?PDO $pdo = null;

    public function __construct(private readonly Config $config)
    {
    }

    public function pdo(): PDO
    {
        if ($this->pdo instanceof PDO) {
            return $this->pdo;
        }

        $charset = $this->config->string('DB_CHARSET', 'utf8mb4');
        $dsn = sprintf(
            'mysql:host=%s;port=%d;dbname=%s;charset=%s',
            $this->config->string('DB_HOST', 'localhost'),
            $this->config->int('DB_PORT', 3306),
            $this->config->string('DB_NAME'),
            $charset,
        );

        $this->pdo = new PDO(
            $dsn,
            $this->config->string('DB_USER'),
            $this->config->string('DB_PASSWORD'),
            [
                PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
                PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
                PDO::ATTR_EMULATE_PREPARES => false,
                PDO::MYSQL_ATTR_INIT_COMMAND => "SET NAMES {$charset}, time_zone = '+00:00'",
            ],
        );

        return $this->pdo;
    }
}
