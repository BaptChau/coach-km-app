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
	Label            *string `json:"label"`
	Type             *string `json:"type"`
	FiscalHorsepower *int64  `json:"fiscalHorsepower"`
	Electric         *bool   `json:"electric"`
}

type Vehicle struct {
	ID               int64     `json:"id"`
	Label            string    `json:"label"`
	Type             string    `json:"type"`
	FiscalHorsepower *int64    `json:"fiscalHorsepower"`
	Electric         bool      `json:"electric"`
	CreatedAt        time.Time `json:"createdAt"`
}

func toResponse(v database.Vehicle) Vehicle {
	return Vehicle{
		ID: v.ID, Label: v.Label, Type: v.Type,
		FiscalHorsepower: v.FiscalHp, Electric: v.Electric, CreatedAt: v.CreatedAt,
	}
}

// apply merges in onto v (only the fields that were sent) and validates.
func (in vehicleInput) apply(v *database.Vehicle) string {
	if in.Label != nil {
		v.Label = strings.TrimSpace(*in.Label)
	}
	if in.Type != nil {
		v.Type = *in.Type
	}
	if in.FiscalHorsepower != nil {
		v.FiscalHp = in.FiscalHorsepower
	}
	if in.Electric != nil {
		v.Electric = *in.Electric
	}
	if n := utf8.RuneCountInString(v.Label); n < 1 || n > 100 {
		return "label is required (max 100 characters)"
	}
	if !rates.ValidVehicleType(v.Type) {
		return `type must be "car", "motorcycle" or "moped"`
	}
	if !rates.NeedsHorsepower(v.Type) {
		v.FiscalHp = nil // the moped barème has no horsepower bands
	} else if v.FiscalHp == nil || *v.FiscalHp < 1 || *v.FiscalHp > 99 {
		return "fiscalHorsepower (CV) is required for a car or motorcycle"
	}
	return ""
}

var (
	errNotFound = errors.New("not found")
	errLocked   = errors.New("locked")
)

// baremeChanged reports whether an edit changes how the vehicle is valued.
func baremeChanged(a, b database.Vehicle) bool {
	hp := func(p *int64) int64 {
		if p == nil {
			return 0
		}
		return *p
	}
	return a.Type != b.Type || a.Electric != b.Electric || hp(a.FiscalHp) != hp(b.FiscalHp)
}

// usedInWaivedYear reports whether the vehicle has trips in a year the coach
// already waived: re-valuing it would contradict the declared amount.
func (h *Handler) usedInWaivedYear(r *http.Request, q *database.Queries, vehicleID, userID int64) (bool, error) {
	years, err := q.TripYearsForVehicle(r.Context(), database.TripYearsForVehicleParams{VehicleID: vehicleID, UserID: userID})
	if err != nil {
		return false, err
	}
	for _, y := range years {
		waived, err := q.WaiverExists(r.Context(), database.WaiverExistsParams{UserID: userID, Year: y})
		if err != nil || waived {
			return waived, err
		}
	}
	return false, nil
}

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
		UserID: userID, Label: v.Label, Type: v.Type, FiscalHp: v.FiscalHp, Electric: v.Electric,
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
		before := v
		if msg = in.apply(&v); msg != "" {
			return nil
		}
		if baremeChanged(before, v) {
			locked, err := h.usedInWaivedYear(r, q, id, userID)
			if err != nil {
				return err
			}
			if locked {
				return errLocked
			}
		}
		updated, err = q.UpdateVehicle(r.Context(), database.UpdateVehicleParams{
			Label: v.Label, Type: v.Type, FiscalHp: v.FiscalHp, Electric: v.Electric, ID: id, UserID: userID,
		})
		return err
	})
	switch {
	case errors.Is(err, errNotFound):
		httpx.Error(w, http.StatusNotFound, "vehicle not found")
	case errors.Is(err, errLocked):
		httpx.Error(w, http.StatusConflict, "vehicle is used in a year whose reimbursement was waived; only its label can change")
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
