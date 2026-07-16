package config

import "os"

type Config struct {
	Port      string
	DBPath    string
	JWTSecret string
}

func loadConfig() Config {
	return Config{
		Port:      getEnv("PORT", "3000"),
		DBPath:    getEnv("DB_PATH", "./db"),
		JWTSecret: getEnv("JWT_SECRET", "your_jwt_secret"),
	}
}

func getEnv(key, defaultValue string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return defaultValue
}
