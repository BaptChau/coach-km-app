-- name: GetWaiver :one
SELECT * FROM waivers
WHERE user_id = ? AND year = ?;

-- name: ListWaiversByUser :many
SELECT * FROM waivers
WHERE user_id = ?
ORDER BY year DESC;

-- name: ListWaiversByYear :many
SELECT * FROM waivers
WHERE year = ?;

-- name: WaiverExists :one
SELECT EXISTS (SELECT 1 FROM waivers WHERE user_id = ? AND year = ?);

-- name: CreateWaiver :one
INSERT INTO waivers (user_id, year, km, amount_cents)
VALUES (?, ?, ?, ?)
RETURNING *;

-- name: DeleteWaiver :execrows
DELETE FROM waivers
WHERE user_id = ? AND year = ?;

-- name: NextReceiptSeq :one
SELECT CAST(COALESCE(MAX(seq), 0) + 1 AS INTEGER) FROM tax_receipts
WHERE year = ?;

-- name: CreateReceipt :one
INSERT INTO tax_receipts (year, seq, user_id, amount_cents, waived_at, issued_by)
VALUES (?, ?, ?, ?, ?, ?)
RETURNING *;

-- name: GetReceipt :one
SELECT * FROM tax_receipts
WHERE id = ?;

-- name: GetReceiptByUserYear :one
SELECT * FROM tax_receipts
WHERE user_id = ? AND year = ?;

-- name: ListReceiptsByUser :many
SELECT * FROM tax_receipts
WHERE user_id = ?
ORDER BY year DESC;

-- name: ListReceiptsByYear :many
SELECT * FROM tax_receipts
WHERE year = ?
ORDER BY seq;
