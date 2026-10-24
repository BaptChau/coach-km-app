package config

import (
	"errors"
	"fmt"
	"os"
	"regexp"
)

type Config struct {
	Port            string
	DBPath          string
	JWTSecret       string
	ExternalDemoURL string
	// RegistrationNumber validates a coach's club registration number
	// (after removing whitespace).
	RegistrationNumber *regexp.Regexp
}

func loadConfig() Config {
	return Config{
		Port:            getEnv("PORT", "3000"),
		DBPath:          getEnv("DB_PATH", "./dev.db"),
		JWTSecret:       getEnv("JWT_SECRET", ""),
		ExternalDemoURL: getEnv("EXTERNAL_DEMO_URL", "https://jsonplaceholder.typicode.com/todos/1"),
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
	return cfg, nil
}
