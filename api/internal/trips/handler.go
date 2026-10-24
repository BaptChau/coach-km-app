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
	db    *database.DB
	reads *database.Queries
}

func NewHandler(db *database.DB) *Handler {
	return &Handler{db: db, reads: database.New(db.Read)}
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
	CreatedAt   time.Time `json:"createdAt"`
}

// Trips carry no € amount: the barème is tiered on the yearly distance per
// vehicle, so money only exists in /summary.
func toResponse(t database.Trip) Trip {
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
		BilledKm:    rates.BilledKm(t.DistanceKm, t.RoundTrip),
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

var (
	errNotFound = errors.New("not found")
	errLocked   = errors.New("locked")
)

const lockedMsg = "this year's reimbursement was waived; its trips can no longer change"

// checkUnlocked fails with errLocked when the coach waived reimbursement for
// the year of date: the declared amount must keep matching the trips.
func checkUnlocked(r *http.Request, q *database.Queries, userID int64, date string) error {
	year, err := strconv.ParseInt(date[:4], 10, 64)
	if err != nil {
		return err
	}
	waived, err := q.WaiverExists(r.Context(), database.WaiverExistsParams{UserID: userID, Year: year})
	if err != nil {
		return err
	}
	if waived {
		return errLocked
	}
	return nil
}

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
	out := make([]Trip, len(rows))
	for i, t := range rows {
		out[i] = toResponse(t)
	}
	httpx.WriteJSON(w, http.StatusOK, out)
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
	err := h.db.WriteTx(r.Context(), func(q *database.Queries) error {
		if t.ClientID != nil {
			// Same clientId already stored: a replayed offline request.
			// Answer with the original trip instead of a duplicate, even if
			// its year has been locked since.
			existing, err := q.GetTripByClientID(r.Context(), database.GetTripByClientIDParams{
				UserID: userID, ClientID: t.ClientID,
			})
			if err == nil {
				status, t = http.StatusOK, existing
				return nil
			}
			if !errors.Is(err, sql.ErrNoRows) {
				return err
			}
		}
		if err := checkUnlocked(r, q, userID, t.Date); err != nil {
			return err
		}
		// The write transaction is BEGIN IMMEDIATE, so no other writer can
		// insert the same clientId between the lookup above and this insert.
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
		t = created
		return err
	})
	switch {
	case errors.Is(err, errLocked):
		httpx.Error(w, http.StatusConflict, lockedMsg)
	case database.IsForeignKeyViolation(err):
		httpx.Error(w, http.StatusBadRequest, badVehicle)
	case err != nil:
		httpx.Internal(w, r, err)
	default:
		httpx.WriteJSON(w, status, toResponse(t))
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
	httpx.WriteJSON(w, http.StatusOK, toResponse(trip))
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
		updated database.Trip
		msg     string
	)
	err := h.db.WriteTx(r.Context(), func(q *database.Queries) error {
		t, err := q.GetTrip(r.Context(), database.GetTripParams{ID: id, UserID: userID})
		if errors.Is(err, sql.ErrNoRows) {
			return errNotFound
		}
		if err != nil {
			return err
		}
		// Both the old and the new date must be in unlocked years.
		if err := checkUnlocked(r, q, userID, t.Date); err != nil {
			return err
		}
		if msg = in.apply(&t); msg != "" {
			return nil
		}
		if err := checkUnlocked(r, q, userID, t.Date); err != nil {
			return err
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
		return err
	})
	switch {
	case errors.Is(err, errNotFound):
		notFound(w)
	case errors.Is(err, errLocked):
		httpx.Error(w, http.StatusConflict, lockedMsg)
	case database.IsForeignKeyViolation(err):
		httpx.Error(w, http.StatusBadRequest, badVehicle)
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

	err := h.db.WriteTx(r.Context(), func(q *database.Queries) error {
		t, err := q.GetTrip(r.Context(), database.GetTripParams{ID: id, UserID: userID})
		if errors.Is(err, sql.ErrNoRows) {
			return errNotFound
		}
		if err != nil {
			return err
		}
		if err := checkUnlocked(r, q, userID, t.Date); err != nil {
			return err
		}
		_, err = q.DeleteTrip(r.Context(), database.DeleteTripParams{ID: id, UserID: userID})
		return err
	})
	switch {
	case errors.Is(err, errNotFound):
		notFound(w)
	case errors.Is(err, errLocked):
		httpx.Error(w, http.StatusConflict, lockedMsg)
	case err != nil:
		httpx.Internal(w, r, err)
	default:
		w.WriteHeader(http.StatusNoContent)
	}
}

// Another user's trip and a missing trip both answer 404, so ids can't be
// probed for existence.
func notFound(w http.ResponseWriter) {
	httpx.Error(w, http.StatusNotFound, "trip not found")
}
