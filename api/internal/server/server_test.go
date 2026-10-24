package server

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/BaptChau/coach-km-app/api/internal/config"
	"github.com/BaptChau/coach-km-app/api/internal/database"
	"github.com/BaptChau/coach-km-app/api/internal/external"
)

const secret = "test-secret-123"

func TestMain(m *testing.M) {
	slog.SetDefault(slog.New(slog.DiscardHandler))
	os.Exit(m.Run())
}

var testAssociation = config.Association{
	Name: "US Créteil Basket", Address: "1 rue du Stade", PostalCode: "94000", City: "Créteil",
	Object: "Pratique du basket-ball", Status: "Œuvre ou organisme d'intérêt général", RNA: "W941234567", SIREN: "123456789",
}

func newTestServer(t *testing.T, upstreamURL string) *httptest.Server {
	srv, _ := newTestServerDB(t, upstreamURL, testAssociation)
	return srv
}

func newTestServerDB(t *testing.T, upstreamURL string, assoc config.Association) (*httptest.Server, *database.DB) {
	t.Helper()
	db, err := database.Open(context.Background(), filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })

	srv := httptest.NewServer(New(Deps{
		DB:                 db,
		JWTSecret:          secret,
		RegistrationNumber: regexp.MustCompile(config.DefaultRegistrationNumberPattern),
		Association:        assoc,
		External:           external.NewClient(upstreamURL),
	}))
	t.Cleanup(srv.Close)
	return srv, db
}

type response struct {
	code   int
	body   []byte
	header http.Header
}

func do(t *testing.T, srv *httptest.Server, method, path, token string, body any) response {
	t.Helper()
	var buf bytes.Buffer
	if body != nil {
		json.NewEncoder(&buf).Encode(body)
	}
	req, _ := http.NewRequest(method, srv.URL+path, &buf)
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	resp, err := srv.Client().Do(req)
	if err != nil {
		t.Error(err)
		return response{}
	}
	defer resp.Body.Close()
	var out bytes.Buffer
	out.ReadFrom(resp.Body)
	return response{resp.StatusCode, out.Bytes(), resp.Header}
}

func decode[T any](t *testing.T, r response) T {
	t.Helper()
	var v T
	if err := json.Unmarshal(r.body, &v); err != nil {
		t.Fatalf("decode %s: %v", r.body, err)
	}
	return v
}

func registerBody(email, regNum string) map[string]string {
	return map[string]string{
		"email": email, "registrationNumber": regNum,
		"firstName": "Jeanne", "lastName": "Dupont", "password": "password1",
	}
}

func register(t *testing.T, srv *httptest.Server, email, regNum string) string {
	tok, _ := registerID(t, srv, email, regNum)
	return tok
}

func registerID(t *testing.T, srv *httptest.Server, email, regNum string) (string, int64) {
	t.Helper()
	r := do(t, srv, "POST", "/auth/register", "", registerBody(email, regNum))
	if r.code != http.StatusCreated {
		t.Fatalf("register %s: %d %s", email, r.code, r.body)
	}
	out := decode[struct {
		Token string
		Coach struct{ ID int64 }
	}](t, r)
	return out.Token, out.Coach.ID
}

// createVehicle makes a 5 CV car, or the given type with 4 CV (ignored for a moped).
func createVehicle(t *testing.T, srv *httptest.Server, token, typ string) int64 {
	t.Helper()
	return createVehicleWith(t, srv, token, map[string]any{"label": "Clio", "type": typ, "fiscalHorsepower": map[bool]int{true: 5, false: 4}[typ == "car"]})
}

func createVehicleWith(t *testing.T, srv *httptest.Server, token string, body map[string]any) int64 {
	t.Helper()
	r := do(t, srv, "POST", "/vehicles", token, body)
	if r.code != http.StatusCreated {
		t.Fatalf("create vehicle: %d %s", r.code, r.body)
	}
	return decode[struct{ ID int64 }](t, r).ID
}

type trip struct {
	ID         int64
	ClientID   *string
	Date       string
	VehicleID  int64
	DistanceKm float64
	RoundTrip  bool
	BilledKm   float64
}

