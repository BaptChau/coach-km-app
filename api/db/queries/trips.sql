-- name: ListTripsByUser :many
SELECT * FROM trips
WHERE user_id = ?
ORDER BY date DESC, id DESC;

-- name: GetTrip :one
SELECT * FROM trips
WHERE id = ? AND user_id = ?
LIMIT 1;

-- name: UpdateTrip :one
UPDATE trips
SET date = ?, origin = ?, destination = ?, distance_km = ?
WHERE id = ? AND user_id = ?
RETURNING *;

-- name: DeleteTrip :exec
DELETE FROM trips
WHERE id = ? AND user_id = ?;