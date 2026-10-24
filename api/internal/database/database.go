package database

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"net/url"
	"runtime"
	"strings"
	"time"

	"github.com/BaptChau/coach-km-app/api/db"
	"modernc.org/sqlite"
	sqlite3 "modernc.org/sqlite/lib"
)

// DB splits SQLite access into a single-connection writer pool and a
// multi-connection reader pool. SQLite allows only one writer at a time, so
// funnelling writes through one connection queues them in Go instead of
// spinning on SQLITE_BUSY, while WAL mode lets readers run concurrently.
type DB struct {
	Read  *sql.DB
	Write *sql.DB
}

func Open(ctx context.Context, dbPath string) (*DB, error) {
	// Pragmas in the DSN are applied to every new connection of the pool,
	// unlike a one-off Exec which only affects the connection it ran on.
	q := url.Values{}
	q.Add("_pragma", "foreign_keys(1)")
	q.Add("_pragma", "journal_mode(WAL)")
	q.Add("_pragma", "synchronous(NORMAL)")
	q.Add("_pragma", "busy_timeout(5000)")
	q.Set("_txlock", "immediate")
	dsn := "file:" + dbPath + "?" + q.Encode()

	write, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, err
	}
	write.SetMaxOpenConns(1)
	write.SetMaxIdleConns(1)
	write.SetConnMaxIdleTime(0)

	if _, err := write.ExecContext(ctx, db.Schema); err != nil {
		write.Close()
		return nil, fmt.Errorf("failed to create schema: %w", err)
	}

	read, err := sql.Open("sqlite", dsn+"&mode=ro")
	if err != nil {
		write.Close()
		return nil, err
	}
	n := max(4, runtime.NumCPU())
	read.SetMaxOpenConns(n)
	read.SetMaxIdleConns(n)
	read.SetConnMaxIdleTime(5 * time.Minute)

	if err := read.PingContext(ctx); err != nil {
		write.Close()
		read.Close()
		return nil, fmt.Errorf("failed to open read pool: %w", err)
	}

	return &DB{Read: read, Write: write}, nil
}

func (d *DB) Close() error {
	return errors.Join(d.Read.Close(), d.Write.Close())
}

// IsUniqueViolation matches UNIQUE and PRIMARY KEY conflicts.
func IsUniqueViolation(err error) bool {
	var se *sqlite.Error
	return errors.As(err, &se) &&
		(se.Code() == sqlite3.SQLITE_CONSTRAINT_UNIQUE || se.Code() == sqlite3.SQLITE_CONSTRAINT_PRIMARYKEY)
}

// IsForeignKeyViolation also matches ON DELETE RESTRICT, which SQLite
// reports as SQLITE_CONSTRAINT_TRIGGER.
func IsForeignKeyViolation(err error) bool {
	var se *sqlite.Error
	if !errors.As(err, &se) {
		return false
	}
	return se.Code() == sqlite3.SQLITE_CONSTRAINT_FOREIGNKEY ||
		(se.Code() == sqlite3.SQLITE_CONSTRAINT_TRIGGER && strings.Contains(se.Error(), "FOREIGN KEY"))
}

// UniqueViolationOn reports a UNIQUE failure on a given column, e.g.
// "users.email", so callers can say which field clashed.
func UniqueViolationOn(err error, column string) bool {
	return IsUniqueViolation(err) && strings.Contains(err.Error(), column)
}

// WriteTx runs fn in a transaction on the writer connection. Transactions
// start with BEGIN IMMEDIATE (see _txlock), so read-modify-write sequences
// like a PATCH can't interleave with another writer.
func (d *DB) WriteTx(ctx context.Context, fn func(q *Queries) error) error {
	tx, err := d.Write.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if err := fn(New(tx)); err != nil {
		return err
	}
	return tx.Commit()
}

// WriteQueries runs single statements on the writer connection.
func (d *DB) WriteQueries() *Queries { return New(d.Write) }