func TestAuth(t *testing.T) {
	srv := newTestServer(t, "")
	token := register(t, srv, "Jeanne@Club.fr", " 5655006 101030 ")

	me := do(t, srv, "GET", "/auth/me", token, nil)
	if me.code != 200 || !bytes.Contains(me.body, []byte(`"email":"jeanne@club.fr"`)) || !bytes.Contains(me.body, []byte(`"registrationNumber":"5655006101030"`)) {
		t.Errorf("me: %d %s", me.code, me.body)
	}
	if bytes.Contains(bytes.ToLower(me.body), []byte("password")) {
		t.Errorf("response leaks password data: %s", me.body)
	}

	if r := do(t, srv, "POST", "/auth/register", "", registerBody("jeanne@club.fr", "5655006999999")); r.code != http.StatusConflict || !bytes.Contains(r.body, []byte("email")) {
		t.Errorf("duplicate email: %d %s", r.code, r.body)
	}
	if r := do(t, srv, "POST", "/auth/register", "", registerBody("other@club.fr", "5655006101030")); r.code != http.StatusConflict || !bytes.Contains(r.body, []byte("registrationNumber")) {
		t.Errorf("duplicate registration number: %d %s", r.code, r.body)
	}
	for _, b := range []map[string]string{
		registerBody("not-an-email", "5655006000001"),
		registerBody("x@club.fr", "1234567101030"),  // wrong prefix
		registerBody("x@club.fr", "565500610103"),   // too short
		registerBody("x@club.fr", "56550061010300"), // too long
		registerBody("x@club.fr", "5655006ABC030"),  // not digits
	} {
		if r := do(t, srv, "POST", "/auth/register", "", b); r.code != http.StatusBadRequest {
			t.Errorf("invalid register %v: want 400, got %d", b, r.code)
		}
	}

	login := do(t, srv, "POST", "/auth/login", "", map[string]string{"email": " JEANNE@club.fr", "password": "password1"})
	if login.code != 200 || !bytes.Contains(login.body, []byte(`"token"`)) || !bytes.Contains(login.body, []byte(`"coach"`)) {
		t.Errorf("login: %d %s", login.code, login.body)
	}
	for _, creds := range []map[string]string{
		{"email": "jeanne@club.fr", "password": "wrong-pass"},
		{"email": "ghost@club.fr", "password": "password1"},
	} {
		if r := do(t, srv, "POST", "/auth/login", "", creds); r.code != http.StatusUnauthorized {
			t.Errorf("bad login %v: want 401, got %d", creds, r.code)
		}
	}
	for _, tok := range []string{"", "garbage", "eyJhbGciOiJub25lIn0.eyJzdWIiOiIxIn0."} {
		if r := do(t, srv, "GET", "/trips", tok, nil); r.code != http.StatusUnauthorized {
			t.Errorf("token %q: want 401, got %d", tok, r.code)
		}
	}
}

func TestVehicles(t *testing.T) {
	srv := newTestServer(t, "")
	alice, bob := register(t, srv, "alice@club.fr", "5655006000001"), register(t, srv, "bob@club.fr", "5655006000002")
	id := createVehicle(t, srv, alice, "car")
	path := fmt.Sprintf("/vehicles/%d", id)

	if r := do(t, srv, "POST", "/vehicles", alice, map[string]string{"label": "Bus", "type": "bus"}); r.code != 400 {
		t.Errorf("bad type: want 400, got %d", r.code)
	}
	if r := do(t, srv, "POST", "/vehicles", alice, map[string]any{"label": "Clio", "type": "car"}); r.code != 400 {
		t.Errorf("car without fiscalHorsepower: want 400, got %d", r.code)
	}
	if r := do(t, srv, "PATCH", path, alice, map[string]any{"type": "motorcycle", "electric": true}); r.code != 200 ||
		!bytes.Contains(r.body, []byte(`"label":"Clio"`)) || !bytes.Contains(r.body, []byte(`"fiscalHorsepower":5`)) || !bytes.Contains(r.body, []byte(`"electric":true`)) {
		t.Errorf("patch keeps unsent fields: %d %s", r.code, r.body)
	}
	if r := do(t, srv, "PATCH", path, alice, map[string]any{"type": "moped"}); r.code != 200 || !bytes.Contains(r.body, []byte(`"fiscalHorsepower":null`)) {
		t.Errorf("moped drops horsepower: %d %s", r.code, r.body)
	}
	if r := do(t, srv, "PATCH", path, bob, map[string]string{"label": "mine"}); r.code != 404 {
		t.Errorf("bob patch: want 404, got %d", r.code)
	}
	if r := do(t, srv, "GET", "/vehicles", bob, nil); string(bytes.TrimSpace(r.body)) != "[]" {
		t.Errorf("bob sees vehicles: %s", r.body)
	}

	do(t, srv, "POST", "/trips", alice, map[string]any{"date": "2026-03-01", "origin": "A", "destination": "B", "purpose": "Match", "vehicleId": id, "distanceKm": 10})
	if r := do(t, srv, "DELETE", path, alice, nil); r.code != http.StatusConflict {
		t.Errorf("delete vehicle in use: want 409, got %d %s", r.code, r.body)
	}
	other := createVehicle(t, srv, alice, "car")
	if r := do(t, srv, "DELETE", fmt.Sprintf("/vehicles/%d", other), alice, nil); r.code != 204 {
		t.Errorf("delete unused vehicle: want 204, got %d", r.code)
	}
}

