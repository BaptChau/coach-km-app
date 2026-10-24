-- name: ListRates :many
SELECT * FROM rates
ORDER BY year, vehicle_type;
