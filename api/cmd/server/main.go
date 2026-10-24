package main

import (
	"context"
	"errors"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/BaptChau/coach-km-app/api/internal/config"
	"github.com/BaptChau/coach-km-app/api/internal/database"
	"github.com/BaptChau/coach-km-app/api/internal/external"
	"github.com/BaptChau/coach-km-app/api/internal/rates"
	"github.com/BaptChau/coach-km-app/api/internal/server"
)

func main() {
	if err := run(); err != nil {
		slog.Error("server stopped", "err", err)
		os.Exit(1)
	}
}

func run() error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	db, err := database.Open(ctx, cfg.DBPath)
	if err != nil {
		return err
	}
	defer db.Close()

	rateTable, err := rates.Load(ctx, database.New(db.Read))
	if err != nil {
		return err
	}

	srv := &http.Server{
		Addr: net.JoinHostPort("", cfg.Port),
		Handler: server.New(server.Deps{
			DB:                 db,
			JWTSecret:          cfg.JWTSecret,
			RegistrationNumber: cfg.RegistrationNumber,
			Rates:              rateTable,
			External:           external.NewClient(cfg.ExternalDemoURL),
		}),
		// Bound every phase of a request so slow or idle clients can't pin
		// goroutines and file descriptors indefinitely.
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       15 * time.Second,
		WriteTimeout:      30 * time.Second,
		IdleTimeout:       120 * time.Second,
		MaxHeaderBytes:    1 << 16,
	}

	errCh := make(chan error, 1)
	go func() {
		slog.Info("listening", "addr", srv.Addr)
		errCh <- srv.ListenAndServe()
	}()

	select {
	case err := <-errCh:
		if !errors.Is(err, http.ErrServerClosed) {
			return err
		}
	case <-ctx.Done():
		slog.Info("shutting down")
	}

	// Let in-flight requests finish before the DB is closed by the defer.
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	return srv.Shutdown(shutdownCtx)
}