func TestTripsCRUDOwnershipAndAmounts(t *testing.T) {
	srv := newTestServer(t, "")
	alice, bob := register(t, srv, "alice@club.fr", "5655006000001"), register(t, srv, "bob@club.fr", "5655006000002")
	car := createVehicle(t, srv, alice, "car")
	bobCar := createVehicle(t, srv, bob, "car")

	body := map[string]any{"date": "2023-07-15", "origin": "Paris", "destination": "Lyon", "purpose": "Tournoi", "vehicleId": car, "distanceKm": 100, "roundTrip": true}
	r := do(t, srv, "POST", "/trips", alice, body)
	if r.code != http.StatusCreated {
		t.Fatalf("create: %d %s", r.code, r.body)
	}
	created := decode[trip](t, r)
	if created.BilledKm != 200 || bytes.Contains(r.body, []byte("amount")) {
		t.Errorf("trip: %s", r.body)
	}
	path := fmt.Sprintf("/trips/%d", created.ID)

	body["vehicleId"] = bobCar
	if r := do(t, srv, "POST", "/trips", alice, body); r.code != 400 {
		t.Errorf("trip with someone else's vehicle: want 400, got %d %s", r.code, r.body)
	}

	if r := do(t, srv, "GET", "/trips?year=2023", alice, nil); r.code != 200 || !bytes.Contains(r.body, []byte("Lyon")) {
		t.Errorf("list 2023: %d %s", r.code, r.body)
	}
	if r := do(t, srv, "GET", "/trips?year=2024", alice, nil); string(bytes.TrimSpace(r.body)) != "[]" {
		t.Errorf("list 2024 should be empty: %s", r.body)
	}
	for _, m := range []string{"GET", "PATCH", "DELETE"} {
		if r := do(t, srv, m, path, bob, map[string]any{"purpose": "x"}); r.code != http.StatusNotFound {
			t.Errorf("bob %s: want 404, got %d", m, r.code)
		}
	}
	if r := do(t, srv, "PATCH", path, alice, map[string]any{"vehicleId": bobCar}); r.code != 400 {
		t.Errorf("patch to someone else's vehicle: want 400, got %d", r.code)
	}

	r = do(t, srv, "PATCH", path, alice, map[string]any{"roundTrip": false})
	if p := decode[trip](t, r); r.code != 200 || p.BilledKm != 100 || p.Date != "2023-07-15" {
		t.Errorf("patch roundTrip: %d %s", r.code, r.body)
	}
	if r := do(t, srv, "PATCH", path, alice, map[string]any{"distanceKm": -3}); r.code != 400 {
		t.Errorf("patch invalid distance: want 400, got %d", r.code)
	}
	if r := do(t, srv, "DELETE", path, alice, nil); r.code != http.StatusNoContent {
		t.Errorf("delete: want 204, got %d", r.code)
	}
	if r := do(t, srv, "GET", path, alice, nil); r.code != http.StatusNotFound {
		t.Errorf("get after delete: want 404, got %d", r.code)
	}
	if r := do(t, srv, "POST", "/trips", alice, map[string]any{"date": "15/07/2026"}); r.code != 400 {
		t.Errorf("bad date: want 400, got %d", r.code)
	}
}

