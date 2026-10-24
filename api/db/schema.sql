CREATE TABLE IF NOT EXISTS users (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    email               TEXT NOT NULL UNIQUE,
    registration_number TEXT NOT NULL UNIQUE,
    first_name          TEXT NOT NULL,
    last_name           TEXT NOT NULL,
    password_hash       TEXT NOT NULL,
    created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS vehicles (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    label      TEXT NOT NULL,
    type       TEXT NOT NULL CHECK (type IN ('car', 'two_wheeler')),
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    -- Lets trips reference (id, user_id) so a trip can only use its owner's vehicle.
    UNIQUE (id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_vehicles_user ON vehicles (user_id);

CREATE TABLE IF NOT EXISTS trips (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    vehicle_id  INTEGER NOT NULL,
    -- Client-generated id (e.g. UUID) so replaying the offline queue can't
    -- create duplicates.
    client_id   TEXT,
    date        TEXT NOT NULL CHECK (date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
    origin      TEXT NOT NULL,
    destination TEXT NOT NULL,
    purpose     TEXT NOT NULL,
    -- One-way distance; billed km = distance_km * 2 when round_trip.
    distance_km REAL NOT NULL CHECK (distance_km > 0),
    round_trip  BOOLEAN NOT NULL DEFAULT 0,
    created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (vehicle_id, user_id) REFERENCES vehicles (id, user_id) ON DELETE RESTRICT,
    UNIQUE (user_id, client_id)
);

-- Every trips query filters on user_id and a date range.
CREATE INDEX IF NOT EXISTS idx_trips_user_date ON trips (user_id, date DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_trips_vehicle ON trips (vehicle_id, user_id);

-- Barème kilométrique bénévoles, in thousandths of a euro per km
-- (0.331 €/km = 331). A year without a row falls back to the latest
-- earlier year, flagged as provisional.
CREATE TABLE IF NOT EXISTS rates (
    year           INTEGER NOT NULL,
    vehicle_type   TEXT NOT NULL CHECK (vehicle_type IN ('car', 'two_wheeler')),
    milli_eur_per_km INTEGER NOT NULL CHECK (milli_eur_per_km > 0),
    PRIMARY KEY (year, vehicle_type)
);

INSERT OR IGNORE INTO rates (year, vehicle_type, milli_eur_per_km) VALUES
    (2023, 'car', 331),
    (2023, 'two_wheeler', 128);
