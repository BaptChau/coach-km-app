// Package rates holds the barème kilométrique bénévoles and the money maths
// built on it.
package rates

import (
	"context"
	"errors"
	"math"
	"sort"

	"github.com/BaptChau/coach-km-app/api/internal/database"
)

const (
	Car        = "car"
	TwoWheeler = "two_wheeler"
)

func ValidVehicleType(t string) bool { return t == Car || t == TwoWheeler }

// Rates is the €/km per vehicle type applying to a year.
type Rates struct {
	Year int
	// Provisional is true when the year has no published barème yet and the
	// latest earlier year's rates are used instead.
	Provisional bool
	milli       map[string]int64
}

// EurPerKm returns the rate for a vehicle type, e.g. 0.331.
func (r Rates) EurPerKm(vehicleType string) float64 {
	return float64(r.milli[vehicleType]) / 1000
}

// AmountCents is what km driven with vehicleType is worth, rounded to the
// cent. Integer cents keep sums exact.
func (r Rates) AmountCents(vehicleType string, km float64) int64 {
	return int64(math.Round(km * float64(r.milli[vehicleType]) / 10))
}

// Table is every known year's rates, loaded once at startup. Rates change
// once a year, so the table is read-only afterwards and safe for concurrent
// use without locks; restart the server after adding a year.
type Table struct {
	years  []int // ascending
	byYear map[int]map[string]int64
}

func Load(ctx context.Context, q *database.Queries) (*Table, error) {
	rows, err := q.ListRates(ctx)
	if err != nil {
		return nil, err
	}
	t := &Table{byYear: map[int]map[string]int64{}}
	for _, r := range rows {
		y := int(r.Year)
		if t.byYear[y] == nil {
			t.byYear[y] = map[string]int64{}
			t.years = append(t.years, y)
		}
		t.byYear[y][r.VehicleType] = r.MilliEurPerKm
	}
	if len(t.years) == 0 {
		return nil, errors.New("rates table is empty")
	}
	sort.Ints(t.years)
	return t, nil
}

func (t *Table) For(year int) Rates {
	// Latest year <= requested; before the first known year, use the first.
	i := sort.SearchInts(t.years, year+1) - 1
	if i < 0 {
		i = 0
	}
	y := t.years[i]
	return Rates{Year: year, Provisional: y != year, milli: t.byYear[y]}
}

// BilledKm is the distance that counts: doubled for a round trip.
func BilledKm(distanceKm float64, roundTrip bool) float64 {
	if roundTrip {
		return distanceKm * 2
	}
	return distanceKm
}

// Euros converts cents for JSON output.
func Euros(cents int64) float64 { return float64(cents) / 100 }
