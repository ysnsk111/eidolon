package persona

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sync"
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
	return pm.activePersona
}