func TestTripCreateIsIdempotentOnClientID(t *testing.T) {
	srv := newTestServer(t, "")
	tok := register(t, srv, "coach@club.fr", "5655006000003")
	car := createVehicle(t, srv, tok, "car")
	body := map[string]any{"clientId": "7b0e-offline-1", "date": "2026-02-01", "origin": "A", "destination": "B", "purpose": "Match", "vehicleId": car, "distanceKm": 12}

	// The offline queue may replay the same request several times at once.
	var wg sync.WaitGroup
	codes := make([]int, 10)
	for i := range codes {
		wg.Add(1)
		go func() {
			defer wg.Done()
			codes[i] = do(t, srv, "POST", "/trips", tok, body).code
		}()
	}
	wg.Wait()
	created := 0
	for _, c := range codes {
		switch c {
		case 201:
			created++
		case 200:
		default:
			t.Errorf("replay: unexpected %d", c)
		}
	}
	if created != 1 {
		t.Errorf("want exactly one 201, got %d (%v)", created, codes)
	}
	list := decode[[]trip](t, do(t, srv, "GET", "/trips?year=2026", tok, nil))
	if len(list) != 1 {
		t.Errorf("want 1 trip after replays, got %d", len(list))
	}
}

func TestSummaryRatesAndExport(t *testing.T) {
	srv := newTestServer(t, "")
	tok := register(t, srv, "coach@club.fr", "5655006000003")
	car := createVehicle(t, srv, tok, "car") // 5 CV
	moto := createVehicleWith(t, srv, tok, map[string]any{"label": "Zero", "type": "motorcycle", "fiscalHorsepower": 4, "electric": true})
	for _, b := range []map[string]any{
		{"date": "2023-01-10", "vehicleId": car, "distanceKm": 50, "roundTrip": true}, // 100 km
		{"date": "2023-01-20", "vehicleId": moto, "distanceKm": 10},                   // 10 km
		{"date": "2023-03-05", "vehicleId": car, "distanceKm": 10.5},                  // 10.5 km
		{"date": "2024-03-05", "vehicleId": car, "distanceKm": 999},                   // other year
	} {
		b["origin"], b["destination"], b["purpose"] = "Créteil", "Évry", "Entraînement"
		if r := do(t, srv, "POST", "/trips", tok, b); r.code != 201 {
			t.Fatalf("create: %d %s", r.code, r.body)
		}
	}

	type summary struct {
		TotalKm     float64
		TotalAmount float64
		ByMonth     []struct {
			Month  int
			Km     float64
			Amount float64
		}
		ByVehicle []struct {
			VehicleID int64
			Km        float64
			Amount    float64
		}
	}
	// Car 5 CV: 110.5 km × 0.636 = 70.28. Electric motorcycle 4 CV:
	// 10 km × 0.468 × 1.2 = 5.62. The car's 70.28 is spread pro rata over
	// January (100 km) and March (10.5 km): 63.60 + 6.68.
	s := decode[summary](t, do(t, srv, "GET", "/summary?year=2023", tok, nil))
	if s.TotalKm != 120.5 || s.TotalAmount != 75.90 || len(s.ByMonth) != 12 {
		t.Errorf("summary totals: %+v", s)
	}
	if s.ByMonth[0].Km != 110 || s.ByMonth[0].Amount != 69.22 || s.ByMonth[2].Amount != 6.68 {
		t.Errorf("summary by month: %+v", s.ByMonth[:3])
	}
	if len(s.ByVehicle) != 2 || s.ByVehicle[0].Amount != 70.28 || s.ByVehicle[1].Amount != 5.62 {
		t.Errorf("summary by vehicle: %+v", s.ByVehicle)
	}

	if r := do(t, srv, "GET", "/rates?year=2025", "", nil); r.code != 200 || !bytes.Contains(r.body, []byte(`"fromYear":2022`)) || !bytes.Contains(r.body, []byte(`"electricIncrease":0.2`)) {
		t.Errorf("rates: %d %s", r.code, r.body)
	}

	r := do(t, srv, "GET", "/export?year=2023&format=csv", tok, nil)
	if r.code != 200 || !strings.Contains(r.header.Get("Content-Disposition"), "recapitulatif-km-2023.csv") {
		t.Fatalf("csv: %d %v", r.code, r.header)
	}
	csv := string(r.body)
	if !strings.Contains(csv, "Évry") || !strings.Contains(csv, "Total;;120,5;75,90") || !strings.Contains(csv, "Moto 4 CV électrique") || strings.Contains(csv, "999") {
		t.Errorf("csv content:\n%s", csv)
	}
	r = do(t, srv, "GET", "/export?year=2023&format=pdf", tok, nil)
	if r.code != 200 || r.header.Get("Content-Type") != "application/pdf" || !bytes.HasPrefix(r.body, []byte("%PDF")) {
		t.Errorf("pdf: %d %v", r.code, r.header)
	}
	if r := do(t, srv, "GET", "/export?format=xls", tok, nil); r.code != 400 {
		t.Errorf("bad format: want 400, got %d", r.code)
	}
}

