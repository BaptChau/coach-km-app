package vehicles

import (
	"database/sql"
	"errors"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/BaptChau/coach-km-app/api/internal/auth"
	"github.com/BaptChau/coach-km-app/api/internal/database"
	"github.com/BaptChau/coach-km-app/api/internal/httpx"
	"github.com/BaptChau/coach-km-app/api/internal/rates"
)

type Handler struct {
	db     *database.DB
	reads  *database.Queries
	writes *database.Queries
}

func NewHandler(db *database.DB) *Handler {
	return &Handler{
		db:     db,
		reads:  database.New(db.Read),
		writes: database.New(db.Write),
	}
}

func (h *Handler) Register(mux *http.ServeMux, jwtSecret string) {
	mux.HandleFunc("GET /vehicles", auth.RequireAuth(jwtSecret, h.list))
	mux.HandleFunc("POST /vehicles", auth.RequireAuth(jwtSecret, h.create))
	mux.HandleFunc("PATCH /vehicles/{id}", auth.RequireAuth(jwtSecret, h.update))
	mux.HandleFunc("DELETE /vehicles/{id}", auth.RequireAuth(jwtSecret, h.delete))
}

type vehicleInput struct {
	Label *string `json:"label"`
	Type  *string `json:"type"`
}

type Vehicle struct {
	ID        int64     `json:"id"`
	Label     string    `json:"label"`
	Type      string    `json:"type"`
	CreatedAt time.Time `json:"createdAt"`
}

func toResponse(v database.Vehicle) Vehicle {
	return Vehicle{ID: v.ID, Label: v.Label, Type: v.Type, CreatedAt: v.CreatedAt}
}

// apply merges in onto v (only the fields that were sent) and validates.
func (in vehicleInput) apply(v *database.Vehicle) string {
	if in.Label != nil {
		v.Label = strings.TrimSpace(*in.Label)
	}
	if in.Type != nil {
		v.Type = *in.Type
	}
	if n := utf8.RuneCountInString(v.Label); n < 1 || n > 100 {
		return "label is required (max 100 characters)"
	}
	if !rates.ValidVehicleType(v.Type) {
		return `type must be "car" or "two_wheeler"`
	}
	return ""
}

var errNotFound = errors.New("not found")

func (h *Handler) list(w http.ResponseWriter, r *http.Request) {
	userID, _ := auth.UserID(r)
	rows, err := h.reads.ListVehiclesByUser(r.Context(), userID)
	if err != nil {
		httpx.Internal(w, r, err)
		return
	}
	out := make([]Vehicle, len(rows))
	for i, v := range rows {
		out[i] = toResponse(v)
	}
	httpx.WriteJSON(w, http.StatusOK, out)
}

func (h *Handler) create(w http.ResponseWriter, r *http.Request) {
	userID, _ := auth.UserID(r)
	var in vehicleInput
	if err := httpx.ReadJSON(w, r, &in); err != nil {
		httpx.Error(w, http.StatusBadRequest, err.Error())
		return
	}
	var v database.Vehicle
	if msg := in.apply(&v); msg != "" {
		httpx.Error(w, http.StatusBadRequest, msg)
		return
	}
	created, err := h.writes.CreateVehicle(r.Context(), database.CreateVehicleParams{
		UserID: userID, Label: v.Label, Type: v.Type,
	})
	if err != nil {
		httpx.Internal(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusCreated, toResponse(created))
}

func (h *Handler) update(w http.ResponseWriter, r *http.Request) {
	userID, _ := auth.UserID(r)
	id, ok := httpx.PathID(w, r)
	if !ok {
		return
	}
	var in vehicleInput
	if err := httpx.ReadJSON(w, r, &in); err != nil {
		httpx.Error(w, http.StatusBadRequest, err.Error())
		return
	}

	var updated database.Vehicle
	var msg string
	err := h.db.WriteTx(r.Context(), func(q *database.Queries) error {
		v, err := q.GetVehicle(r.Context(), database.GetVehicleParams{ID: id, UserID: userID})
		if errors.Is(err, sql.ErrNoRows) {
			return errNotFound
		}
		if err != nil {
			return err
		}
		if msg = in.apply(&v); msg != "" {
			return nil
		}
		updated, err = q.UpdateVehicle(r.Context(), database.UpdateVehicleParams{
			Label: v.Label, Type: v.Type, ID: id, UserID: userID,
		})
		return err
	})
	switch {
	case errors.Is(err, errNotFound):
		httpx.Error(w, http.StatusNotFound, "vehicle not found")
	case err != nil:
		httpx.Internal(w, r, err)
	case msg != "":
		httpx.Error(w, http.StatusBadRequest, msg)
	default:
		httpx.WriteJSON(w, http.StatusOK, toResponse(updated))
	}
}

func (h *Handler) delete(w http.ResponseWriter, r *http.Request) {
	userID, _ := auth.UserID(r)
	id, ok := httpx.PathID(w, r)
	if !ok {
		return
	}
	n, err := h.writes.DeleteVehicle(r.Context(), database.DeleteVehicleParams{ID: id, UserID: userID})
	switch {
	case database.IsForeignKeyViolation(err):
		// Trips keep their vehicle for the tax récapitulatif.
		httpx.Error(w, http.StatusConflict, "vehicle is used by trips; delete or reassign them first")
	case err != nil:
		httpx.Internal(w, r, err)
	case n == 0:
		httpx.Error(w, http.StatusNotFound, "vehicle not found")
	default:
		w.WriteHeader(http.StatusNoContent)
	}
}
