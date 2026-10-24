-- name: ListTripsByUserYear :many
SELECT * FROM trips
WHERE user_id = sqlc.arg(user_id)
  AND date >= sqlc.arg(from_date) AND date < sqlc.arg(to_date)
ORDER BY date DESC, id DESC
LIMIT sqlc.arg(lim) OFFSET sqlc.arg(off);

-- name: GetTrip :one
SELECT * FROM trips
WHERE id = ? AND user_id = ?
LIMIT 1;

-- name: GetTripByClientID :one
SELECT * FROM trips
WHERE user_id = ? AND client_id = ?
LIMIT 1;

-- name: CreateTrip :one
INSERT INTO trips (user_id, vehicle_id, client_id, date, origin, destination, purpose, distance_km, round_trip)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT (user_id, client_id) DO NOTHING
RETURNING *;

-- name: UpdateTrip :one
UPDATE trips
SET vehicle_id = ?, date = ?, origin = ?, destination = ?, purpose = ?, distance_km = ?, round_trip = ?
WHERE id = ? AND user_id = ?
RETURNING *;

-- name: DeleteTrip :execrows
DELETE FROM trips
WHERE id = ? AND user_id = ?;

-- name: TripYearsForVehicle :many
SELECT DISTINCT CAST(substr(date, 1, 4) AS INTEGER) AS year
FROM trips
WHERE vehicle_id = ? AND user_id = ?;

-- name: SumKmByMonthVehicle :many
SELECT
    CAST(substr(date, 6, 2) AS INTEGER) AS month,
    vehicle_id,
    CAST(SUM(CASE WHEN round_trip THEN distance_km * 2 ELSE distance_km END) AS REAL) AS km
FROM trips
WHERE user_id = sqlc.arg(user_id)
  AND date >= sqlc.arg(from_date) AND date < sqlc.arg(to_date)
GROUP BY month, vehicle_id;

-- name: SumKmByUserVehicle :many
SELECT
    user_id,
    vehicle_id,
    CAST(SUM(CASE WHEN round_trip THEN distance_km * 2 ELSE distance_km END) AS REAL) AS km
FROM trips
WHERE date >= sqlc.arg(from_date) AND date < sqlc.arg(to_date)
GROUP BY user_id, vehicle_id;

-- name: ListAllVehicles :many
SELECT * FROM vehicles;
