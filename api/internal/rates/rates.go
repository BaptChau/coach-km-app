// Package rates holds the barème kilométrique that values a volunteer's
// mileage, and the money maths built on it.
//
// Volunteers use the employees' barème (service-public.gouv.fr F1132): it
// depends on the vehicle category and fiscal horsepower, is tiered on the
// distance driven over the whole year, and is raised by 20% for electric
// vehicles. Amounts therefore only exist per vehicle per year.
package rates

import (
	"math"
	"sort"
)

const (
	Car        = "car"
	Motorcycle = "motorcycle"
	Moped      = "moped"
)

func ValidVehicleType(t string) bool { return t == Car || t == Motorcycle || t == Moped }

// NeedsHorsepower reports whether the barème for t depends on fiscal CV.
func NeedsHorsepower(t string) bool { return t != Moped }

// Tier applies to a yearly distance d up to UpToKm (0 = no upper bound):
// amount = d × Coef + Constant.
type Tier struct {
	UpToKm   float64 `json:"upToKm,omitempty"`
	Coef     float64 `json:"coef"`
	Constant float64 `json:"constant"`
}

// Band is one horsepower row of the barème: MinHP..MaxHP inclusive
// (0 = unbounded).
type Band struct {
	MinHP int    `json:"minHp,omitempty"`
	MaxHP int    `json:"maxHp,omitempty"`
	Tiers []Tier `json:"tiers"`
}

// Bareme is one published version of the barème.
type Bareme struct {
	// FromYear is the first income year the version applies to; it stays in
	// force until a later version.
	FromYear         int               `json:"fromYear"`
	Source           string            `json:"source"`
	ElectricIncrease float64           `json:"electricIncrease"`
	ByType           map[string][]Band `json:"byType"`
}

// versions are sorted by FromYear. Add a new arrêté here (and a test).
var versions = []Bareme{
	{
		FromYear:         2022,
		Source:           "Arrêté du 27 mars 2023 (barème des salariés, service-public.gouv.fr F1132, vérifié le 05/11/2024)",
		ElectricIncrease: 0.20,
		ByType: map[string][]Band{
			Car: {
				{MaxHP: 3, Tiers: carTiers(0.529, 0.316, 1065, 0.370)},
				{MinHP: 4, MaxHP: 4, Tiers: carTiers(0.606, 0.340, 1330, 0.407)},
				{MinHP: 5, MaxHP: 5, Tiers: carTiers(0.636, 0.357, 1395, 0.427)},
				{MinHP: 6, MaxHP: 6, Tiers: carTiers(0.665, 0.374, 1457, 0.447)},
				{MinHP: 7, Tiers: carTiers(0.697, 0.394, 1515, 0.470)},
			},
			Motorcycle: {
				{MaxHP: 2, Tiers: twoWheelTiers(0.395, 0.099, 891, 0.248)},
				{MinHP: 3, MaxHP: 5, Tiers: twoWheelTiers(0.468, 0.082, 1158, 0.275)},
				{MinHP: 6, Tiers: twoWheelTiers(0.606, 0.079, 1583, 0.343)},
			},
			Moped: {
				{Tiers: twoWheelTiers(0.315, 0.079, 711, 0.198)},
			},
		},
	},
}

func carTiers(a, b, c, d float64) []Tier {
	return []Tier{{UpToKm: 5000, Coef: a}, {UpToKm: 20000, Coef: b, Constant: c}, {Coef: d}}
}

func twoWheelTiers(a, b, c, d float64) []Tier {
	return []Tier{{UpToKm: 3000, Coef: a}, {UpToKm: 6000, Coef: b, Constant: c}, {Coef: d}}
}

// For returns the version in force for an income year. Years before the
// first known version use the first one.
func For(year int) Bareme {
	i := sort.Search(len(versions), func(i int) bool { return versions[i].FromYear > year }) - 1
	return versions[max(i, 0)]
}

// Vehicle is what the barème needs to know about a vehicle.
type Vehicle struct {
	Type     string
	HP       int
	Electric bool
}

func (b Bareme) band(v Vehicle) (Band, bool) {
	for _, band := range b.ByType[v.Type] {
		if (band.MinHP == 0 || v.HP >= band.MinHP) && (band.MaxHP == 0 || v.HP <= band.MaxHP) {
			return band, true
		}
	}
	return Band{}, false
}

// AmountCents values km driven with v over the whole year, rounded to the
// cent. Integer cents keep sums exact.
func (b Bareme) AmountCents(v Vehicle, km float64) int64 {
	if km <= 0 {
		return 0
	}
	band, ok := b.band(v)
	if !ok {
		return 0
	}
	var t Tier
	for _, t = range band.Tiers {
		if t.UpToKm == 0 || km <= t.UpToKm {
			break
		}
	}
	eur := km*t.Coef + t.Constant
	if v.Electric {
		eur *= 1 + b.ElectricIncrease
	}
	return int64(math.Round(eur * 100))
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

// Split distributes total cents across parts proportionally to weights,
// using the largest remainder so the parts always add up to total exactly.
func Split(total int64, weights []float64) []int64 {
	out := make([]int64, len(weights))
	var sum float64
	for _, w := range weights {
		sum += w
	}
	if sum <= 0 || total == 0 {
		return out
	}
	type rem struct {
		i int
		r float64
	}
	rems := make([]rem, len(weights))
	var given int64
	for i, w := range weights {
		exact := float64(total) * w / sum
		out[i] = int64(math.Floor(exact))
		given += out[i]
		rems[i] = rem{i, exact - float64(out[i])}
	}
	sort.SliceStable(rems, func(a, b int) bool { return rems[a].r > rems[b].r })
	for k := int64(0); k < total-given; k++ {
		out[rems[k].i]++
	}
	return out
}
