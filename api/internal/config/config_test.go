package config

import "testing"

func TestLoadValidatesSIREN(t *testing.T) {
	t.Setenv("JWT_SECRET", "test-secret-123")
	for siren, ok := range map[string]bool{"390 451 110": true, "390451110": true, "": true, "39045111": false, "39045111X": false} {
		t.Setenv("ASSOCIATION_SIREN", siren)
		if _, err := Load(); (err == nil) != ok {
			t.Errorf("SIREN %q: err = %v, want ok=%v", siren, err, ok)
		}
	}
}

func TestLoadValidatesRNA(t *testing.T) {
	t.Setenv("JWT_SECRET", "test-secret-123")
	for rna, ok := range map[string]bool{"W551000642": true, "": true, "W55100064": false, "551000642": false, "w551000642": false} {
		t.Setenv("ASSOCIATION_RNA", rna)
		if _, err := Load(); (err == nil) != ok {
			t.Errorf("RNA %q: err = %v, want ok=%v", rna, err, ok)
		}
	}
}
