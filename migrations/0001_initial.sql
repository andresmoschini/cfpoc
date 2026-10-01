CREATE TABLE events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id TEXT NOT NULL,
    timestamp TEXT NOT NULL,
    event_type TEXT NOT NULL,
    payload TEXT NOT NULL
);

CREATE INDEX idx_events_device_timestamp
    ON events(device_id, timestamp);
