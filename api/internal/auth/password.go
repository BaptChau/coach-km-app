package auth

import (
	"context"
	"runtime"

	"golang.org/x/crypto/bcrypt"
)

// bcrypt is deliberately CPU-heavy. Cap how many hashes run at once so a burst
// of register/login requests can't starve the rest of the server.
var hashSlots = make(chan struct{}, runtime.NumCPU())

// dummyHash is compared against when the username doesn't exist, so a failed
// login takes the same time whether or not the account exists.
var dummyHash, _ = bcrypt.GenerateFromPassword([]byte("dummy-password"), bcrypt.DefaultCost)

func acquire(ctx context.Context) error {
	select {
	case hashSlots <- struct{}{}:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

func release() { <-hashSlots }

func HashPassword(ctx context.Context, plainPassword string) (string, error) {
	if err := acquire(ctx); err != nil {
		return "", err
	}
	defer release()

	bytes, err := bcrypt.GenerateFromPassword([]byte(plainPassword), bcrypt.DefaultCost)
	return string(bytes), err
}

// CheckPassword reports whether plain matches hash. An empty hash runs a
// comparison against dummyHash and always returns false.
func CheckPassword(ctx context.Context, hash, plain string) (bool, error) {
	if err := acquire(ctx); err != nil {
		return false, err
	}
	defer release()

	if hash == "" {
		bcrypt.CompareHashAndPassword(dummyHash, []byte(plain))
		return false, nil
	}
	return bcrypt.CompareHashAndPassword([]byte(hash), []byte(plain)) == nil, nil
}
