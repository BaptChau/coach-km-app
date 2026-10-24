package report

import (
	"encoding/csv"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/BaptChau/coach-km-app/api/internal/auth"
	"github.com/BaptChau/coach-km-app/api/internal/database"
	"github.com/BaptChau/coach-km-app/api/internal/httpx"
	"github.com/BaptChau/coach-km-app/api/internal/rates"
	"github.com/go-pdf/fpdf"
)

// maxExportTrips bounds how many rows one export loads into memory.
const maxExportTrips = 10_000

type exportLine struct {
	trip        database.Trip
	vehicle     database.Vehicle
	billedKm    float64
	rate        float64
	amountCents int64
}

type exportData struct {
	year        int
	provisional bool
	coach       database.User
	lines       []exportLine
	totalKm     float64
	totalCents  int64
}

func (h *Handler) export(w http.ResponseWriter, r *http.Request) {
	userID, _ := auth.UserID(r)
	year, ok := httpx.QueryYear(w, r)
	if !ok {
		return
	}
	format := r.URL.Query().Get("format")
	if format == "" {
		format = "csv"
	}
	if format != "csv" && format != "pdf" {
		httpx.Error(w, http.StatusBadRequest, `format must be "csv" or "pdf"`)
		return
	}

	data, err := h.load(r, userID, year)
	if err != nil {
		httpx.Internal(w, r, err)
		return
	}

	filename := fmt.Sprintf("recapitulatif-km-%d.%s", year, format)
	w.Header().Set("Content-Disposition", `attachment; filename="`+filename+`"`)
	w.Header().Set("Cache-Control", "no-store")

	if format == "csv" {
		w.Header().Set("Content-Type", "text/csv; charset=utf-8")
		writeCSV(w, data)
		return
	}
	w.Header().Set("Content-Type", "application/pdf")
	if err := writePDF(w, data); err != nil {
		// Headers may be sent already; all we can do is log.
		httpx.Internal(w, r, err)
	}
}

func (h *Handler) load(r *http.Request, userID int64, year int) (exportData, error) {
	ctx := r.Context()
	coach, err := h.reads.GetUserByID(ctx, userID)
	if err != nil {
		return exportData{}, err
	}
	vehicles, err := h.reads.ListVehiclesByUser(ctx, userID)
	if err != nil {
		return exportData{}, err
	}
	from, to := httpx.YearRange(year)
	trips, err := h.reads.ListTripsByUserYear(ctx, database.ListTripsByUserYearParams{
		UserID: userID, FromDate: from, ToDate: to, Lim: maxExportTrips, Off: 0,
	})
	if err != nil {
		return exportData{}, err
	}

	byID := make(map[int64]database.Vehicle, len(vehicles))
	for _, v := range vehicles {
		byID[v.ID] = v
	}
	rt := h.rates.For(year)
	d := exportData{year: year, provisional: rt.Provisional, coach: coach, lines: make([]exportLine, len(trips))}
	// Chronological order reads better on a récapitulatif.
	for i, t := range trips {
		v := byID[t.VehicleID]
		billed := rates.BilledKm(t.DistanceKm, t.RoundTrip)
		cents := rt.AmountCents(v.Type, billed)
		d.lines[len(trips)-1-i] = exportLine{
			trip: t, vehicle: v, billedKm: billed, rate: rt.EurPerKm(v.Type), amountCents: cents,
		}
		d.totalKm += billed
		d.totalCents += cents
	}
	return d, nil
}

// French number formatting: comma decimal separator.
func frNum(f float64, decimals int) string {
	return strings.Replace(strconv.FormatFloat(f, 'f', decimals, 64), ".", ",", 1)
}

func vehicleTypeLabel(t string) string {
	if t == rates.TwoWheeler {
		return "Deux-roues"
	}
	return "Voiture"
}

func yesNo(b bool) string {
	if b {
		return "oui"
	}
	return "non"
}