type receipt struct {
	ID      int64
	Number  string
	CoachID int64
	Amount  float64
}

func TestWaiversAndReceipts(t *testing.T) {
	srv, db := newTestServerDB(t, "", testAssociation)
	ctx := context.Background()
	coach, coachID := registerID(t, srv, "coach@club.fr", "5655006000001")
	other := register(t, srv, "other@club.fr", "5655006000002")
	pres := register(t, srv, "pres@club.fr", "5655006000009")
	if _, err := db.WriteQueries().SetRoleByEmail(ctx, database.SetRoleByEmailParams{Role: "president", Email: "pres@club.fr"}); err != nil {
		t.Fatal(err)
	}

	car := createVehicle(t, srv, coach, "car") // 5 CV: 100 km = 63.60 €
	tripBody := map[string]any{"date": "2025-03-01", "origin": "A", "destination": "B", "purpose": "Match", "vehicleId": car, "distanceKm": 100}
	tr := decode[trip](t, do(t, srv, "POST", "/trips", coach, tripBody))
	tripPath := fmt.Sprintf("/trips/%d", tr.ID)

	if r := do(t, srv, "POST", "/waivers", coach, map[string]int{"year": 2025}); r.code != 400 || !bytes.Contains(r.body, []byte("address")) {
		t.Errorf("waiver without address: want 400, got %d %s", r.code, r.body)
	}
	addr := map[string]any{"address": map[string]string{"line": "3 allée des Pins", "postalCode": "94000", "city": "Créteil"}}
	if r := do(t, srv, "PATCH", "/auth/me", coach, addr); r.code != 200 || !bytes.Contains(r.body, []byte("allée des Pins")) {
		t.Fatalf("set address: %d %s", r.code, r.body)
	}
	if r := do(t, srv, "POST", "/waivers", coach, map[string]int{"year": 2025}); r.code != 201 || !bytes.Contains(r.body, []byte(`"amount":63.6`)) {
		t.Fatalf("waiver: %d %s", r.code, r.body)
	}
	if r := do(t, srv, "POST", "/waivers", coach, map[string]int{"year": 2025}); r.code != 409 {
		t.Errorf("second waiver: want 409, got %d", r.code)
	}

	// The waived year is frozen; other years aren't.
	if r := do(t, srv, "POST", "/trips", coach, tripBody); r.code != 409 {
		t.Errorf("create in waived year: want 409, got %d", r.code)
	}
	if r := do(t, srv, "PATCH", tripPath, coach, map[string]any{"distanceKm": 5}); r.code != 409 {
		t.Errorf("patch in waived year: want 409, got %d", r.code)
	}
	if r := do(t, srv, "DELETE", tripPath, coach, nil); r.code != 409 {
		t.Errorf("delete in waived year: want 409, got %d", r.code)
	}
	tripBody["date"] = "2024-03-01"
	if r := do(t, srv, "POST", "/trips", coach, tripBody); r.code != 201 {
		t.Errorf("create in open year: want 201, got %d", r.code)
	}
	vehiclePath := fmt.Sprintf("/vehicles/%d", car)
	if r := do(t, srv, "PATCH", vehiclePath, coach, map[string]any{"fiscalHorsepower": 7}); r.code != 409 {
		t.Errorf("re-rating a vehicle used in a waived year: want 409, got %d", r.code)
	}
	if r := do(t, srv, "PATCH", vehiclePath, coach, map[string]any{"label": "Clio 4"}); r.code != 200 {
		t.Errorf("relabel: want 200, got %d", r.code)
	}

	// President-only endpoints.
	if r := do(t, srv, "GET", "/admin/coaches?year=2025", coach, nil); r.code != 403 {
		t.Errorf("coach on admin route: want 403, got %d", r.code)
	}
	r := do(t, srv, "GET", "/admin/coaches?year=2025", pres, nil)
	if r.code != 200 || !bytes.Contains(r.body, []byte(`"totalAmount":63.6`)) || !bytes.Contains(r.body, []byte(`"waiver":{"year":2025`)) {
		t.Errorf("admin coaches: %d %s", r.code, r.body)
	}
	if r := do(t, srv, "POST", "/admin/receipts", pres, map[string]any{"coachId": coachID + 1, "year": 2025}); r.code != 409 {
		t.Errorf("receipt without waiver: want 409, got %d", r.code)
	}
	r = do(t, srv, "POST", "/admin/receipts", pres, map[string]any{"coachId": coachID, "year": 2025})
	rc := decode[receipt](t, r)
	if r.code != 201 || rc.Number != "2025-0001" || rc.Amount != 63.6 {
		t.Fatalf("issue receipt: %d %s", r.code, r.body)
	}
	if r := do(t, srv, "POST", "/admin/receipts", pres, map[string]any{"coachId": coachID, "year": 2025}); r.code != 409 {
		t.Errorf("second receipt: want 409, got %d", r.code)
	}
	if r := do(t, srv, "DELETE", "/waivers/2025", coach, nil); r.code != 409 {
		t.Errorf("withdraw waiver after receipt: want 409, got %d", r.code)
	}

	pdfPath := fmt.Sprintf("/receipts/%d/pdf", rc.ID)
	for _, c := range []struct {
		who  string
		tok  string
		want int
	}{{"coach", coach, 200}, {"president", pres, 200}, {"other coach", other, 404}} {
		r := do(t, srv, "GET", pdfPath, c.tok, nil)
		if r.code != c.want {
			t.Errorf("%s downloads receipt: want %d, got %d", c.who, c.want, r.code)
		}
		if c.want == 200 && (!bytes.HasPrefix(r.body, []byte("%PDF")) || !strings.Contains(r.header.Get("Content-Disposition"), "recu-fiscal-2025-0001.pdf")) {
			t.Errorf("%s: not a receipt PDF: %v", c.who, r.header)
		}
	}
	if ws := do(t, srv, "GET", "/waivers", coach, nil); !bytes.Contains(ws.body, []byte(`"number":"2025-0001"`)) {
		t.Errorf("waivers list shows receipt: %s", ws.body)
	}
}

