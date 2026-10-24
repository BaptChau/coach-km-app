package users

import (
	"database/sql"
	"errors"
	"fmt"
	"net/http"
	"net/mail"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/BaptChau/coach-km-app/api/internal/auth"
	"github.com/BaptChau/coach-km-app/api/internal/database"
	"github.com/BaptChau/coach-km-app/api/internal/httpx"
)

type Handler struct {
	db                 *database.DB
	reads              *database.Queries
	writes             *database.Queries
	jwtSecret          string
	registrationNumber *regexp.Regexp
}

func NewHandler(db *database.DB, jwtSecret string, registrationNumber *regexp.Regexp) *Handler {
	return &Handler{
		db:                 db,
		reads:              database.New(db.Read),
		writes:             database.New(db.Write),
		jwtSecret:          jwtSecret,
		registrationNumber: registrationNumber,
	}
}

func (h *Handler) Register(mux *http.ServeMux) {
	mux.HandleFunc("POST /auth/register", h.register)
	mux.HandleFunc("POST /auth/login", h.login)
	mux.HandleFunc("GET /auth/me", auth.RequireAuth(h.jwtSecret, h.me))
	mux.HandleFunc("PATCH /auth/me", auth.RequireAuth(h.jwtSecret, h.updateMe))
}

type registerInput struct {
	Email              string `json:"email"`
	RegistrationNumber string `json:"registrationNumber"`
	FirstName          string `json:"firstName"`
	LastName           string `json:"lastName"`
	Password           string `json:"password"`
}

type loginInput struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

type Coach struct {
	ID                 int64     `json:"id"`
	Email              string    `json:"email"`
	RegistrationNumber string    `json:"registrationNumber"`
	FirstName          string    `json:"firstName"`
	LastName           string    `json:"lastName"`
	Role               string    `json:"role"`
	Address            Address   `json:"address"`
	CreatedAt          time.Time `json:"createdAt"`
}

type Address struct {
	Line       string `json:"line"`
	PostalCode string `json:"postalCode"`
	City       string `json:"city"`
}

// Complete reports whether the address can go on a tax receipt.
func (a Address) Complete() bool { return a.Line != "" && a.PostalCode != "" && a.City != "" }

// ToCoach is the public view of a user: never includes the password hash.
func ToCoach(u database.User) Coach {
	return Coach{
		ID:                 u.ID,
		Email:              u.Email,
		RegistrationNumber: u.RegistrationNumber,
		FirstName:          u.FirstName,
		LastName:           u.LastName,
		Role:               u.Role,
		Address:            Address{Line: u.AddressLine, PostalCode: u.PostalCode, City: u.City},
		CreatedAt:          u.CreatedAt,
	}
}

type authResponse struct {
	Token string `json:"token"`
	Coach Coach  `json:"coach"`
}

func normalizeEmail(s string) string { return strings.ToLower(strings.TrimSpace(s)) }

func (h *Handler) validate(in *registerInput) string {
	in.Email = normalizeEmail(in.Email)
	if a, err := mail.ParseAddress(in.Email); err != nil || a.Address != in.Email || len(in.Email) > 254 {
		return "email is invalid"
	}
	// Coaches often type the number in groups ("5655006 101030").
	in.RegistrationNumber = strings.Join(strings.Fields(in.RegistrationNumber), "")
	if !h.registrationNumber.MatchString(in.RegistrationNumber) {
		return "registrationNumber has an invalid format"
	}
	in.FirstName = strings.TrimSpace(in.FirstName)
	in.LastName = strings.TrimSpace(in.LastName)
	if n := utf8.RuneCountInString(in.FirstName); n < 1 || n > 100 {
		return "firstName is required (max 100 characters)"
	}
	if n := utf8.RuneCountInString(in.LastName); n < 1 || n > 100 {
		return "lastName is required (max 100 characters)"
	}
	// bcrypt only uses the first 72 bytes and errors past that.
	if len(in.Password) < 8 || len(in.Password) > 72 {
		return "password must be 8-72 bytes"
	}
	return ""
}

func (h *Handler) register(w http.ResponseWriter, r *http.Request) {
	var in registerInput
	if err := httpx.ReadJSON(w, r, &in); err != nil {
		httpx.Error(w, http.StatusBadRequest, err.Error())
		return
	}
	if msg := h.validate(&in); msg != "" {
		httpx.Error(w, http.StatusBadRequest, msg)
		return
	}

	hash, err := auth.HashPassword(r.Context(), in.Password)
	if err != nil {
		httpx.Internal(w, r, err)
		return
	}

	user, err := h.writes.CreateUser(r.Context(), database.CreateUserParams{
		Email:              in.Email,
		RegistrationNumber: in.RegistrationNumber,
		FirstName:          in.FirstName,
		LastName:           in.LastName,
		PasswordHash:       hash,
	})
	switch {
	case database.UniqueViolationOn(err, "users.email"):
		httpx.Error(w, http.StatusConflict, "email already registered")
		return
	case database.UniqueViolationOn(err, "users.registration_number"):
		httpx.Error(w, http.StatusConflict, "registrationNumber already registered")
		return
	case err != nil:
		httpx.Internal(w, r, err)
		return
	}

	h.writeAuth(w, r, http.StatusCreated, user)
}

