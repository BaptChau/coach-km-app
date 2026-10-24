// Package receipts handles abandon de frais: a coach's written waiver of
// reimbursement for a year, and the Cerfa 11580 tax receipt the president
// issues for it.
package receipts

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"net/http"
	"sort"
	"time"

	"github.com/BaptChau/coach-km-app/api/internal/auth"
	"github.com/BaptChau/coach-km-app/api/internal/config"
	"github.com/BaptChau/coach-km-app/api/internal/database"
	"github.com/BaptChau/coach-km-app/api/internal/httpx"
	"github.com/BaptChau/coach-km-app/api/internal/rates"
	"github.com/BaptChau/coach-km-app/api/internal/report"
	"github.com/BaptChau/coach-km-app/api/internal/users"
)

const President = "president"

type Handler struct {
	db          *database.DB
	reads       *database.Queries
	association config.Association
}

func NewHandler(db *database.DB, association config.Association) *Handler {
	return &Handler{db: db, reads: database.New(db.Read), association: association}
}

func (h *Handler) Register(mux *http.ServeMux, jwtSecret string) {
	coach := func(f http.HandlerFunc) http.HandlerFunc { return auth.RequireAuth(jwtSecret, f) }
	president := func(f http.HandlerFunc) http.HandlerFunc { return auth.RequireAuth(jwtSecret, h.requirePresident(f)) }

	mux.HandleFunc("GET /waivers", coach(h.listWaivers))
	mux.HandleFunc("POST /waivers", coach(h.createWaiver))
	mux.HandleFunc("DELETE /waivers/{year}", coach(h.deleteWaiver))
	mux.HandleFunc("GET /receipts/{id}/pdf", coach(h.receiptPDF))

	mux.HandleFunc("GET /admin/coaches", president(h.listCoaches))
	mux.HandleFunc("GET /admin/receipts", president(h.listReceipts))
	mux.HandleFunc("POST /admin/receipts", president(h.issueReceipt))
}

// requirePresident checks the role in the database on every request, so a
// demoted president loses access immediately rather than when the JWT expires.
func (h *Handler) requirePresident(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, _ := auth.UserID(r)
		u, err := h.reads.GetUserByID(r.Context(), userID)
		if errors.Is(err, sql.ErrNoRows) {
			httpx.Error(w, http.StatusUnauthorized, "account not found")
			return
		}
		if err != nil {
			httpx.Internal(w, r, err)
			return
		}
		if u.Role != President {
			httpx.Error(w, http.StatusForbidden, "president only")
			return
		}
		next(w, r)
	}
}

type Receipt struct {
	ID       int64     `json:"id"`
	Number   string    `json:"number"`
	Year     int64     `json:"year"`
	CoachID  int64     `json:"coachId"`
	Amount   float64   `json:"amount"`
	WaivedAt time.Time `json:"waivedAt"`
	IssuedAt time.Time `json:"issuedAt"`
	IssuedBy int64     `json:"issuedBy"`
}

func receiptNumber(r database.TaxReceipt) string { return fmt.Sprintf("%d-%04d", r.Year, r.Seq) }

func toReceipt(r database.TaxReceipt) Receipt {
	return Receipt{
		ID: r.ID, Number: receiptNumber(r), Year: r.Year, CoachID: r.UserID,
		Amount: rates.Euros(r.AmountCents), WaivedAt: r.WaivedAt, IssuedAt: r.IssuedAt, IssuedBy: r.IssuedBy,
	}
}

type Waiver struct {
	Year     int64     `json:"year"`
	Km       float64   `json:"km"`
	Amount   float64   `json:"amount"`
	WaivedAt time.Time `json:"waivedAt"`
	Receipt  *Receipt  `json:"receipt"`
}

func toWaiver(w database.Waiver, rc *database.TaxReceipt) Waiver {
	out := Waiver{Year: w.Year, Km: w.Km, Amount: rates.Euros(w.AmountCents), WaivedAt: w.WaivedAt}
	if rc != nil {
		r := toReceipt(*rc)
		out.Receipt = &r
	}
	return out
}

