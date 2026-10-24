// Package httpx holds the JSON request/response helpers shared by handlers.
package httpx

import (
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"strconv"
	"time"
)

// maxBodyBytes bounds every JSON request body so a client can't make the
// server buffer an arbitrarily large payload.
const maxBodyBytes = 1 << 20

func ReadJSON(w http.ResponseWriter, r *http.Request, dst any) error {
	r.Body = http.MaxBytesReader(w, r.Body, maxBodyBytes)
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()

	if err := dec.Decode(dst); err != nil {
		var maxErr *http.MaxBytesError
		if errors.As(err, &maxErr) {
			return fmt.Errorf("request body too large")
		}
		return fmt.Errorf("invalid JSON body: %w", err)
	}
	if dec.More() {
		return errors.New("request body must contain a single JSON object")
	}
	return nil
}

func WriteJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(v); err != nil {
		slog.Warn("write response", "err", err)
	}
}

func Error(w http.ResponseWriter, status int, msg string) {
	WriteJSON(w, status, map[string]string{"error": msg})
}

// Internal logs err and answers 500 without leaking details to the client.
func Internal(w http.ResponseWriter, r *http.Request, err error) {
	slog.Error("internal error", "method", r.Method, "path", r.URL.Path, "err", err)
	Error(w, http.StatusInternalServerError, "internal server error")
}

// PathID parses the {id} path value, answering 400 itself when invalid.
func PathID(w http.ResponseWriter, r *http.Request) (int64, bool) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil || id <= 0 {
		Error(w, http.StatusBadRequest, "invalid id")
		return 0, false
	}
	return id, true
}

func QueryInt(r *http.Request, key string, def int64) (int64, error) {
	v := r.URL.Query().Get(key)
	if v == "" {
		return def, nil
	}
	return strconv.ParseInt(v, 10, 64)
}

// QueryYear parses ?year=YYYY (default: current year), answering 400 itself
// when invalid.
func QueryYear(w http.ResponseWriter, r *http.Request) (int, bool) {
	y, err := QueryInt(r, "year", int64(time.Now().Year()))
	if err != nil || y < 2000 || y > 2100 {
		Error(w, http.StatusBadRequest, "year must be YYYY")
		return 0, false
	}
	return int(y), true
}

// YearRange is the [from, to) date bounds of a year, as stored YYYY-MM-DD text.
func YearRange(year int) (string, string) {
	return fmt.Sprintf("%04d-01-01", year), fmt.Sprintf("%04d-01-01", year+1)
}
