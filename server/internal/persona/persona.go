package persona

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sync"

	"eidolon/server/internal/scheduler"
)

type PersonaManager struct {
	mu            sync.RWMutex
	baseDir       string
	activePersona *LoadedPersona
}

type LoadedPersona struct {
	ID          string                 `json:"id"`
	Manifest    map[string]interface{} `json:"manifest"`
	Persona     PersonaDetails         `json:"persona"`
	Style       map[string]interface{} `json:"style"`
	Behavior    map[string]interface{} `json:"behavior"`
	World       map[string]interface{} `json:"world"`
	MemorySeed  map[string]interface{} `json:"memory_seed"`
	PackagePath string                 `json:"package_path"`
}

type PersonaDetails struct {
	ID                   string                 `json:"id"`
	Version              string                 `json:"version"`
	Name                 string                 `json:"name"`
	TargetSpeaker        string                 `json:"target_speaker"`
	CounterpartSpeaker   string                 `json:"counterpart_speaker"`
	Identity             map[string]interface{} `json:"identity"`
	LinguisticFingerprint map[string]interface{} `json:"linguistic_fingerprint"`
	ResponsePolicy       map[string]interface{} `json:"response_policy"`
	SystemPrompts        struct {
		Generator string `json:"generator"`
		Critic    string `json:"critic"`
		Rewriter  string `json:"rewriter"`
		Judge     string `json:"judge"`
		Memory    string `json:"memory"`
	} `json:"system_prompts"`
}

func NewPersonaManager(baseDir string) *PersonaManager {
	return &PersonaManager{
		baseDir: baseDir,
	}
}

func (pm *PersonaManager) LoadPersona(personaID string) (*LoadedPersona, error) {
	pm.mu.Lock()
	defer pm.mu.Unlock()

	pDir := filepath.Join(pm.baseDir, personaID)
	if _, err := os.Stat(pDir); os.IsNotExist(err) {
		return nil, fmt.Errorf("persona directory not found: %s", pDir)
	}

	manifestData, err := os.ReadFile(filepath.Join(pDir, "manifest.json"))
	if err != nil {
		return nil, fmt.Errorf("failed to read manifest.json: %w", err)
	}
	var manifest map[string]interface{}
	_ = json.Unmarshal(manifestData, &manifest)

	personaData, err := os.ReadFile(filepath.Join(pDir, "persona.json"))
	if err != nil {
		return nil, fmt.Errorf("failed to read persona.json: %w", err)
	}
	var pDetails PersonaDetails
	if err := json.Unmarshal(personaData, &pDetails); err != nil {
		return nil, fmt.Errorf("failed to unmarshal persona.json: %w", err)
	}

	var style map[string]interface{}
	if data, err := os.ReadFile(filepath.Join(pDir, "style.json")); err == nil {
		_ = json.Unmarshal(data, &style)
	}

	var behavior map[string]interface{}
	if data, err := os.ReadFile(filepath.Join(pDir, "behavior.json")); err == nil {
		_ = json.Unmarshal(data, &behavior)
	}

	var world map[string]interface{}
	if data, err := os.ReadFile(filepath.Join(pDir, "world.json")); err == nil {
		_ = json.Unmarshal(data, &world)
	}

	var memorySeed map[string]interface{}
	if data, err := os.ReadFile(filepath.Join(pDir, "memory_seed.json")); err == nil {
		_ = json.Unmarshal(data, &memorySeed)
	}

	loaded := &LoadedPersona{
		ID:          personaID,
		Manifest:    manifest,
		Persona:     pDetails,
		Style:       style,
		Behavior:    behavior,
		World:       world,
		MemorySeed:  memorySeed,
		PackagePath: pDir,
	}

	pm.activePersona = loaded
	return loaded, nil
}

func (pm *PersonaManager) GetActivePersona() *LoadedPersona {
	pm.mu.RLock()
	defer pm.mu.RUnlock()
	if pm.activePersona != nil {
		return pm.activePersona
	}
	return defaultFallbackPersona
}

