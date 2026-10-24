package auth

import (
	"context"
	"net/http"
	"strings"
)

type ctxKey struct{}

var userIDKey ctxKey

func RequireAuth(secret string, next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		header := r.Header.Get("Authorization")

		token, ok := strings.CutPrefix(header, "Bearer ")

		if !ok || token == "" {
			unauthorized(w, "missing or malformed Authorization header")
			return
		}

		userID, err := ValidateToken(secret, token)
		if err != nil {
			unauthorized(w, "invalid token")
			return
		}

		ctx := context.WithValue(r.Context(), userIDKey, userID)

		next(w, r.WithContext(ctx))
	}
}

func UserID(r *http.Request) (int64, bool) {
	id, ok := r.Context().Value(userIDKey).(int64)
	return id, ok
}

func unauthorized(w http.ResponseWriter, msg string) {
	w.Header().Set("WWW-Authenticate", `Bearer`)
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusUnauthorized)
	w.Write([]byte(`{"error":"` + msg + `"}`))
}
