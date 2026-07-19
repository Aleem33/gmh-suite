<?php

declare(strict_types=1);

namespace GMH\Backend\Mirror;

final class FirestoreValueEncoder
{
    /** @param array<string,mixed> $document @return array<string,mixed> */
    public function document(array $document): array
    {
        $fields = [];
        foreach ($document as $key => $value) {
            $fields[(string) $key] = $this->value($value);
        }
        return ['fields' => $fields];
    }

    /** @return array<string,mixed> */
    public function value(mixed $value): array
    {
        if ($value === null) {
            return ['nullValue' => null];
        }
        if (is_bool($value)) {
            return ['booleanValue' => $value];
        }
        if (is_int($value)) {
            return ['integerValue' => (string) $value];
        }
        if (is_float($value)) {
            return ['doubleValue' => $value];
        }
        if (is_string($value)) {
            return ['stringValue' => $value];
        }
        if (is_array($value) && array_is_list($value)) {
            return ['arrayValue' => ['values' => array_map(fn (mixed $item): array => $this->value($item), $value)]];
        }
        if (is_array($value)) {
            $fields = [];
            foreach ($value as $key => $item) {
                $fields[(string) $key] = $this->value($item);
            }
            return ['mapValue' => ['fields' => $fields]];
        }
        return ['stringValue' => (string) $value];
    }
}
