// Package report serves the yearly views built on trips: the barème, the
// dashboard summary, and the récapitulatif export.
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
}

func NewHandler(db *database.DB) *Handler {
	return &Handler{reads: database.New(db.Read)}
}

func (h *Handler) Register(mux *http.ServeMux, jwtSecret string) {
	mux.HandleFunc("GET /rates", h.getRates)
	mux.HandleFunc("GET /summary", auth.RequireAuth(jwtSecret, h.summary))
	mux.HandleFunc("GET /export", auth.RequireAuth(jwtSecret, h.export))
}

type ratesResponse struct {
	Year int `json:"year"`
	rates.Bareme
}

func (h *Handler) getRates(w http.ResponseWriter, r *http.Request) {
	year, ok := httpx.QueryYear(w, r)
	if !ok {
		return
	}
	// Public and changes at most yearly: let browsers and the PWA cache it.
	w.Header().Set("Cache-Control", "public, max-age=3600")
	httpx.WriteJSON(w, http.StatusOK, ratesResponse{Year: year, Bareme: rates.For(year)})
}

type monthTotal struct {
	Month  int     `json:"month"`
	Km     float64 `json:"km"`
	Amount float64 `json:"amount"`
}

type vehicleTotal struct {
	VehicleID        int64   `json:"vehicleId"`
	Label            string  `json:"label"`
	Type             string  `json:"type"`
	FiscalHorsepower *int64  `json:"fiscalHorsepower"`
	Electric         bool    `json:"electric"`
	Km               float64 `json:"km"`
	Amount           float64 `json:"amount"`
}

type summaryResponse struct {
	Year         int            `json:"year"`
	BaremeSource string         `json:"baremeSource"`
	TotalKm      float64        `json:"totalKm"`
	TotalAmount  float64        `json:"totalAmount"`
	ByMonth      []monthTotal   `json:"byMonth"`
	ByVehicle    []vehicleTotal `json:"byVehicle"`
}

func (h *Handler) summary(w http.ResponseWriter, r *http.Request) {
	userID, _ := auth.UserID(r)
	year, ok := httpx.QueryYear(w, r)
	if !ok {
		return
	}
	val, err := Value(r.Context(), h.reads, userID, year)
	if err != nil {
		httpx.Internal(w, r, err)
		return
	}

	out := summaryResponse{
		Year:         year,
		BaremeSource: val.Bareme.Source,
		TotalKm:      val.TotalKm,
		TotalAmount:  rates.Euros(val.TotalCents),
		ByMonth:      make([]monthTotal, 12),
		ByVehicle:    make([]vehicleTotal, len(val.Vehicles)),
	}
	for m := range 12 {
		out.ByMonth[m] = monthTotal{Month: m + 1, Km: val.ByMonthKm[m], Amount: rates.Euros(val.ByMonthCents[m])}
	}
	for i, vt := range val.Vehicles {
		out.ByVehicle[i] = vehicleTotal{
			VehicleID: vt.Vehicle.ID, Label: vt.Vehicle.Label, Type: vt.Vehicle.Type,
			FiscalHorsepower: vt.Vehicle.FiscalHp, Electric: vt.Vehicle.Electric,
			Km: vt.Km, Amount: rates.Euros(vt.Cents),
		}
	}
	httpx.WriteJSON(w, http.StatusOK, out)
}
