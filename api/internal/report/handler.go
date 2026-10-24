// Package report serves the yearly views built on trips: the barème, the
// dashboard summary, and the tax récapitulatif export.
package report

import (
	"net/http"

	"github.com/BaptChau/coach-km-app/api/internal/auth"
	"github.com/BaptChau/coach-km-app/api/internal/database"
	"github.com/BaptChau/coach-km-app/api/internal/httpx"
	"github.com/BaptChau/coach-km-app/api/internal/rates"
)

type Handler struct {
	reads *database.Queries
	rates *rates.Table
}

func NewHandler(db *database.DB, rt *rates.Table) *Handler {
	return &Handler{reads: database.New(db.Read), rates: rt}
}

func (h *Handler) Register(mux *http.ServeMux, jwtSecret string) {
	mux.HandleFunc("GET /rates", h.getRates)
	mux.HandleFunc("GET /summary", auth.RequireAuth(jwtSecret, h.summary))
	mux.HandleFunc("GET /export", auth.RequireAuth(jwtSecret, h.export))
}

type ratesResponse struct {
	Year        int                `json:"year"`
	Provisional bool               `json:"provisional"`
	Rates       map[string]float64 `json:"rates"`
}

func (h *Handler) getRates(w http.ResponseWriter, r *http.Request) {
	year, ok := httpx.QueryYear(w, r)
	if !ok {
		return
	}
	rt := h.rates.For(year)
	// Public and only changes yearly: let browsers and the PWA cache it.
	w.Header().Set("Cache-Control", "public, max-age=3600")
	httpx.WriteJSON(w, http.StatusOK, ratesResponse{
		Year:        year,
		Provisional: rt.Provisional,
		Rates: map[string]float64{
			rates.Car:        rt.EurPerKm(rates.Car),
			rates.TwoWheeler: rt.EurPerKm(rates.TwoWheeler),
		},
	})
}

type monthTotal struct {
	Month  int     `json:"month"`
	Km     float64 `json:"km"`
	Amount float64 `json:"amount"`
}

type vehicleTotal struct {
	VehicleID int64   `json:"vehicleId"`
	Label     string  `json:"label"`
	Type      string  `json:"type"`
	Km        float64 `json:"km"`
	Amount    float64 `json:"amount"`
}

type summaryResponse struct {
	Year        int            `json:"year"`
	Provisional bool           `json:"provisional"`
	TotalKm     float64        `json:"totalKm"`
	TotalAmount float64        `json:"totalAmount"`
	ByMonth     []monthTotal   `json:"byMonth"`
	ByVehicle   []vehicleTotal `json:"byVehicle"`
}

func (h *Handler) summary(w http.ResponseWriter, r *http.Request) {
	userID, _ := auth.UserID(r)
	year, ok := httpx.QueryYear(w, r)
	if !ok {
		return
	}

	// SQLite does the per-(month, vehicle) km sums; Go applies the rate per
	// vehicle type in integer cents so totals add up exactly.
	from, to := httpx.YearRange(year)
	sums, err := h.reads.SumKmByMonthVehicle(r.Context(), database.SumKmByMonthVehicleParams{
		UserID: userID, FromDate: from, ToDate: to,
	})
	if err != nil {
		httpx.Internal(w, r, err)
		return
	}
	vehicles, err := h.reads.ListVehiclesByUser(r.Context(), userID)
	if err != nil {
		httpx.Internal(w, r, err)
		return
	}

	rt := h.rates.For(year)
	byVehicleIdx := make(map[int64]int, len(vehicles))
	byVehicle := make([]vehicleTotal, 0, len(vehicles))
	vehicleCents := make([]int64, 0, len(vehicles))
	for _, v := range vehicles {
		byVehicleIdx[v.ID] = len(byVehicle)
		byVehicle = append(byVehicle, vehicleTotal{VehicleID: v.ID, Label: v.Label, Type: v.Type})
		vehicleCents = append(vehicleCents, 0)
	}

	var monthCents [12]int64
	var monthKm [12]float64
	var totalCents int64
	var totalKm float64
	for _, s := range sums {
		i, ok := byVehicleIdx[s.VehicleID]
		if !ok || s.Month < 1 || s.Month > 12 {
			continue
		}
		cents := rt.AmountCents(byVehicle[i].Type, s.Km)
		monthKm[s.Month-1] += s.Km
		monthCents[s.Month-1] += cents
		byVehicle[i].Km += s.Km
		vehicleCents[i] += cents
		totalKm += s.Km
		totalCents += cents
	}

	byMonth := make([]monthTotal, 12)
	for m := range byMonth {
		byMonth[m] = monthTotal{Month: m + 1, Km: monthKm[m], Amount: rates.Euros(monthCents[m])}
	}
	for i := range byVehicle {
		byVehicle[i].Amount = rates.Euros(vehicleCents[i])
	}

	httpx.WriteJSON(w, http.StatusOK, summaryResponse{
		Year:        year,
		Provisional: rt.Provisional,
		TotalKm:     totalKm,
		TotalAmount: rates.Euros(totalCents),
		ByMonth:     byMonth,
		ByVehicle:   byVehicle,
	})
}
