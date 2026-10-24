package rates

import "testing"

func TestAmountCents(t *testing.T) {
	b := For(2024)
	cases := []struct {
		name string
		v    Vehicle
		km   float64
		want int64
	}{
		{"car 5CV first tier", Vehicle{Type: Car, HP: 5}, 1000, 63600},              // 1000 × 0.636
		{"car 5CV tier edge", Vehicle{Type: Car, HP: 5}, 5000, 318000},              // 5000 × 0.636
		{"car 5CV second tier", Vehicle{Type: Car, HP: 5}, 10000, 496500},           // 10000 × 0.357 + 1395
		{"car 7CV+ third tier", Vehicle{Type: Car, HP: 11}, 25000, 1175000},         // 25000 × 0.470
		{"car 2CV uses ≤3CV row", Vehicle{Type: Car, HP: 2}, 100, 5290},             // 100 × 0.529
		{"car electric +20%", Vehicle{Type: Car, HP: 4, Electric: true}, 100, 7272}, // 100 × 0.606 × 1.2
		{"motorcycle 1-2CV", Vehicle{Type: Motorcycle, HP: 1}, 2000, 79000},         // 2000 × 0.395
		{"motorcycle 3-5CV mid", Vehicle{Type: Motorcycle, HP: 4}, 4000, 148600},    // 4000 × 0.082 + 1158
		{"motorcycle >5CV", Vehicle{Type: Motorcycle, HP: 8}, 7000, 240100},         // 7000 × 0.343
		{"moped", Vehicle{Type: Moped}, 3500, 98750},                                // 3500 × 0.079 + 711
		{"no km", Vehicle{Type: Car, HP: 5}, 0, 0},
	}
	for _, c := range cases {
		if got := b.AmountCents(c.v, c.km); got != c.want {
			t.Errorf("%s: got %d, want %d", c.name, got, c.want)
		}
	}
}

func TestForFallsBackToLatestVersion(t *testing.T) {
	if For(2026).FromYear != 2022 || For(2010).FromYear != 2022 {
		t.Error("expected the 2022 version for every year until a new arrêté")
	}
}

func TestSplitAddsUp(t *testing.T) {
	got := Split(100, []float64{1, 1, 1})
	if got[0]+got[1]+got[2] != 100 {
		t.Errorf("parts %v don't add up to 100", got)
	}
	if got := Split(0, []float64{1, 2}); got[0] != 0 || got[1] != 0 {
		t.Errorf("zero total: %v", got)
	}
}