func TestWaiverWithdrawalUnlocksYear(t *testing.T) {
	srv := newTestServer(t, "")
	tok := register(t, srv, "coach@club.fr", "5655006000001")
	do(t, srv, "PATCH", "/auth/me", tok, map[string]any{"address": map[string]string{"line": "x", "postalCode": "94000", "city": "Créteil"}})
	car := createVehicle(t, srv, tok, "car")
	body := map[string]any{"date": "2025-03-01", "origin": "A", "destination": "B", "purpose": "Match", "vehicleId": car, "distanceKm": 10}
	do(t, srv, "POST", "/trips", tok, body)

	if r := do(t, srv, "POST", "/waivers", tok, map[string]int{"year": 2025}); r.code != 201 {
		t.Fatalf("waiver: %d %s", r.code, r.body)
	}
	if r := do(t, srv, "DELETE", "/waivers/2025", tok, nil); r.code != 204 {
		t.Fatalf("withdraw: want 204, got %d", r.code)
	}
	if r := do(t, srv, "POST", "/trips", tok, body); r.code != 201 {
		t.Errorf("year should be open again: got %d", r.code)
	}
	if r := do(t, srv, "POST", "/waivers", tok, map[string]int{"year": 2019}); r.code != 400 {
		t.Errorf("waiver with no mileage: want 400, got %d", r.code)
	}
}

func TestConcurrentReceiptNumbering(t *testing.T) {
	srv, db := newTestServerDB(t, "", testAssociation)
	pres := register(t, srv, "pres@club.fr", "5655006000009")
	db.WriteQueries().SetRoleByEmail(context.Background(), database.SetRoleByEmailParams{Role: "president", Email: "pres@club.fr"})

	const n = 8
	ids := make([]int64, n)
	for i := range n {
		tok, id := registerID(t, srv, fmt.Sprintf("c%d@club.fr", i), fmt.Sprintf("5655006%06d", 100+i))
		ids[i] = id
		do(t, srv, "PATCH", "/auth/me", tok, map[string]any{"address": map[string]string{"line": "x", "postalCode": "94000", "city": "Créteil"}})
		car := createVehicle(t, srv, tok, "car")
		do(t, srv, "POST", "/trips", tok, map[string]any{"date": "2025-05-01", "origin": "A", "destination": "B", "purpose": "p", "vehicleId": car, "distanceKm": 20})
		if r := do(t, srv, "POST", "/waivers", tok, map[string]int{"year": 2025}); r.code != 201 {
			t.Fatalf("waiver: %d %s", r.code, r.body)
		}
	}

	numbers := make([]string, n)
	var wg sync.WaitGroup
	for i := range n {
		wg.Add(1)
		go func() {
			defer wg.Done()
			r := do(t, srv, "POST", "/admin/receipts", pres, map[string]any{"coachId": ids[i], "year": 2025})
			if r.code != 201 {
				t.Errorf("issue: %d %s", r.code, r.body)
				return
			}
			numbers[i] = decode[receipt](t, r).Number
		}()
	}
	wg.Wait()
	seen := map[string]bool{}
	for _, num := range numbers {
		if seen[num] {
			t.Errorf("duplicate receipt number %s in %v", num, numbers)
		}
		seen[num] = true
	}
	for i := 1; i <= n; i++ {
		if !seen[fmt.Sprintf("2025-%04d", i)] {
			t.Errorf("numbers have a gap: %v", numbers)
		}
	}
}

