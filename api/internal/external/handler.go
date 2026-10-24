package external

import (
	"log/slog"
	"net/http"
	"time"

	"github.com/BaptChau/coach-km-app/api/internal/auth"
	"github.com/BaptChau/coach-km-app/api/internal/httpx"
)

type Handler struct {
	client *Client
}

func NewHandler(client *Client) *Handler {
	return &Handler{client: client}
}

func (h *Handler) Register(mux *http.ServeMux, jwtSecret string) {
	mux.HandleFunc("GET /external/demo", auth.RequireAuth(jwtSecret, h.demo))
}

type demoResponse struct {
	Source    string    `json:"source"`
	FetchedAt time.Time `json:"fetched_at"`
	Item      Result    `json:"item"`
}

func (h *Handler) demo(w http.ResponseWriter, r *http.Request) {
	res, err := h.client.Fetch(r.Context())
	if err != nil {
		slog.Warn("external demo call failed", "err", err)
		httpx.Error(w, http.StatusBadGateway, "upstream service unavailable")
		return
	}
	httpx.WriteJSON(w, http.StatusOK, demoResponse{
		Source:    "jsonplaceholder",
		FetchedAt: time.Now().UTC(),
		Item:      res,
	})
}
