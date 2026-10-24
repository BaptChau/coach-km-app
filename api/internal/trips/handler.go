package trips

import (
	"database/sql"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/BaptChau/coach-km-app/api/internal/auth"
	"github.com/BaptChau/coach-km-app/api/internal/database"
	"github.com/BaptChau/coach-km-app/api/internal/httpx"
	"github.com/BaptChau/coach-km-app/api/internal/rates"
)

const (
	defaultLimit = 1000
	maxLimit     = 1000
	maxTextLen   = 255
	maxClientID  = 64
	maxDistance  = 100_000
)

type Handler struct {
	db     *database.DB
	reads  *database.Queries
	writes *database.Queries
	rates  *rates.Table
}

func NewHandler(db *database.DB, rt *rates.Table) *Handler {
	return &Handler{
		db:     db,
		reads:  database.New(db.Read),
		writes: database.New(db.Write),
		rates:  rt,
	}
}

func (h *Handler) Register(mux *http.ServeMux, jwtSecret string) {
	mux.HandleFunc("GET /trips", auth.RequireAuth(jwtSecret, h.list))
	mux.HandleFunc("POST /trips", auth.RequireAuth(jwtSecret, h.create))
	mux.HandleFunc("GET /trips/{id}", auth.RequireAuth(jwtSecret, h.get))
	mux.HandleFunc("PATCH /trips/{id}", auth.RequireAuth(jwtSecret, h.update))
	mux.HandleFunc("DELETE /trips/{id}", auth.RequireAuth(jwtSecret, h.delete))
}

// tripInput uses pointers so PATCH can tell "not sent" from a zero value.
type tripInput struct {
	ClientID    *string  `json:"clientId"`
	Date        *string  `json:"date"`
	Origin      *string  `json:"origin"`
	Destination *string  `json:"destination"`
	Purpose     *string  `json:"purpose"`
	VehicleID   *int64   `json:"vehicleId"`
	DistanceKm  *float64 `json:"distanceKm"`
	RoundTrip   *bool    `json:"roundTrip"`
}

type Trip struct {
	ID          int64     `json:"id"`
	ClientID    *string   `json:"clientId"`
	Date        string    `json:"date"`
	Origin      string    `json:"origin"`
	Destination string    `json:"destination"`
	Purpose     string    `json:"purpose"`
	VehicleID   int64     `json:"vehicleId"`
	DistanceKm  float64   `json:"distanceKm"`
	RoundTrip   bool      `json:"roundTrip"`
	BilledKm    float64   `json:"billedKm"`
	Rate        float64   `json:"rate"`
	Amount      float64   `json:"amount"`
	CreatedAt   time.Time `json:"createdAt"`
}

func (h *Handler) toResponse(t database.Trip, vehicleType string) Trip {
	year, _ := strconv.Atoi(t.Date[:4])
	rt := h.rates.For(year)
	billed := rates.BilledKm(t.DistanceKm, t.RoundTrip)
	return Trip{
		ID:          t.ID,
		ClientID:    t.ClientID,
		Date:        t.Date,
		Origin:      t.Origin,
		Destination: t.Destination,
		Purpose:     t.Purpose,
		VehicleID:   t.VehicleID,
		DistanceKm:  t.DistanceKm,
		RoundTrip:   t.RoundTrip,
		BilledKm:    billed,
		Rate:        rt.EurPerKm(vehicleType),
		Amount:      rates.Euros(rt.AmountCents(vehicleType, billed)),
		CreatedAt:   t.CreatedAt,
	}
}

func text(dst *string, src *string) {
	if src != nil {
		*dst = strings.TrimSpace(*src)
	}
}