// ---- coach side ----

func (h *Handler) listWaivers(w http.ResponseWriter, r *http.Request) {
	userID, _ := auth.UserID(r)
	ws, err := h.reads.ListWaiversByUser(r.Context(), userID)
	if err != nil {
		httpx.Internal(w, r, err)
		return
	}
	rs, err := h.reads.ListReceiptsByUser(r.Context(), userID)
	if err != nil {
		httpx.Internal(w, r, err)
		return
	}
	byYear := make(map[int64]*database.TaxReceipt, len(rs))
	for i := range rs {
		byYear[rs[i].Year] = &rs[i]
	}
	out := make([]Waiver, len(ws))
	for i, wv := range ws {
		out[i] = toWaiver(wv, byYear[wv.Year])
	}
	httpx.WriteJSON(w, http.StatusOK, out)
}

var (
	errNothingToWaive = errors.New("no mileage to waive for this year")
	errNoAddress      = errors.New("set your postal address (PATCH /auth/me) first: it is printed on the tax receipt")
	errAlreadyWaived  = errors.New("reimbursement for this year is already waived")
)

// createWaiver records the coach's written renunciation of reimbursement
// for a year. The amount is valued and frozen inside the same transaction
// as the insert, and the year's trips are locked from then on.
func (h *Handler) createWaiver(w http.ResponseWriter, r *http.Request) {
	userID, _ := auth.UserID(r)
	var in struct {
		Year int `json:"year"`
	}
	if err := httpx.ReadJSON(w, r, &in); err != nil {
		httpx.Error(w, http.StatusBadRequest, err.Error())
		return
	}
	if in.Year < 2000 || in.Year > time.Now().Year() {
		httpx.Error(w, http.StatusBadRequest, "year must be a past or current year")
		return
	}

	var created database.Waiver
	err := h.db.WriteTx(r.Context(), func(q *database.Queries) error {
		u, err := q.GetUserByID(r.Context(), userID)
		if err != nil {
			return err
		}
		if !users.ToCoach(u).Address.Complete() {
			return errNoAddress
		}
		val, err := report.Value(r.Context(), q, userID, in.Year)
		if err != nil {
			return err
		}
		if val.TotalCents <= 0 {
			return errNothingToWaive
		}
		created, err = q.CreateWaiver(r.Context(), database.CreateWaiverParams{
			UserID: userID, Year: int64(in.Year), Km: val.TotalKm, AmountCents: val.TotalCents,
		})
		if database.IsUniqueViolation(err) {
			return errAlreadyWaived
		}
		return err
	})
	switch {
	case errors.Is(err, errNoAddress), errors.Is(err, errNothingToWaive):
		httpx.Error(w, http.StatusBadRequest, err.Error())
	case errors.Is(err, errAlreadyWaived):
		httpx.Error(w, http.StatusConflict, err.Error())
	case err != nil:
		httpx.Internal(w, r, err)
	default:
		httpx.WriteJSON(w, http.StatusCreated, toWaiver(created, nil))
	}
}

// deleteWaiver withdraws a waiver and unlocks the year, as long as no
// receipt was issued for it.
func (h *Handler) deleteWaiver(w http.ResponseWriter, r *http.Request) {
	userID, _ := auth.UserID(r)
	year, err := parseYear(r.PathValue("year"))
	if err != nil {
		httpx.Error(w, http.StatusBadRequest, "invalid year")
		return
	}
	n, err := h.db.WriteQueries().DeleteWaiver(r.Context(), database.DeleteWaiverParams{UserID: userID, Year: year})
	switch {
	case database.IsForeignKeyViolation(err):
		httpx.Error(w, http.StatusConflict, "a tax receipt was already issued for this year")
	case err != nil:
		httpx.Internal(w, r, err)
	case n == 0:
		httpx.Error(w, http.StatusNotFound, "no waiver for this year")
	default:
		w.WriteHeader(http.StatusNoContent)
	}
}