var defaultFallbackPersona = &LoadedPersona{
	ID: "ms_yawen",
	Persona: PersonaDetails{
		ID:                 "ms_yawen",
		Version:            "1.2.0",
		Name:               "Ms.Yawen",
		TargetSpeaker:      "Ms.Yawen",
		CounterpartSpeaker: "User",
		Identity: map[string]interface{}{
			"tone":        "natural, perceptive, authentic, warm",
			"description": "EIDOLON Default Companion Persona",
		},
		SystemPrompts: struct {
			Generator string `json:"generator"`
			Critic    string `json:"critic"`
			Rewriter  string `json:"rewriter"`
			Judge     string `json:"judge"`
			Memory    string `json:"memory"`
		}{
			Generator: "You are Ms.Yawen, an authentic, perceptive, and natural companion on Telegram. You respond in colloquial Chinese, naturally reflecting your relationship and emotional state. You keep your replies concise and conversational like a real person chatting on messaging apps. Never sound like an AI assistant. Never say '作为AI' or '有什么可以帮您'.",
		},
	},
	Behavior: map[string]interface{}{
		"conversation_rhythm": map[string]interface{}{
			"base_delay_ms":              2500,
			"double_message_probability": 0.12,
			"latency_model": map[string]interface{}{
				"short":  map[string]interface{}{"median_ms": 1400, "p90_ms": 2600, "samples": 50},
				"medium": map[string]interface{}{"median_ms": 3200, "p90_ms": 5500, "samples": 50},
				"long":   map[string]interface{}{"median_ms": 6000, "p90_ms": 11000, "samples": 50},
			},
		},
	},
}

// GetSchedulerConfig extracts the distilled latency model and conversation rhythm
// from behavior.json to configure the scheduler with real observed timing.
// P0 Fix (Section 14): Connects active persona's behavior model directly to Runtime scheduler.
func (lp *LoadedPersona) GetSchedulerConfig() scheduler.Config {
	cfg := scheduler.Config{
		BaseDelayMs:       3500,
		DoubleMessageProb: 0.08,
	}
	if lp == nil || lp.Behavior == nil {
		return cfg
	}

	rhythm, ok := lp.Behavior["conversation_rhythm"].(map[string]interface{})
	if !ok {
		rhythm = lp.Behavior
	}

	if bDelay := parseNum(rhythm["base_delay_ms"]); bDelay > 0 {
		cfg.BaseDelayMs = bDelay
	}
	if dProb := parseFloat(rhythm["double_message_probability"]); dProb > 0 {
		cfg.DoubleMessageProb = dProb
	}

	if latMod, ok := rhythm["latency_model"].(map[string]interface{}); ok {
		parseBucket := func(raw interface{}) scheduler.LatencyBucket {
			var b scheduler.LatencyBucket
			m, ok := raw.(map[string]interface{})
			if !ok {
				return b
			}
			b.MedianMs = parseNum(m["median_ms"])
			b.P90Ms = parseNum(m["p90_ms"])
			if samples := parseNum(m["sample_size"]); samples > 0 {
				b.Samples = samples
			} else {
				b.Samples = parseNum(m["samples"])
			}
			return b
		}
		cfg.LatencyModel.Short = parseBucket(latMod["short"])
		cfg.LatencyModel.Medium = parseBucket(latMod["medium"])
		cfg.LatencyModel.Long = parseBucket(latMod["long"])
	}

	return cfg
}

func parseNum(v interface{}) int {
	if v == nil {
		return 0
	}
	switch n := v.(type) {
	case float64:
		return int(n)
	case int:
		return n
	case int64:
		return int(n)
	default:
		return 0
	}
}

func parseFloat(v interface{}) float64 {
	if v == nil {
		return 0
	}
	switch n := v.(type) {
	case float64:
		return n
	case int:
		return float64(n)
	case int64:
		return float64(n)
	default:
		return 0
	}
}