// apply merges in onto t (only the fields that were sent) and validates the
// result, so create and PATCH share one set of rules.
func (in tripInput) apply(t *database.Trip) string {
	text(&t.Date, in.Date)
	text(&t.Origin, in.Origin)
	text(&t.Destination, in.Destination)
	text(&t.Purpose, in.Purpose)
	if in.VehicleID != nil {
		t.VehicleID = *in.VehicleID
	}
	if in.DistanceKm != nil {
		t.DistanceKm = *in.DistanceKm
	}
	if in.RoundTrip != nil {
		t.RoundTrip = *in.RoundTrip
	}

	if _, err := time.Parse(time.DateOnly, t.Date); err != nil {
		return "date must be YYYY-MM-DD"
	}
	for _, f := range []struct{ name, v string }{
		{"origin", t.Origin}, {"destination", t.Destination}, {"purpose", t.Purpose},
	} {
		if f.v == "" || utf8.RuneCountInString(f.v) > maxTextLen {
			return f.name + " is required (max 255 characters)"
		}
	}
	if t.VehicleID <= 0 {
		return "vehicleId is required"
	}
	if !(t.DistanceKm > 0) || t.DistanceKm > maxDistance {
		return "distanceKm must be > 0 and <= 100000"
	}
	return ""
}

var errNotFound = errors.New("not found")

const badVehicle = "vehicleId must be one of your vehicles"

func (h *Handler) list(w http.ResponseWriter, r *http.Request) {
	userID, _ := auth.UserID(r)
	year, ok := httpx.QueryYear(w, r)
	if !ok {
		return
	}
	limit, err := httpx.QueryInt(r, "limit", defaultLimit)
	if err != nil || limit < 1 || limit > maxLimit {
		httpx.Error(w, http.StatusBadRequest, "limit must be between 1 and 1000")
		return
	}
	offset, err := httpx.QueryInt(r, "offset", 0)
	if err != nil || offset < 0 {
		httpx.Error(w, http.StatusBadRequest, "offset must be >= 0")
		return
	}

	from, to := httpx.YearRange(year)
	rows, err := h.reads.ListTripsByUserYear(r.Context(), database.ListTripsByUserYearParams{
		UserID: userID, FromDate: from, ToDate: to, Lim: limit, Off: offset,
	})
	if err != nil {
		httpx.Internal(w, r, err)
		return
	}
	types, err := h.vehicleTypes(r, userID)
	if err != nil {
		httpx.Internal(w, r, err)
		return
	}

	out := make([]Trip, len(rows))
	for i, t := range rows {
		out[i] = h.toResponse(t, types[t.VehicleID])
	}
	httpx.WriteJSON(w, http.StatusOK, out)
}

// vehicleTypes maps the user's vehicle ids to their type: one small indexed
// query instead of one lookup per trip.
func (h *Handler) vehicleTypes(r *http.Request, userID int64) (map[int64]string, error) {
	vs, err := h.reads.ListVehiclesByUser(r.Context(), userID)
	if err != nil {
		return nil, err
	}
	m := make(map[int64]string, len(vs))
	for _, v := range vs {
		m[v.ID] = v.Type
	}
	return m, nil
}

func (h *Handler) create(w http.ResponseWriter, r *http.Request) {
	userID, _ := auth.UserID(r)
	var in tripInput
	if err := httpx.ReadJSON(w, r, &in); err != nil {
		httpx.Error(w, http.StatusBadRequest, err.Error())
		return
	}
	var t database.Trip
	if msg := in.apply(&t); msg != "" {
		httpx.Error(w, http.StatusBadRequest, msg)
		return
	}
	if in.ClientID != nil {
		if id := strings.TrimSpace(*in.ClientID); id == "" || len(id) > maxClientID {
			httpx.Error(w, http.StatusBadRequest, "clientId must be 1-64 characters")
			return
		} else {
			t.ClientID = &id
		}
	}

	status := http.StatusCreated
	var vehicleType string
	err := h.db.WriteTx(r.Context(), func(q *database.Queries) error {
		created, err := q.CreateTrip(r.Context(), database.CreateTripParams{
			UserID:      userID,
			VehicleID:   t.VehicleID,
			ClientID:    t.ClientID,
			Date:        t.Date,
			Origin:      t.Origin,
			Destination: t.Destination,
			Purpose:     t.Purpose,
			DistanceKm:  t.DistanceKm,
			RoundTrip:   t.RoundTrip,
		})
		if errors.Is(err, sql.ErrNoRows) && t.ClientID != nil {
			// Same clientId already stored: a replayed offline request.
			// Answer with the original trip instead of a duplicate.
			status = http.StatusOK
			created, err = q.GetTripByClientID(r.Context(), database.GetTripByClientIDParams{
				UserID: userID, ClientID: t.ClientID,
			})
		}
		if err != nil {
			return err
		}
		t = created
		vehicleType, err = q.GetVehicleType(r.Context(), database.GetVehicleTypeParams{ID: t.VehicleID, UserID: userID})
		return err
	})
	switch {
	case database.IsForeignKeyViolation(err):
		httpx.Error(w, http.StatusBadRequest, badVehicle)
	case err != nil:
		httpx.Internal(w, r, err)
	default:
		httpx.WriteJSON(w, status, h.toResponse(t, vehicleType))
	}
}

