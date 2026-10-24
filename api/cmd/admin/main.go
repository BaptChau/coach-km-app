// Command admin runs one-off maintenance tasks against the database.
//
//	DB_PATH=./dev.db go run ./cmd/admin set-role <email> president|coach
//
// Roles are changed here rather than over HTTP so no API call can grant
// president rights.
package main

import (
	"context"
	"errors"
	"fmt"
	"os"
	"strings"

	"github.com/BaptChau/coach-km-app/api/internal/database"
)

func main() {
	if err := run(os.Args[1:]); err != nil {
		fmt.Fprintln(os.Stderr, "error:", err)
		os.Exit(1)
	}
}

func run(args []string) error {
	if len(args) != 3 || args[0] != "set-role" || (args[2] != "president" && args[2] != "coach") {
		return errors.New("usage: admin set-role <email> president|coach")
	}
	dbPath := os.Getenv("DB_PATH")
	if dbPath == "" {
		dbPath = "./dev.db"
	}

	ctx := context.Background()
	db, err := database.Open(ctx, dbPath)
	if err != nil {
		return err
	}
	defer db.Close()

	email := strings.ToLower(strings.TrimSpace(args[1]))
	n, err := db.WriteQueries().SetRoleByEmail(ctx, database.SetRoleByEmailParams{Role: args[2], Email: email})
	if err != nil {
		return err
	}
	if n == 0 {
		return fmt.Errorf("no account with email %q", email)
	}
	fmt.Printf("%s is now %s\n", email, args[2])
	return nil
}