// writeCSV streams rows straight to the response. Semicolons, comma decimals
// and a UTF-8 BOM make it open cleanly in a French Excel.
func writeCSV(w http.ResponseWriter, d exportData) {
	w.Write([]byte("\xef\xbb\xbf"))
	cw := csv.NewWriter(w)
	cw.Comma = ';'
	cw.Write([]string{"Date", "Départ", "Arrivée", "Motif", "Véhicule", "Type", "Distance (km)", "Aller-retour", "Km retenus", "Barème (€/km)", "Montant (€)"})
	for _, l := range d.lines {
		cw.Write([]string{
			l.trip.Date, l.trip.Origin, l.trip.Destination, l.trip.Purpose,
			l.vehicle.Label, vehicleTypeLabel(l.vehicle.Type),
			frNum(l.trip.DistanceKm, 1), yesNo(l.trip.RoundTrip),
			frNum(l.billedKm, 1), frNum(l.rate, 3), frNum(rates.Euros(l.amountCents), 2),
		})
	}
	cw.Write([]string{"Total", "", "", "", "", "", "", "", frNum(d.totalKm, 1), "", frNum(rates.Euros(d.totalCents), 2)})
	cw.Flush()
}

func writePDF(w http.ResponseWriter, d exportData) error {
	pdf := fpdf.New("L", "mm", "A4", "")
	tr := pdf.UnicodeTranslatorFromDescriptor("") // UTF-8 -> cp1252 for accents
	pdf.SetMargins(12, 12, 12)
	pdf.SetAutoPageBreak(true, 12)
	pdf.AddPage()

	pdf.SetFont("Helvetica", "B", 16)
	pdf.CellFormat(0, 9, tr(fmt.Sprintf("Récapitulatif des frais kilométriques %d", d.year)), "", 1, "L", false, 0, "")
	pdf.SetFont("Helvetica", "", 10)
	pdf.CellFormat(0, 6, tr(fmt.Sprintf("Bénévole : %s %s  -  N° de licence : %s  -  %s",
		d.coach.FirstName, d.coach.LastName, d.coach.RegistrationNumber, d.coach.Email)), "", 1, "L", false, 0, "")
	note := fmt.Sprintf("Barème kilométrique bénévoles %d.", d.year)
	if d.provisional {
		note = fmt.Sprintf("Barème %d non encore publié : barème de l'année précédente appliqué (provisoire).", d.year)
	}
	pdf.CellFormat(0, 6, tr(note+" Édité le "+time.Now().Format("02/01/2006")+"."), "", 1, "L", false, 0, "")
	pdf.Ln(3)

	cols := []struct {
		title string
		width float64
		align string
	}{
		{"Date", 22, "L"}, {"Départ", 40, "L"}, {"Arrivée", 40, "L"}, {"Motif", 58, "L"},
		{"Véhicule", 35, "L"}, {"Km", 16, "R"}, {"A/R", 12, "C"}, {"Km retenus", 20, "R"},
		{"€/km", 14, "R"}, {"Montant", 16, "R"},
	}
	header := func() {
		pdf.SetFont("Helvetica", "B", 9)
		pdf.SetFillColor(230, 230, 230)
		for _, c := range cols {
			pdf.CellFormat(c.width, 7, tr(c.title), "1", 0, "C", true, 0, "")
		}
		pdf.Ln(-1)
		pdf.SetFont("Helvetica", "", 8)
	}
	header()

	clip := func(s string, width float64) string {
		s = tr(s)
		for pdf.GetStringWidth(s) > width-2 && len(s) > 1 {
			s = s[:len(s)-1]
		}
		return s
	}
	for _, l := range d.lines {
		if pdf.GetY() > 185 {
			pdf.AddPage()
			header()
		}
		date, _ := time.Parse(time.DateOnly, l.trip.Date)
		cells := []string{
			date.Format("02/01/2006"), l.trip.Origin, l.trip.Destination, l.trip.Purpose,
			l.vehicle.Label, frNum(l.trip.DistanceKm, 1), yesNo(l.trip.RoundTrip),
			frNum(l.billedKm, 1), frNum(l.rate, 3), frNum(rates.Euros(l.amountCents), 2),
		}
		for i, c := range cols {
			pdf.CellFormat(c.width, 6, clip(cells[i], c.width), "1", 0, c.align, false, 0, "")
		}
		pdf.Ln(-1)
	}

	pdf.SetFont("Helvetica", "B", 9)
	pdf.CellFormat(22+40+40+58+35+16+12, 7, "Total", "1", 0, "R", false, 0, "")
	pdf.CellFormat(20, 7, frNum(d.totalKm, 1), "1", 0, "R", false, 0, "")
	pdf.CellFormat(14, 7, "", "1", 0, "R", false, 0, "")
	pdf.CellFormat(16, 7, tr(frNum(rates.Euros(d.totalCents), 2)+" €"), "1", 1, "R", false, 0, "")

	return pdf.Output(w)
}
