package report

import (
	"context"

	"github.com/BaptChau/coach-km-app/api/internal/database"
	"github.com/BaptChau/coach-km-app/api/internal/httpx"
	"github.com/BaptChau/coach-km-app/api/internal/rates"
)

// VehicleTotal is one vehicle's distance and value over a year.
type VehicleTotal struct {
	Vehicle database.Vehicle
	Km      float64
	Cents   int64
	monthKm [12]float64
}

// Valuation is what a coach's mileage is worth for one year.
type Valuation struct {
	Year         int
	Bareme       rates.Bareme
	Vehicles     []VehicleTotal
	ByMonthKm    [12]float64
	ByMonthCents [12]int64
	TotalKm      float64
	TotalCents   int64
}

// MonthKm is one (month, vehicle) distance sum, as SQLite returns it.
type MonthKm struct {
	Month     int
	VehicleID int64
	Km        float64
}

func RatesVehicle(v database.Vehicle) rates.Vehicle {
	rv := rates.Vehicle{Type: v.Type, Electric: v.Electric}
	if v.FiscalHp != nil {
		rv.HP = int(*v.FiscalHp)
	}
	return rv
}

// Compute values a year from per-(month, vehicle) km sums. The barème is
// tiered on each vehicle's yearly distance, so each vehicle is valued once
// on its total; that amount is then spread over months pro rata to km.
func Compute(year int, vehicles []database.Vehicle, sums []MonthKm) Valuation {
	val := Valuation{Year: year, Bareme: rates.For(year), Vehicles: make([]VehicleTotal, len(vehicles))}
	idx := make(map[int64]int, len(vehicles))
	for i, v := range vehicles {
		idx[v.ID] = i
		val.Vehicles[i].Vehicle = v
	}
	for _, s := range sums {
		i, ok := idx[s.VehicleID]
		if !ok || s.Month < 1 || s.Month > 12 {
			continue
		}
		val.Vehicles[i].Km += s.Km
		val.Vehicles[i].monthKm[s.Month-1] += s.Km
	}
	for i := range val.Vehicles {
		vt := &val.Vehicles[i]
		vt.Cents = val.Bareme.AmountCents(RatesVehicle(vt.Vehicle), vt.Km)
		parts := rates.Split(vt.Cents, vt.monthKm[:])
		for m := range 12 {
			val.ByMonthKm[m] += vt.monthKm[m]
			val.ByMonthCents[m] += parts[m]
		}
		val.TotalKm += vt.Km
		val.TotalCents += vt.Cents
	}
	return val
}

// Value loads and values one coach's year. q may be a read or a write (tx)
// handle, so a waiver can value the year inside its own transaction.
func Value(ctx context.Context, q *database.Queries, userID int64, year int) (Valuation, error) {
	vehicles, err := q.ListVehiclesByUser(ctx, userID)
	if err != nil {
		return Valuation{}, err
	}
	from, to := httpx.YearRange(year)
	rows, err := q.SumKmByMonthVehicle(ctx, database.SumKmByMonthVehicleParams{
		UserID: userID, FromDate: from, ToDate: to,
	})
	if err != nil {
		return Valuation{}, err
	}
	sums := make([]MonthKm, len(rows))
	for i, r := range rows {
		sums[i] = MonthKm{Month: int(r.Month), VehicleID: r.VehicleID, Km: r.Km}
	}
	return Compute(year, vehicles, sums), nil
}
