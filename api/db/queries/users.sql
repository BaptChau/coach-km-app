-- name: CreateUser :one
INSERT INTO users (email, registration_number, first_name, last_name, password_hash)
VALUES (?, ?, ?, ?, ?)
RETURNING *;

-- name: GetUserByEmail :one
SELECT * FROM users
WHERE email = ?
LIMIT 1;

-- name: GetUserByID :one
SELECT * FROM users
WHERE id = ?
LIMIT 1;

-- name: UpdateProfile :one
UPDATE users
SET first_name = ?, last_name = ?, address_line = ?, postal_code = ?, city = ?
WHERE id = ?
RETURNING *;

-- name: SetRoleByEmail :execrows
UPDATE users
SET role = ?
WHERE email = ?;

-- name: ListUsers :many
SELECT * FROM users
ORDER BY last_name, first_name, id;