func TestReceiptNeedsAssociationConfig(t *testing.T) {
	srv, db := newTestServerDB(t, "", config.Association{})
	pres := register(t, srv, "pres@club.fr", "5655006000009")
	db.WriteQueries().SetRoleByEmail(context.Background(), database.SetRoleByEmailParams{Role: "president", Email: "pres@club.fr"})
	if r := do(t, srv, "POST", "/admin/receipts", pres, map[string]any{"coachId": 1, "year": 2025}); r.code != http.StatusServiceUnavailable {
		t.Errorf("want 503 without association config, got %d", r.code)
	}
}

func TestConcurrentWritesAndReads(t *testing.T) {
	srv := newTestServer(t, "")
	tok := register(t, srv, "coach@club.fr", "5655006000003")
	car := createVehicle(t, srv, tok, "car")

	const n = 50
	var wg sync.WaitGroup
	for i := range n {
		wg.Add(3)
		go func() {
			defer wg.Done()
			b := map[string]any{"date": "2026-01-02", "origin": "A", "destination": fmt.Sprint(i), "purpose": "p", "vehicleId": car, "distanceKm": 10}
			if r := do(t, srv, "POST", "/trips", tok, b); r.code != http.StatusCreated {
				t.Errorf("create: %d %s", r.code, r.body)
			}
		}()
		go func() {
			defer wg.Done()
			if r := do(t, srv, "GET", "/trips?year=2026", tok, nil); r.code != http.StatusOK {
				t.Errorf("list: %d %s", r.code, r.body)
			}
		}()
		go func() {
			defer wg.Done()
			if r := do(t, srv, "GET", "/summary?year=2026", tok, nil); r.code != http.StatusOK {
				t.Errorf("summary: %d %s", r.code, r.body)
			}
		}()
	}
	wg.Wait()

	if list := decode[[]trip](t, do(t, srv, "GET", "/trips?year=2026", tok, nil)); len(list) != n {
		t.Errorf("want %d trips, got %d", n, len(list))
	}
}

func TestExternalDemoCoalescesCalls(t *testing.T) {
	var hits atomic.Int32
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits.Add(1)
		time.Sleep(50 * time.Millisecond)
		w.Write([]byte(`{"id":1,"title":"demo","completed":false,"ignored":"x"}`))
	}))
	defer upstream.Close()

	srv := newTestServer(t, upstream.URL)
	tok := register(t, srv, "coach@club.fr", "5655006000003")

	if r := do(t, srv, "GET", "/external/demo", "", nil); r.code != http.StatusUnauthorized {
		t.Errorf("no token: want 401, got %d", r.code)
	}
	var wg sync.WaitGroup
	for range 20 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if r := do(t, srv, "GET", "/external/demo", tok, nil); r.code != 200 || !bytes.Contains(r.body, []byte(`"title":"demo"`)) {
				t.Errorf("demo: %d %s", r.code, r.body)
			}
		}()
	}
	wg.Wait()
	if h := hits.Load(); h != 1 {
		t.Errorf("want 1 upstream call, got %d", h)
	}
}

func TestExternalDemoUpstreamDown(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer upstream.Close()

	srv := newTestServer(t, upstream.URL)
	tok := register(t, srv, "coach@club.fr", "5655006000003")
	if r := do(t, srv, "GET", "/external/demo", tok, nil); r.code != http.StatusBadGateway {
		t.Errorf("want 502, got %d", r.code)
	}
}
