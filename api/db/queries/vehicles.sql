-- name: ListVehiclesByUser :many
SELECT * FROM vehicles
WHERE user_id = ?
ORDER BY id;

-- name: GetVehicle :one
SELECT * FROM vehicles
WHERE id = ? AND user_id = ?
LIMIT 1;

-- name: CreateVehicle :one
INSERT INTO vehicles (user_id, label, type)
VALUES (?, ?, ?)
RETURNING *;

-- name: UpdateVehicle :one
UPDATE vehicles
SET label = ?, type = ?
WHERE id = ? AND user_id = ?
RETURNING *;

-- name: DeleteVehicle :execrows
DELETE FROM vehicles
WHERE id = ? AND user_id = ?;

-- name: GetVehicleType :one
SELECT type FROM vehicles
WHERE id = ? AND user_id = ?;
