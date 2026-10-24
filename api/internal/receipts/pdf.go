package receipts

import (
	"fmt"
	"strings"

	"github.com/BaptChau/coach-km-app/api/internal/config"
	"github.com/BaptChau/coach-km-app/api/internal/database"
	"github.com/BaptChau/coach-km-app/api/internal/rates"
	"github.com/BaptChau/coach-km-app/api/internal/report"
	"github.com/go-pdf/fpdf"
)

// buildReceiptPDF lays out a "Reçu au titre des dons à certains organismes
// d'intérêt général" following the sections and mentions of model Cerfa
// n° 11580*05, for a donation made by abandoning reimbursement of mileage.
func buildReceiptPDF(a config.Association, rc database.TaxReceipt, wv database.Waiver, coach, issuer database.User) *fpdf.Fpdf {
	pdf := fpdf.New("P", "mm", "A4", "")
	tr := pdf.UnicodeTranslatorFromDescriptor("")
	pdf.SetMargins(18, 15, 18)
	pdf.SetAutoPageBreak(false, 0)
	pdf.AddPage()
	width, _ := pdf.GetPageSize()
	inner := width - 36

	text := func(style string, size float64, h float64, s string) {
		pdf.SetFont("Helvetica", style, size)
		pdf.MultiCell(inner, h, tr(s), "", "L", false)
	}
	section := func(title string) {
		pdf.Ln(3)
		pdf.SetFont("Helvetica", "B", 11)
		pdf.SetFillColor(225, 225, 225)
		pdf.CellFormat(inner, 7, tr(title), "1", 1, "C", true, 0, "")
		pdf.Ln(1)
	}
	field := func(label, value string) {
		pdf.SetFont("Helvetica", "", 9)
		pdf.CellFormat(55, 5.5, tr(label), "", 0, "L", false, 0, "")
		pdf.SetFont("Helvetica", "B", 9)
		pdf.MultiCell(inner-55, 5.5, tr(value), "", "L", false)
	}
	checkbox := func(checked bool, label string) {
		x, y := pdf.GetX(), pdf.GetY()
		pdf.Rect(x, y+1, 3.5, 3.5, "D")
		if checked {
			pdf.SetFont("Helvetica", "B", 9)
			pdf.Text(x+0.6, y+4, "X")
		}
		pdf.SetX(x + 5)
		pdf.SetFont("Helvetica", "", 9)
		w := pdf.GetStringWidth(tr(label)) + 8
		pdf.CellFormat(w, 5.5, tr(label), "", 0, "L", false, 0, "")
	}

	pdf.SetFont("Helvetica", "", 8)
	pdf.CellFormat(inner, 4, tr("Cerfa n° 11580*05"), "", 1, "R", false, 0, "")
	pdf.SetFont("Helvetica", "B", 14)
	pdf.MultiCell(inner, 7, tr("Reçu au titre des dons à certains organismes d'intérêt général"), "", "C", false)
	pdf.SetFont("Helvetica", "", 9)
	pdf.CellFormat(inner, 5, tr("Articles 200, 238 bis et 978 du code général des impôts (CGI)"), "", 1, "C", false, 0, "")
	pdf.Ln(2)
	pdf.SetFont("Helvetica", "B", 10)
	pdf.CellFormat(inner, 6, tr("Numéro d'ordre du reçu : "+receiptNumber(rc)), "", 1, "R", false, 0, "")

	section("Bénéficiaire des versements")
	field("Nom ou dénomination :", a.Name)
	field("Adresse :", fmt.Sprintf("%s, %s %s", a.Address, a.PostalCode, a.City))
	field("Objet :", a.Object)
	var ids []string
	if a.RNA != "" {
		ids = append(ids, "RNA "+a.RNA)
	}
	if a.SIREN != "" {
		ids = append(ids, "SIREN "+a.SIREN[:3]+" "+a.SIREN[3:6]+" "+a.SIREN[6:])
	}
	if len(ids) > 0 {
		field("N° RNA / SIREN :", strings.Join(ids, "  -  "))
	}
	field("Qualité de l'organisme :", a.Status)

	section("Donateur")
	field("Nom :", strings.ToUpper(coach.LastName))
	field("Prénoms :", coach.FirstName)
	field("Adresse :", coach.AddressLine)
	field("Code postal / Commune :", coach.PostalCode+" "+coach.City)

	pdf.Ln(4)
	text("", 9.5, 5, "Le bénéficiaire reconnaît avoir reçu au titre des dons et versements ouvrant droit à réduction d'impôt, la somme de :")
	pdf.SetFont("Helvetica", "B", 13)
	pdf.CellFormat(inner, 9, tr("*** "+report.FrEuros(rc.AmountCents)+" euros ***"), "", 1, "C", false, 0, "")
	field("Somme en toutes lettres :", AmountInWords(rc.AmountCents))
	field("Date du versement ou du don :", wv.WaivedAt.Format("02/01/2006"))

	pdf.Ln(3)
	text("", 9.5, 5, "Le bénéficiaire certifie sur l'honneur que les dons et versements qu'il reçoit ouvrent droit à la réduction d'impôt prévue à l'article :")
	checkbox(true, "200 du CGI")
	checkbox(false, "238 bis du CGI")
	checkbox(false, "978 du CGI")
	pdf.Ln(8)

	pdf.SetFont("Helvetica", "B", 9.5)
	pdf.CellFormat(inner, 6, tr("Forme du don :"), "", 1, "L", false, 0, "")
	checkbox(false, "Acte authentique")
	checkbox(false, "Acte sous seing privé")
	checkbox(false, "Déclaration de don manuel")
	checkbox(true, "Autres")
	pdf.Ln(8)
	pdf.SetFont("Helvetica", "B", 9.5)
	pdf.CellFormat(inner, 6, tr("Nature du don :"), "", 1, "L", false, 0, "")
	checkbox(true, "Numéraire")
	checkbox(false, "Titres de sociétés cotés")
	checkbox(false, "Autres")
	pdf.Ln(9)

	text("I", 9, 4.5, fmt.Sprintf(
		"Don résultant de l'abandon, par le bénévole, du remboursement des frais kilométriques engagés pour l'association en %d "+
			"(%s km), évalués selon le barème kilométrique : %s. Renonciation déclarée par écrit le %s.",
		rc.Year, report.FrNum(wv.Km, 1), rates.For(int(rc.Year)).Source, wv.WaivedAt.Format("02/01/2006")))

	pdf.Ln(8)
	pdf.SetFont("Helvetica", "", 10)
	pdf.CellFormat(inner/2, 6, tr("Date : "+rc.IssuedAt.Format("02/01/2006")), "", 0, "L", false, 0, "")
	pdf.CellFormat(inner/2, 6, tr(fmt.Sprintf("Le président, %s %s", issuer.FirstName, strings.ToUpper(issuer.LastName))), "", 1, "L", false, 0, "")
	pdf.SetX(18 + inner/2)
	pdf.CellFormat(inner/2, 6, tr("Signature :"), "", 1, "L", false, 0, "")
	pdf.Rect(18+inner/2, pdf.GetY(), inner/2, 25, "D")
	return pdf
}
