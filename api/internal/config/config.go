package config

import (
	"errors"
	"fmt"
	"os"
	"regexp"
	"strings"
)

type Config struct {
	Port            string
	DBPath          string
	JWTSecret       string
	ExternalDemoURL string
	// RegistrationNumber validates a coach's club registration number
	// (after removing whitespace).
	RegistrationNumber *regexp.Regexp
	Association        Association
}

// Association identifies the beneficiary printed on Cerfa 11580 receipts.
type Association struct {
	Name       string
	Address    string
	PostalCode string
	City       string
	Object     string // objet de l'association
	Status     string // qualité, e.g. "Œuvre ou organisme d'intérêt général"
	RNA        string // optional Répertoire national des associations number
	SIREN      string // optional INSEE SIREN number (9 digits)
}

// Complete reports whether every field a receipt requires is set.
func (a Association) Complete() bool {
	return a.Name != "" && a.Address != "" && a.PostalCode != "" && a.City != "" && a.Object != "" && a.Status != ""
}

func loadConfig() Config {
	return Config{
		Port:            getEnv("PORT", "3000"),
		DBPath:          getEnv("DB_PATH", "./dev.db"),
		JWTSecret:       getEnv("JWT_SECRET", ""),
		ExternalDemoURL: getEnv("EXTERNAL_DEMO_URL", "https://jsonplaceholder.typicode.com/todos/1"),
		Association: Association{
			Name:       getEnv("ASSOCIATION_NAME", ""),
			Address:    getEnv("ASSOCIATION_ADDRESS", ""),
			PostalCode: getEnv("ASSOCIATION_POSTAL_CODE", ""),
			City:       getEnv("ASSOCIATION_CITY", ""),
			Object:     getEnv("ASSOCIATION_OBJECT", ""),
			Status:     getEnv("ASSOCIATION_STATUS", "Œuvre ou organisme d'intérêt général"),
			RNA:        getEnv("ASSOCIATION_RNA", ""),
			SIREN:      strings.ReplaceAll(getEnv("ASSOCIATION_SIREN", ""), " ", ""),
		},
	}
}

func getEnv(key, defaultValue string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return defaultValue
}

// Registration numbers are 13 digits starting with the federation prefix
// 5655006, e.g. 5655006101030.
// rnaPattern is the Répertoire national des associations number format.
var (
	rnaPattern   = regexp.MustCompile(`^W[0-9]{9}$`)
	sirenPattern = regexp.MustCompile(`^[0-9]{9}$`)
)

const DefaultRegistrationNumberPattern = `^5655006[0-9]{6}$`

func Load() (Config, error) {
	cfg := loadConfig()
	// No default secret: a well-known fallback would let anyone mint tokens.
	if len(cfg.JWTSecret) < 8 {
		return cfg, errors.New("JWT_SECRET must be set (at least 8 characters)")
	}
	re, err := regexp.Compile(getEnv("REGISTRATION_NUMBER_PATTERN", DefaultRegistrationNumberPattern))
	if err != nil {
		return cfg, fmt.Errorf("REGISTRATION_NUMBER_PATTERN: %w", err)
	}
	cfg.RegistrationNumber = re
	if cfg.Association.RNA != "" && !rnaPattern.MatchString(cfg.Association.RNA) {
		return cfg, fmt.Errorf("ASSOCIATION_RNA %q must be W followed by 9 digits", cfg.Association.RNA)
	}
	if cfg.Association.SIREN != "" && !sirenPattern.MatchString(cfg.Association.SIREN) {
		return cfg, fmt.Errorf("ASSOCIATION_SIREN %q must be 9 digits", cfg.Association.SIREN)
	}
	return cfg, nil
}
