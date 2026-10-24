package receipts

import "testing"

func TestSpell(t *testing.T) {
	cases := map[int64]string{
		0: "zéro", 1: "un", 16: "seize", 17: "dix-sept", 21: "vingt et un", 22: "vingt-deux",
		61: "soixante et un", 70: "soixante-dix", 71: "soixante et onze", 77: "soixante-dix-sept",
		80: "quatre-vingts", 81: "quatre-vingt-un", 90: "quatre-vingt-dix", 91: "quatre-vingt-onze",
		99: "quatre-vingt-dix-neuf", 100: "cent", 101: "cent un", 200: "deux cents", 280: "deux cent quatre-vingts",
		1000: "mille", 1001: "mille un", 2000: "deux mille", 80000: "quatre-vingt mille",
		200000: "deux cent mille", 1234: "mille deux cent trente-quatre",
		1_000_000: "un million", 2_300_000: "deux millions trois cent mille",
	}
	for n, want := range cases {
		if got := spell(n); got != want {
			t.Errorf("spell(%d) = %q, want %q", n, got, want)
		}
	}
}

func TestAmountInWords(t *testing.T) {
	cases := map[int64]string{
		100:    "un euro",
		31840:  "trois cent dix-huit euros et quarante centimes",
		496500: "quatre mille neuf cent soixante-cinq euros",
		201:    "deux euros et un centime",
	}
	for c, want := range cases {
		if got := AmountInWords(c); got != want {
			t.Errorf("AmountInWords(%d) = %q, want %q", c, got, want)
		}
	}
}
