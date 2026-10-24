// Package server wires handlers and middleware into one http.Handler.
package server

import (
	"log/slog"
	"net/http"
	"regexp"
	"runtime/debug"
	"time"

	"github.com/BaptChau/coach-km-app/api/internal/config"
	"github.com/BaptChau/coach-km-app/api/internal/database"
	"github.com/BaptChau/coach-km-app/api/internal/external"
	"github.com/BaptChau/coach-km-app/api/internal/httpx"
	"github.com/BaptChau/coach-km-app/api/internal/receipts"
	"github.com/BaptChau/coach-km-app/api/internal/report"
	"github.com/BaptChau/coach-km-app/api/internal/trips"
	"github.com/BaptChau/coach-km-app/api/internal/users"
	"github.com/BaptChau/coach-km-app/api/internal/vehicles"
)

type Deps struct {
	DB                 *database.DB
	JWTSecret          string
	RegistrationNumber *regexp.Regexp
	Association        config.Association
	External           *external.Client
}

func New(d Deps) http.Handler {
	mux := http.NewServeMux()

	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, r *http.Request) {
		if err := d.DB.Read.PingContext(r.Context()); err != nil {
			httpx.Error(w, http.StatusServiceUnavailable, "database unavailable")
			return
		}
		httpx.WriteJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	})

	users.NewHandler(d.DB, d.JWTSecret, d.RegistrationNumber).Register(mux)
	vehicles.NewHandler(d.DB).Register(mux, d.JWTSecret)
	trips.NewHandler(d.DB).Register(mux, d.JWTSecret)
	report.NewHandler(d.DB).Register(mux, d.JWTSecret)
	receipts.NewHandler(d.DB, d.Association).Register(mux, d.JWTSecret)
	external.NewHandler(d.External).Register(mux, d.JWTSecret)

	return recoverer(logRequests(mux))
}

type statusRecorder struct {
	http.ResponseWriter
	status int
}

func (s *statusRecorder) WriteHeader(code int) {
	s.status = code
	s.ResponseWriter.WriteHeader(code)
}

func (s *statusRecorder) Unwrap() http.ResponseWriter { return s.ResponseWriter }

func logRequests(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		rec := &statusRecorder{ResponseWriter: w, status: http.StatusOK}
		next.ServeHTTP(rec, r)
		slog.Info("request",
			"method", r.Method,
			"path", r.URL.Path,
			"status", rec.status,
			"duration", time.Since(start),
		)
	})
}

// recoverer turns a handler panic into a 500 instead of dropping the
// connection, and logs the stack.
func recoverer(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if v := recover(); v != nil {
				if v == http.ErrAbortHandler {
					panic(v)
				}
				slog.Error("panic", "err", v, "stack", string(debug.Stack()))
				httpx.Error(w, http.StatusInternalServerError, "internal server error")
			}
		}()
		next.ServeHTTP(w, r)
	})
}