func (h *Handler) login(w http.ResponseWriter, r *http.Request) {
	var in loginInput
	if err := httpx.ReadJSON(w, r, &in); err != nil {
		httpx.Error(w, http.StatusBadRequest, err.Error())
		return
	}

	user, err := h.reads.GetUserByEmail(r.Context(), normalizeEmail(in.Email))
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		httpx.Internal(w, r, err)
		return
	}

	// Always run bcrypt (against a dummy hash when the user is unknown) so
	// response time doesn't reveal which emails are registered.
	ok, err := auth.CheckPassword(r.Context(), user.PasswordHash, in.Password)
	if err != nil {
		httpx.Internal(w, r, err)
		return
	}
	if !ok {
		httpx.Error(w, http.StatusUnauthorized, "invalid email or password")
		return
	}

	h.writeAuth(w, r, http.StatusOK, user)
}

func (h *Handler) me(w http.ResponseWriter, r *http.Request) {
	userID, _ := auth.UserID(r)
	user, err := h.reads.GetUserByID(r.Context(), userID)
	if errors.Is(err, sql.ErrNoRows) {
		// Valid token for an account that no longer exists.
		httpx.Error(w, http.StatusUnauthorized, "account not found")
		return
	}
	if err != nil {
		httpx.Internal(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]Coach{"coach": ToCoach(user)})
}

type profileInput struct {
	FirstName *string `json:"firstName"`
	LastName  *string `json:"lastName"`
	Address   *struct {
		Line       *string `json:"line"`
		PostalCode *string `json:"postalCode"`
		City       *string `json:"city"`
	} `json:"address"`
}

func (h *Handler) updateMe(w http.ResponseWriter, r *http.Request) {
	userID, _ := auth.UserID(r)
	var in profileInput
	if err := httpx.ReadJSON(w, r, &in); err != nil {
		httpx.Error(w, http.StatusBadRequest, err.Error())
		return
	}

	var (
		updated database.User
		msg     string
	)
	err := h.db.WriteTx(r.Context(), func(q *database.Queries) error {
		u, err := q.GetUserByID(r.Context(), userID)
		if err != nil {
			return err
		}
		set := func(dst *string, src *string, name string, maxLen int, required bool) {
			if src == nil || msg != "" {
				return
			}
			v := strings.TrimSpace(*src)
			if n := utf8.RuneCountInString(v); n > maxLen || (required && n == 0) {
				msg = fmt.Sprintf("%s must be at most %d characters", name, maxLen)
				if required {
					msg = fmt.Sprintf("%s is required (max %d characters)", name, maxLen)
				}
				return
			}
			*dst = v
		}
		set(&u.FirstName, in.FirstName, "firstName", 100, true)
		set(&u.LastName, in.LastName, "lastName", 100, true)
		if in.Address != nil {
			set(&u.AddressLine, in.Address.Line, "address.line", 200, false)
			set(&u.PostalCode, in.Address.PostalCode, "address.postalCode", 10, false)
			set(&u.City, in.Address.City, "address.city", 100, false)
		}
		if msg != "" {
			return nil
		}
		updated, err = q.UpdateProfile(r.Context(), database.UpdateProfileParams{
			FirstName: u.FirstName, LastName: u.LastName,
			AddressLine: u.AddressLine, PostalCode: u.PostalCode, City: u.City,
			ID: userID,
		})
		return err
	})
	switch {
	case errors.Is(err, sql.ErrNoRows):
		httpx.Error(w, http.StatusUnauthorized, "account not found")
	case err != nil:
		httpx.Internal(w, r, err)
	case msg != "":
		httpx.Error(w, http.StatusBadRequest, msg)
	default:
		httpx.WriteJSON(w, http.StatusOK, map[string]Coach{"coach": ToCoach(updated)})
	}
}

func (h *Handler) writeAuth(w http.ResponseWriter, r *http.Request, status int, user database.User) {
	token, err := auth.GenerateToken(h.jwtSecret, user.ID)
	if err != nil {
		httpx.Internal(w, r, err)
		return
	}
	httpx.WriteJSON(w, status, authResponse{Token: token, Coach: ToCoach(user)})
}
