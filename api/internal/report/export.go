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

type exportData struct {
	coach    database.User
	trips    []database.Trip // chronological
	vehicles map[int64]database.Vehicle
	val      Valuation
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

	d, err := h.load(r, userID, year)
	if err != nil {
		httpx.Internal(w, r, err)
		return
	}

	filename := fmt.Sprintf("recapitulatif-km-%d.%s", year, format)
	w.Header().Set("Content-Disposition", `attachment; filename="`+filename+`"`)
	w.Header().Set("Cache-Control", "no-store")

	if format == "csv" {
		w.Header().Set("Content-Type", "text/csv; charset=utf-8")
		writeCSV(w, d)
		return
	}
	pdf := writePDF(d)
	w.Header().Set("Content-Type", "application/pdf")
	if err := pdf.Output(w); err != nil {
		httpx.Internal(w, r, err)
	}
}

func (h *Handler) load(r *http.Request, userID int64, year int) (exportData, error) {
	ctx := r.Context()
	coach, err := h.reads.GetUserByID(ctx, userID)
	if err != nil {
		return exportData{}, err
	}
	val, err := Value(ctx, h.reads, userID, year)
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
	// The query is newest first; a récapitulatif reads better in date order.
	for i, j := 0, len(trips)-1; i < j; i, j = i+1, j-1 {
		trips[i], trips[j] = trips[j], trips[i]
	}
	d := exportData{coach: coach, trips: trips, val: val, vehicles: map[int64]database.Vehicle{}}
	for _, vt := range val.Vehicles {
		d.vehicles[vt.Vehicle.ID] = vt.Vehicle
	}
	return d, nil
}

// FrNum formats with a comma decimal separator.
func FrNum(f float64, decimals int) string {
	return strings.Replace(strconv.FormatFloat(f, 'f', decimals, 64), ".", ",", 1)
}

// FrEuros formats cents as "1 234,56".
func FrEuros(cents int64) string {
	s := FrNum(rates.Euros(cents), 2)
	intPart, dec, _ := strings.Cut(s, ",")
	var b strings.Builder
	for i, c := range intPart {
		if i > 0 && (len(intPart)-i)%3 == 0 {
			b.WriteRune(' ')
		}
		b.WriteRune(c)
	}
	return b.String() + "," + dec
}

// VehicleDesc describes a vehicle the way the barème classifies it.
func VehicleDesc(v database.Vehicle) string {
	s := map[string]string{rates.Car: "Voiture", rates.Motorcycle: "Moto", rates.Moped: "Cyclomoteur"}[v.Type]
	if v.FiscalHp != nil {
		s += fmt.Sprintf(" %d CV", *v.FiscalHp)
	}
	if v.Electric {
		s += " électrique"
	}
	return s
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
	cw.Write([]string{"Date", "Départ", "Arrivée", "Motif", "Véhicule", "Distance (km)", "Aller-retour", "Km retenus"})
	for _, t := range d.trips {
		cw.Write([]string{
			t.Date, t.Origin, t.Destination, t.Purpose, d.vehicles[t.VehicleID].Label,
			FrNum(t.DistanceKm, 1), yesNo(t.RoundTrip), FrNum(rates.BilledKm(t.DistanceKm, t.RoundTrip), 1),
		})
	}
	cw.Write(nil)
	cw.Write([]string{"Véhicule", "Catégorie", "Km annuels", "Montant (€)"})
	for _, vt := range d.val.Vehicles {
		if vt.Km > 0 {
			cw.Write([]string{vt.Vehicle.Label, VehicleDesc(vt.Vehicle), FrNum(vt.Km, 1), FrNum(rates.Euros(vt.Cents), 2)})
		}
	}
	cw.Write([]string{"Total", "", FrNum(d.val.TotalKm, 1), FrNum(rates.Euros(d.val.TotalCents), 2)})
	cw.Write([]string{"Barème", d.val.Bareme.Source})
	cw.Flush()
}

func writePDF(d exportData) *fpdf.Fpdf {
	pdf := fpdf.New("L", "mm", "A4", "")
	tr := pdf.UnicodeTranslatorFromDescriptor("") // UTF-8 -> cp1252 for accents
	pdf.SetMargins(12, 12, 12)
	pdf.SetAutoPageBreak(true, 12)
	pdf.AddPage()

	pdf.SetFont("Helvetica", "B", 16)
	pdf.CellFormat(0, 9, tr(fmt.Sprintf("Récapitulatif des frais kilométriques %d", d.val.Year)), "", 1, "L", false, 0, "")
	pdf.SetFont("Helvetica", "", 10)
	pdf.CellFormat(0, 6, tr(fmt.Sprintf("Bénévole : %s %s  -  N° de licence : %s  -  %s",
		d.coach.FirstName, d.coach.LastName, d.coach.RegistrationNumber, d.coach.Email)), "", 1, "L", false, 0, "")
	pdf.CellFormat(0, 6, tr("Barème : "+d.val.Bareme.Source+". Édité le "+time.Now().Format("02/01/2006")+"."), "", 1, "L", false, 0, "")
	pdf.Ln(3)

	type col struct {
		title string
		width float64
		align string
	}
	table := func(cols []col, rows [][]string) {
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
		for _, row := range rows {
			if pdf.GetY() > 185 {
				pdf.AddPage()
				header()
			}
			for i, c := range cols {
				s := tr(row[i])
				for pdf.GetStringWidth(s) > c.width-2 && len(s) > 1 {
					s = s[:len(s)-1]
				}
				pdf.CellFormat(c.width, 6, s, "1", 0, c.align, false, 0, "")
			}
			pdf.Ln(-1)
		}
	}

	rows := make([][]string, len(d.trips))
	for i, t := range d.trips {
		date, _ := time.Parse(time.DateOnly, t.Date)
		rows[i] = []string{
			date.Format("02/01/2006"), t.Origin, t.Destination, t.Purpose, d.vehicles[t.VehicleID].Label,
			FrNum(t.DistanceKm, 1), yesNo(t.RoundTrip), FrNum(rates.BilledKm(t.DistanceKm, t.RoundTrip), 1),
		}
	}
	table([]col{
		{"Date", 22, "L"}, {"Départ", 45, "L"}, {"Arrivée", 45, "L"}, {"Motif", 70, "L"},
		{"Véhicule", 40, "L"}, {"Km", 18, "R"}, {"A/R", 12, "C"}, {"Km retenus", 21, "R"},
	}, rows)

	pdf.Ln(5)
	rows = rows[:0]
	for _, vt := range d.val.Vehicles {
		if vt.Km > 0 {
			rows = append(rows, []string{vt.Vehicle.Label, VehicleDesc(vt.Vehicle), FrNum(vt.Km, 1), FrEuros(vt.Cents) + " €"})
		}
	}
	rows = append(rows, []string{"Total", "", FrNum(d.val.TotalKm, 1), FrEuros(d.val.TotalCents) + " €"})
	table([]col{{"Véhicule", 60, "L"}, {"Catégorie (barème)", 70, "L"}, {"Km annuels", 30, "R"}, {"Montant", 35, "R"}}, rows)
	return pdf
}
