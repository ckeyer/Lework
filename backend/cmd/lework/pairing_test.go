package main

import (
	"bytes"
	"os"
	"path/filepath"
	"testing"

	controlplaneconfig "github.com/insmtx/lework/backend/internal/controlplane/config"
)

func TestLoadPairingSection(t *testing.T) {
	path := filepath.Join(t.TempDir(), "server.config.yaml")
	content := `env: local
server:
  port: 8090
controlplane:
  public_url: "http://dev.ckeyer.com"
  expo_url: "http://dev.ckeyer.com:8082"
database:
  url: "postgres://example"
`
	if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
		t.Fatalf("write config: %v", err)
	}

	section, err := loadPairingSection(path)
	if err != nil {
		t.Fatalf("loadPairingSection() error = %v", err)
	}
	if section.PublicURL != "http://dev.ckeyer.com" {
		t.Fatalf("PublicURL = %q", section.PublicURL)
	}
	if section.ExpoURL != "http://dev.ckeyer.com:8082" {
		t.Fatalf("ExpoURL = %q", section.ExpoURL)
	}
}

func TestLoadPairingSectionMissingFile(t *testing.T) {
	if _, err := loadPairingSection(filepath.Join(t.TempDir(), "missing.yaml")); err == nil {
		t.Fatal("loadPairingSection() error = nil, want error")
	}
}

func TestLoadPairingSectionEmptyPath(t *testing.T) {
	section, err := loadPairingSection("  ")
	if err != nil {
		t.Fatalf("loadPairingSection() error = %v", err)
	}
	if section.PublicURL != "" || section.ExpoURL != "" {
		t.Fatalf("section = %+v, want empty", section)
	}
}

func TestApplyConfigDefaultsPrefersFlags(t *testing.T) {
	opts := pairOptions{publicURL: "http://flag.example"}
	opts.applyConfigDefaults(controlPlaneSection{
		PublicURL: "http://config.example",
		ExpoURL:   "http://config.example:8082",
	})
	if opts.publicURL != "http://flag.example" {
		t.Fatalf("publicURL = %q, want flag value", opts.publicURL)
	}
	if opts.expoURL != "http://config.example:8082" {
		t.Fatalf("expoURL = %q, want config value", opts.expoURL)
	}
}

func TestAnnouncePairingSilentWhenNotTerminal(t *testing.T) {
	var buf bytes.Buffer
	cfg := controlplaneconfig.Default()
	cfg.ListenAddr = "127.0.0.1:8787"
	cfg.EnrollmentToken = "secret-token"
	announcePairing(&buf, cfg, pairOptions{publicURL: "http://dev.ckeyer.com"})
	if buf.Len() != 0 {
		t.Fatalf("non-terminal output = %q, want empty", buf.String())
	}
}

func TestAnnouncePairingSilentWhenDisabled(t *testing.T) {
	var buf bytes.Buffer
	cfg := controlplaneconfig.Default()
	cfg.ListenAddr = "127.0.0.1:8787"
	cfg.EnrollmentToken = "secret-token"
	announcePairing(&buf, cfg, pairOptions{publicURL: "http://dev.ckeyer.com", noQR: true})
	if buf.Len() != 0 {
		t.Fatalf("--no-qr output = %q, want empty", buf.String())
	}
}