func parseYear(s string) (int64, error) {
	var y int64
	if _, err := fmt.Sscan(s, &y); err != nil || y < 2000 || y > 2100 {
		return 0, errors.New("invalid year")
	}
	return y, nil
}

// receiptPDF serves a receipt to its coach, or to the president.
func (h *Handler) receiptPDF(w http.ResponseWriter, r *http.Request) {
	userID, _ := auth.UserID(r)
	id, ok := httpx.PathID(w, r)
	if !ok {
		return
	}
	ctx := r.Context()
	rc, err := h.reads.GetReceipt(ctx, id)
	if errors.Is(err, sql.ErrNoRows) {
		httpx.Error(w, http.StatusNotFound, "receipt not found")
		return
	}
	if err != nil {
		httpx.Internal(w, r, err)
		return
	}
	if rc.UserID != userID {
		me, err := h.reads.GetUserByID(ctx, userID)
		if err != nil || me.Role != President {
			// Same answer as a missing receipt, so ids can't be probed.
			httpx.Error(w, http.StatusNotFound, "receipt not found")
			return
		}
	}

	coach, err := h.reads.GetUserByID(ctx, rc.UserID)
	if err != nil {
		httpx.Internal(w, r, err)
		return
	}
	issuer, err := h.reads.GetUserByID(ctx, rc.IssuedBy)
	if err != nil {
		httpx.Internal(w, r, err)
		return
	}
	waiver, err := h.reads.GetWaiver(ctx, database.GetWaiverParams{UserID: rc.UserID, Year: rc.Year})
	if err != nil {
		httpx.Internal(w, r, err)
		return
	}

	pdf := buildReceiptPDF(h.association, rc, waiver, coach, issuer)
	w.Header().Set("Content-Type", "application/pdf")
	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="recu-fiscal-%s.pdf"`, receiptNumber(rc)))
	w.Header().Set("Cache-Control", "no-store")
	if err := pdf.Output(w); err != nil {
		httpx.Internal(w, r, err)
	}
}

// ---- president side ----

type coachYear struct {
	Coach       users.Coach `json:"coach"`
	TotalKm     float64     `json:"totalKm"`
	TotalAmount float64     `json:"totalAmount"`
	Waiver      *Waiver     `json:"waiver"`
}

// listCoaches values every coach's year in a fixed number of queries
// (no per-coach round trips).
func (h *Handler) listCoaches(w http.ResponseWriter, r *http.Request) {
	year, ok := httpx.QueryYear(w, r)
	if !ok {
		return
	}
	ctx := r.Context()
	all, err := h.loadYear(ctx, year)
	if err != nil {
		httpx.Internal(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, all)
}

func (h *Handler) loadYear(ctx context.Context, year int) ([]coachYear, error) {
	us, err := h.reads.ListUsers(ctx)
	if err != nil {
		return nil, err
	}
	vehicles, err := h.reads.ListAllVehicles(ctx)
	if err != nil {
		return nil, err
	}
	from, to := httpx.YearRange(year)
	sums, err := h.reads.SumKmByUserVehicle(ctx, database.SumKmByUserVehicleParams{FromDate: from, ToDate: to})
	if err != nil {
		return nil, err
	}
	ws, err := h.reads.ListWaiversByYear(ctx, int64(year))
	if err != nil {
		return nil, err
	}
	rs, err := h.reads.ListReceiptsByYear(ctx, int64(year))
	if err != nil {
		return nil, err
	}

	vehiclesByUser := map[int64][]database.Vehicle{}
	for _, v := range vehicles {
		vehiclesByUser[v.UserID] = append(vehiclesByUser[v.UserID], v)
	}
	// Months don't matter for a yearly total; Compute only needs the per-
	// vehicle sums, so they're all filed under month 1.
	sumsByUser := map[int64][]report.MonthKm{}
	for _, s := range sums {
		sumsByUser[s.UserID] = append(sumsByUser[s.UserID], report.MonthKm{Month: 1, VehicleID: s.VehicleID, Km: s.Km})
	}
	waivers := map[int64]database.Waiver{}
	for _, wv := range ws {
		waivers[wv.UserID] = wv
	}
	receipts := map[int64]*database.TaxReceipt{}
	for i := range rs {
		receipts[rs[i].UserID] = &rs[i]
	}

	out := make([]coachYear, len(us))
	for i, u := range us {
		val := report.Compute(year, vehiclesByUser[u.ID], sumsByUser[u.ID])
		out[i] = coachYear{Coach: users.ToCoach(u), TotalKm: val.TotalKm, TotalAmount: rates.Euros(val.TotalCents)}
		if wv, ok := waivers[u.ID]; ok {
			v := toWaiver(wv, receipts[u.ID])
			out[i].Waiver = &v
		}
	}
	return out, nil
}

func (h *Handler) listReceipts(w http.ResponseWriter, r *http.Request) {
	year, ok := httpx.QueryYear(w, r)
	if !ok {
		return
	}
	rs, err := h.reads.ListReceiptsByYear(r.Context(), int64(year))
	if err != nil {
		httpx.Internal(w, r, err)
		return
	}
	out := make([]Receipt, len(rs))
	for i, rc := range rs {
		out[i] = toReceipt(rc)
	}
	sort.Slice(out, func(a, b int) bool { return out[a].Number < out[b].Number })
	httpx.WriteJSON(w, http.StatusOK, out)
}

var (
	errNoWaiver      = errors.New("this coach has not waived reimbursement for this year")
	errAlreadyIssued = errors.New("a receipt was already issued for this coach and year")
)

// issueReceipt numbers and records a receipt. Numbers are sequential per
// year ("2025-0001"): the next number is read and used inside one BEGIN
// IMMEDIATE transaction, so concurrent issues can't get the same number.
func (h *Handler) issueReceipt(w http.ResponseWriter, r *http.Request) {
	presidentID, _ := auth.UserID(r)
	var in struct {
		CoachID int64 `json:"coachId"`
		Year    int64 `json:"year"`
	}
	if err := httpx.ReadJSON(w, r, &in); err != nil {
		httpx.Error(w, http.StatusBadRequest, err.Error())
		return
	}
	if !h.association.Complete() {
		httpx.Error(w, http.StatusServiceUnavailable, "association details are not configured on the server (ASSOCIATION_* settings)")
		return
	}

	var created database.TaxReceipt
	err := h.db.WriteTx(r.Context(), func(q *database.Queries) error {
		wv, err := q.GetWaiver(r.Context(), database.GetWaiverParams{UserID: in.CoachID, Year: in.Year})
		if errors.Is(err, sql.ErrNoRows) {
			return errNoWaiver
		}
		if err != nil {
			return err
		}
		seq, err := q.NextReceiptSeq(r.Context(), in.Year)
		if err != nil {
			return err
		}
		created, err = q.CreateReceipt(r.Context(), database.CreateReceiptParams{
			Year: in.Year, Seq: seq, UserID: in.CoachID, AmountCents: wv.AmountCents,
			WaivedAt: wv.WaivedAt, IssuedBy: presidentID,
		})
		if database.UniqueViolationOn(err, "tax_receipts.user_id") {
			return errAlreadyIssued
		}
		return err
	})
	switch {
	case errors.Is(err, errNoWaiver):
		httpx.Error(w, http.StatusConflict, err.Error())
	case errors.Is(err, errAlreadyIssued):
		httpx.Error(w, http.StatusConflict, err.Error())
	case err != nil:
		httpx.Internal(w, r, err)
	default:
		httpx.WriteJSON(w, http.StatusCreated, toReceipt(created))
	}
}
