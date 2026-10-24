// Package db holds the SQL schema and sqlc queries.
package db

import _ "embed"

//go:embed schema.sql
var Schema string
