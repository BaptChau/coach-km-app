package database

import (
	"context"
	"path/filepath"
	"testing"
)

func TestOpen(t *testing.T) {
	ctx := context.Background()
	db, err := Open(ctx, filepath.Join(t.TempDir(), "t.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	var mode string
	if err := db.Read.QueryRowContext(ctx, "PRAGMA journal_mode").Scan(&mode); err != nil || mode != "wal" {
		t.Errorf("journal_mode = %q, %v; want wal", mode, err)
	}
	var fk int
	if err := db.Read.QueryRowContext(ctx, "PRAGMA foreign_keys").Scan(&fk); err != nil || fk != 1 {
		t.Errorf("foreign_keys on read pool = %d, %v; want 1", fk, err)
	}
	if _, err := db.Read.ExecContext(ctx, "INSERT INTO users (email, registration_number, first_name, last_name, password_hash) VALUES ('a', 'b', 'c', 'd', 'e')"); err == nil {
		t.Error("read pool accepted a write")
	}
	if _, err := New(db.Write).CreateTrip(ctx, CreateTripParams{UserID: 999, VehicleID: 1, Date: "2026-01-01", Origin: "a", Destination: "b", Purpose: "c", DistanceKm: 1}); err == nil {
		t.Error("trip for unknown user accepted: foreign keys not enforced")
	}
}
