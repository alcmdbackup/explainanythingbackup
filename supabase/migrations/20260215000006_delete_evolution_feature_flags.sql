-- Delete all evolution feature flag rows (flags now read from env vars).
DELETE FROM feature_flags WHERE name LIKE 'evolution_%';