func (h *Handler) get(w http.ResponseWriter, r *http.Request) {
	userID, _ := auth.UserID(r)
	id, ok := httpx.PathID(w, r)
	if !ok {
		return
	}

	trip, err := h.reads.GetTrip(r.Context(), database.GetTripParams{ID: id, UserID: userID})
	if errors.Is(err, sql.ErrNoRows) {
		notFound(w)
		return
	}
	if err != nil {
		httpx.Internal(w, r, err)
		return
	}
	vehicleType, err := h.reads.GetVehicleType(r.Context(), database.GetVehicleTypeParams{ID: trip.VehicleID, UserID: userID})
	if err != nil {
		httpx.Internal(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, h.toResponse(trip, vehicleType))
}

func (h *Handler) update(w http.ResponseWriter, r *http.Request) {
	userID, _ := auth.UserID(r)
	id, ok := httpx.PathID(w, r)
	if !ok {
		return
	}
	var in tripInput
	if err := httpx.ReadJSON(w, r, &in); err != nil {
		httpx.Error(w, http.StatusBadRequest, err.Error())
		return
	}
	if in.ClientID != nil {
		httpx.Error(w, http.StatusBadRequest, "clientId can't be changed")
		return
	}

	var (
		updated     database.Trip
		vehicleType string
		msg         string
	)
	err := h.db.WriteTx(r.Context(), func(q *database.Queries) error {
		t, err := q.GetTrip(r.Context(), database.GetTripParams{ID: id, UserID: userID})
		if errors.Is(err, sql.ErrNoRows) {
			return errNotFound
		}
		if err != nil {
			return err
		}
		if msg = in.apply(&t); msg != "" {
			return nil
		}
		updated, err = q.UpdateTrip(r.Context(), database.UpdateTripParams{
			VehicleID:   t.VehicleID,
			Date:        t.Date,
			Origin:      t.Origin,
			Destination: t.Destination,
			Purpose:     t.Purpose,
			DistanceKm:  t.DistanceKm,
			RoundTrip:   t.RoundTrip,
			ID:          id,
			UserID:      userID,
		})
		if err != nil {
			return err
		}
		vehicleType, err = q.GetVehicleType(r.Context(), database.GetVehicleTypeParams{ID: t.VehicleID, UserID: userID})
		return err
	})
	switch {
	case errors.Is(err, errNotFound):
		notFound(w)
	case database.IsForeignKeyViolation(err):
		httpx.Error(w, http.StatusBadRequest, badVehicle)
	case err != nil:
		httpx.Internal(w, r, err)
	case msg != "":
		httpx.Error(w, http.StatusBadRequest, msg)
	default:
		httpx.WriteJSON(w, http.StatusOK, h.toResponse(updated, vehicleType))
	}
}

func (h *Handler) delete(w http.ResponseWriter, r *http.Request) {
	userID, _ := auth.UserID(r)
	id, ok := httpx.PathID(w, r)
	if !ok {
		return
	}

	n, err := h.writes.DeleteTrip(r.Context(), database.DeleteTripParams{ID: id, UserID: userID})
	if err != nil {
		httpx.Internal(w, r, err)
		return
	}
	if n == 0 {
		notFound(w)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// Another user's trip and a missing trip both answer 404, so ids can't be
// probed for existence.
func notFound(w http.ResponseWriter) {
	httpx.Error(w, http.StatusNotFound, "trip not found")
}
