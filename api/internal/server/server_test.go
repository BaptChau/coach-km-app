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
	"github.com/BaptChau/coach-km-app/api/internal/rates"
)

const secret = "test-secret-123"

func TestMain(m *testing.M) {
	slog.SetDefault(slog.New(slog.DiscardHandler))
	os.Exit(m.Run())
}

func newTestServer(t *testing.T, upstreamURL string) *httptest.Server {
	t.Helper()
	ctx := context.Background()
	db, err := database.Open(ctx, filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	rt, err := rates.Load(ctx, database.New(db.Read))
	if err != nil {
		t.Fatal(err)
	}

	srv := httptest.NewServer(New(Deps{
		DB:                 db,
		JWTSecret:          secret,
		RegistrationNumber: regexp.MustCompile(config.DefaultRegistrationNumberPattern),
		Rates:              rt,
		External:           external.NewClient(upstreamURL),
	}))
	t.Cleanup(srv.Close)
	return srv
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
	t.Helper()
	r := do(t, srv, "POST", "/auth/register", "", registerBody(email, regNum))
	if r.code != http.StatusCreated {
		t.Fatalf("register %s: %d %s", email, r.code, r.body)
	}
	return decode[struct{ Token string }](t, r).Token
}

func createVehicle(t *testing.T, srv *httptest.Server, token, typ string) int64 {
	t.Helper()
	r := do(t, srv, "POST", "/vehicles", token, map[string]string{"label": "Clio", "type": typ})
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
	Rate       float64
	Amount     float64
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
	if r := do(t, srv, "PATCH", path, alice, map[string]string{"type": "two_wheeler"}); r.code != 200 || !bytes.Contains(r.body, []byte(`"label":"Clio"`)) || !bytes.Contains(r.body, []byte("two_wheeler")) {
		t.Errorf("patch keeps unsent fields: %d %s", r.code, r.body)
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
	// 100 km round trip = 200 km at the 2023 car rate of 0.331 €/km.
	if created.BilledKm != 200 || created.Rate != 0.331 || created.Amount != 66.2 {
		t.Errorf("amounts: %+v", created)
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
	car, moto := createVehicle(t, srv, tok, "car"), createVehicle(t, srv, tok, "two_wheeler")
	for _, b := range []map[string]any{
		{"date": "2023-01-10", "vehicleId": car, "distanceKm": 50, "roundTrip": true},   // 100 km × 0.331 = 33.10
		{"date": "2023-01-20", "vehicleId": moto, "distanceKm": 10, "roundTrip": false}, // 10 km × 0.128 = 1.28
		{"date": "2023-03-05", "vehicleId": car, "distanceKm": 10.5},                    // 10.5 km × 0.331 = 3.4755 -> 3.48
		{"date": "2024-03-05", "vehicleId": car, "distanceKm": 999},                     // other year
	} {
		b["origin"], b["destination"], b["purpose"] = "Créteil", "Évry", "Entraînement"
		if r := do(t, srv, "POST", "/trips", tok, b); r.code != 201 {
			t.Fatalf("create: %d %s", r.code, r.body)
		}
	}

	type summary struct {
		Provisional bool
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
	s := decode[summary](t, do(t, srv, "GET", "/summary?year=2023", tok, nil))
	if s.Provisional || s.TotalKm != 120.5 || s.TotalAmount != 37.86 || len(s.ByMonth) != 12 {
		t.Errorf("summary totals: %+v", s)
	}
	if s.ByMonth[0].Km != 110 || s.ByMonth[0].Amount != 34.38 || s.ByMonth[2].Amount != 3.48 {
		t.Errorf("summary by month: %+v", s.ByMonth[:3])
	}
	if len(s.ByVehicle) != 2 || s.ByVehicle[0].Km != 110.5 || s.ByVehicle[1].Amount != 1.28 {
		t.Errorf("summary by vehicle: %+v", s.ByVehicle)
	}

	if r := do(t, srv, "GET", "/rates?year=2023", "", nil); r.code != 200 || !bytes.Contains(r.body, []byte(`"car":0.331`)) || !bytes.Contains(r.body, []byte(`"provisional":false`)) {
		t.Errorf("rates 2023: %d %s", r.code, r.body)
	}
	if r := do(t, srv, "GET", "/rates?year=2026", "", nil); !bytes.Contains(r.body, []byte(`"provisional":true`)) {
		t.Errorf("rates 2026 should fall back as provisional: %s", r.body)
	}

	r := do(t, srv, "GET", "/export?year=2023&format=csv", tok, nil)
	if r.code != 200 || !strings.Contains(r.header.Get("Content-Disposition"), "recapitulatif-km-2023.csv") {
		t.Fatalf("csv: %d %v", r.code, r.header)
	}
	csv := string(r.body)
	if !strings.Contains(csv, "Évry") || !strings.Contains(csv, "Total;;;;;;;;120,5;;37,86") || strings.Contains(csv, "999") {
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
