// Package external wraps outbound HTTP calls. Swap the target URL and the
// Result shape to plug in a real maps/distance provider.
package external

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"sync"
	"time"

	"golang.org/x/sync/singleflight"
)

const (
	requestTimeout = 5 * time.Second
	maxBodyBytes   = 1 << 20
	cacheTTL       = 30 * time.Second
)

// Result is the upstream payload, decoded into only the fields we use.
type Result struct {
	ID        int    `json:"id"`
	Title     string `json:"title"`
	Completed bool   `json:"completed"`
}

type Client struct {
	http *http.Client
	url  string

	// group collapses concurrent identical calls into one upstream request;
	// the short cache keeps a burst of clients from hammering the provider.
	group singleflight.Group
	mu    sync.RWMutex
	value Result
	until time.Time
}

func NewClient(url string) *Client {
	return &Client{
		url: url,
		// One shared client so TCP/TLS connections are pooled and reused.
		http: &http.Client{
			Timeout: requestTimeout,
			Transport: &http.Transport{
				Proxy:               http.ProxyFromEnvironment,
				MaxIdleConns:        20,
				MaxIdleConnsPerHost: 10,
				IdleConnTimeout:     90 * time.Second,
				TLSHandshakeTimeout: 5 * time.Second,
				ForceAttemptHTTP2:   true,
			},
		},
	}
}

func (c *Client) Fetch(ctx context.Context) (Result, error) {
	c.mu.RLock()
	if time.Now().Before(c.until) {
		v := c.value
		c.mu.RUnlock()
		return v, nil
	}
	c.mu.RUnlock()

	ch := c.group.DoChan(c.url, func() (any, error) {
		// Detached from the caller: one client hanging up must not fail the
		// shared call for everyone else waiting on it.
		ctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), requestTimeout)
		defer cancel()

		v, err := c.get(ctx)
		if err != nil {
			return Result{}, err
		}
		c.mu.Lock()
		c.value, c.until = v, time.Now().Add(cacheTTL)
		c.mu.Unlock()
		return v, nil
	})

	select {
	case res := <-ch:
		if res.Err != nil {
			return Result{}, res.Err
		}
		return res.Val.(Result), nil
	case <-ctx.Done():
		return Result{}, ctx.Err()
	}
}

func (c *Client) get(ctx context.Context) (Result, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.url, nil)
	if err != nil {
		return Result{}, err
	}
	req.Header.Set("Accept", "application/json")

	resp, err := c.http.Do(req)
	if err != nil {
		return Result{}, err
	}
	defer func() {
		// Drain so the keep-alive connection goes back to the pool.
		io.Copy(io.Discard, io.LimitReader(resp.Body, maxBodyBytes))
		resp.Body.Close()
	}()

	if resp.StatusCode != http.StatusOK {
		return Result{}, fmt.Errorf("upstream returned %d", resp.StatusCode)
	}

	var out Result
	if err := json.NewDecoder(io.LimitReader(resp.Body, maxBodyBytes)).Decode(&out); err != nil {
		return Result{}, fmt.Errorf("decode upstream response: %w", err)
	}
	return out, nil
}
