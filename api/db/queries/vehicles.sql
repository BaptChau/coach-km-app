-- name: ListVehiclesByUser :many
SELECT * FROM vehicles
WHERE user_id = ?
ORDER BY id;

-- name: GetVehicle :one
SELECT * FROM vehicles
WHERE id = ? AND user_id = ?
LIMIT 1;

-- name: CreateVehicle :one
INSERT INTO vehicles (user_id, label, type, fiscal_hp, electric)
VALUES (?, ?, ?, ?, ?)
RETURNING *;

-- name: UpdateVehicle :one
UPDATE vehicles
SET label = ?, type = ?, fiscal_hp = ?, electric = ?
WHERE id = ? AND user_id = ?
RETURNING *;

-- name: DeleteVehicle :execrows
DELETE FROM vehicles
WHERE id = ? AND user_id = ?;

