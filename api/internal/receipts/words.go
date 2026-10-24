package receipts

import "strings"

var units = [...]string{
	"zéro", "un", "deux", "trois", "quatre", "cinq", "six", "sept", "huit", "neuf",
	"dix", "onze", "douze", "treize", "quatorze", "quinze", "seize",
}

var tens = [...]string{2: "vingt", 3: "trente", 4: "quarante", 5: "cinquante", 6: "soixante"}

func below100(n int) string {
	switch {
	case n < 17:
		return units[n]
	case n < 20:
		return "dix-" + units[n-10]
	case n < 70:
		t, u := n/10, n%10
		switch u {
		case 0:
			return tens[t]
		case 1:
			return tens[t] + " et un"
		}
		return tens[t] + "-" + units[u]
	case n == 71:
		return "soixante et onze"
	case n < 80:
		return "soixante-" + below100(n-60)
	case n == 80:
		return "quatre-vingts"
	}
	return "quatre-vingt-" + below100(n-80)
}

// below1000 spells 1..999. plural=false drops the agreement "s" of
// "cents"/"quatre-vingts" when "mille" follows ("deux cent mille").
func below1000(n int, plural bool) string {
	h, r := n/100, n%100
	var s string
	switch {
	case h == 0:
		s = below100(r)
	case h == 1:
		s = "cent"
		if r > 0 {
			s += " " + below100(r)
		}
	default:
		s = units[h] + " cent"
		if r > 0 {
			s += " " + below100(r)
		} else if plural {
			s += "s"
		}
	}
	if !plural && strings.HasSuffix(s, "quatre-vingts") {
		s = strings.TrimSuffix(s, "s")
	}
	return s
}

// spell writes a non-negative integer in French words (traditional spelling).
func spell(n int64) string {
	if n == 0 {
		return units[0]
	}
	var parts []string
	if m := n / 1_000_000; m > 0 {
		if m == 1 {
			parts = append(parts, "un million")
		} else {
			parts = append(parts, spell(m)+" millions")
		}
	}
	if k := int(n / 1000 % 1000); k > 0 {
		if k == 1 {
			parts = append(parts, "mille")
		} else {
			parts = append(parts, below1000(k, false)+" mille")
		}
	}
	if r := int(n % 1000); r > 0 {
		parts = append(parts, below1000(r, true))
	}
	return strings.Join(parts, " ")
}

// AmountInWords spells an amount in cents, as a Cerfa receipt requires:
// "trois cent dix-huit euros et quarante centimes".
func AmountInWords(cents int64) string {
	eur, ct := cents/100, cents%100
	s := spell(eur) + " euro"
	if eur > 1 {
		s += "s"
	}
	if ct > 0 {
		s += " et " + spell(ct) + " centime"
		if ct > 1 {
			s += "s"
		}
	}
	return s
}
