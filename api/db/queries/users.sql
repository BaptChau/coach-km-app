-- name: CreateUser :one
INSERT INTO users (username, password_hash)
VALUES (?, ?)
RETURNING *;

-- name: GetUserByUsername :one
SELECT * FROM users
WHERE username = ?
LIMIT 1;

-- name: GetUserByID :one
SELECT * FROM users
WHERE id = ?
LIMIT 1;

-- name: CreateTrip :one
INSERT INTO trips (user_id, date, origin, destination, distance_km)
VALUES (?, ?, ?, ?, ?)
RETURNING *;
