CREATE TABLE IF NOT EXISTS users (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    email               TEXT NOT NULL UNIQUE,
    registration_number TEXT NOT NULL UNIQUE,
    first_name          TEXT NOT NULL,
    last_name           TEXT NOT NULL,
    password_hash       TEXT NOT NULL,
    -- 'president' can issue Cerfa 11580 tax receipts for every coach.
    role                TEXT NOT NULL DEFAULT 'coach' CHECK (role IN ('coach', 'president')),
    -- Postal address, printed on the tax receipt.
    address_line        TEXT NOT NULL DEFAULT '',
    postal_code         TEXT NOT NULL DEFAULT '',
    city                TEXT NOT NULL DEFAULT '',
    created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS vehicles (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    label      TEXT NOT NULL,
    type       TEXT NOT NULL CHECK (type IN ('car', 'motorcycle', 'moped')),
    -- Puissance administrative (CV); NULL for mopeds, whose barème has none.
    fiscal_hp  INTEGER CHECK (fiscal_hp IS NULL OR fiscal_hp > 0),
    electric   BOOLEAN NOT NULL DEFAULT 0,
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

-- A coach's written renunciation of reimbursement for a year (abandon de
-- frais). It locks that year's trips: the waived amount must not drift.
CREATE TABLE IF NOT EXISTS waivers (
    user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    year         INTEGER NOT NULL,
    km           REAL NOT NULL,
    amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
    waived_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, year)
);

-- Cerfa 11580 receipts issued by the president. Immutable once issued; the
-- amount is copied from the waiver.
CREATE TABLE IF NOT EXISTS tax_receipts (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    year         INTEGER NOT NULL,
    seq          INTEGER NOT NULL,
    user_id      INTEGER NOT NULL,
    amount_cents INTEGER NOT NULL,
    waived_at    DATETIME NOT NULL,
    issued_by    INTEGER NOT NULL REFERENCES users(id),
    issued_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id, year) REFERENCES waivers (user_id, year) ON DELETE RESTRICT,
    UNIQUE (year, seq),
    UNIQUE (user_id, year)
);
