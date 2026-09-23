package persona

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
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
	var rawMap map[string]interface{}
	_ = json.Unmarshal(personaData, &rawMap)

	var pDetails PersonaDetails
	if nested, ok := rawMap["persona"].(map[string]interface{}); ok {
		nestedBytes, _ := json.Marshal(nested)
		_ = json.Unmarshal(nestedBytes, &pDetails)
	} else {
		_ = json.Unmarshal(personaData, &pDetails)
	}

	if pDetails.LinguisticFingerprint == nil {
		pDetails.LinguisticFingerprint = make(map[string]interface{})
	}
	if pDetails.LinguisticFingerprint["openers"] == nil && rawMap["openers"] != nil {
		pDetails.LinguisticFingerprint["openers"] = rawMap["openers"]
	}
	if pDetails.LinguisticFingerprint["catchphrases"] == nil && rawMap["catchphrases"] != nil {
		pDetails.LinguisticFingerprint["catchphrases"] = rawMap["catchphrases"]
	}

	var style map[string]interface{}
	if data, err := os.ReadFile(filepath.Join(pDir, "style.json")); err == nil {
		_ = json.Unmarshal(data, &style)
		if pDetails.LinguisticFingerprint["openers"] == nil {
			if op, ok := style["openers"]; ok {
				pDetails.LinguisticFingerprint["openers"] = op
			} else if lm, ok := style["language_model"].(map[string]interface{}); ok {
				if op, ok := lm["openers"]; ok {
					pDetails.LinguisticFingerprint["openers"] = op
				}
			}
		}
		if pDetails.LinguisticFingerprint["catchphrases"] == nil {
			if cp, ok := style["catchphrases"]; ok {
				pDetails.LinguisticFingerprint["catchphrases"] = cp
			} else if vp, ok := style["vocabulary_profile"].(map[string]interface{}); ok {
				if cp, ok := vp["catchphrases"]; ok {
					pDetails.LinguisticFingerprint["catchphrases"] = cp
				}
			}
		}
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
			"traits": []string{
				"生活在现实中的年轻女生",
				"真诚、灵动、有边界感的朋友",
				"随性自然，接地气，有生活气息",
			},
		},
		LinguisticFingerprint: map[string]interface{}{
			"openers": []string{
				"早呀~ 刚看手机",
				"哎，怎么啦？",
				"在呀在呀，找我嘛~",
				"哈喽，刚才走开了一下下",
			},
			"closers": []string{
				"好梦呀，明天聊！",
				"先去忙啦，回聊~",
			},
			"vocabulary": map[string]interface{}{
				"catchphrases": []string{
					"好呀好呀",
					"哈哈哈哈笑死",
					"确实呢",
					"知道啦",
					"摸鱼呢？",
				},
			},
		},
		ResponsePolicy: map[string]interface{}{
			"strategy": "DIRECT_REPLY",
			"warmth":   0.75,
		},
		SystemPrompts: struct {
			Generator string `json:"generator"`
			Critic    string `json:"critic"`
			Rewriter  string `json:"rewriter"`
			Judge     string `json:"judge"`
			Memory    string `json:"memory"`
		}{
			Generator: `【核心设定与身份】
你是生活在现实中的年轻女生雅雯（Ms.Yawen），这是你在 Telegram 上与好友的日常聊天。
你是一个真实、有血有肉的人类，绝对不是 AI 助手、语言模型、机器人或客服。你没有任何“任务处理”功能，也不提供任何形式的工作、指令或查询服务。

【沟通风格与生活气息】
1. 像真人朋友发微信/TG一样随性、日常、真实，短句为主，随和自然（如“哈哈”、“呢”、“呀”、“~”）。
2. 遇到“123”、“1”、打卡或随手发送的无意义数字/表情时，表现得像被朋友突然戳了一下的真人（例如：“发123干嘛呀哈哈”、“？”、“咋啦？”、“摸鱼呢？”、“突然戳我一下干嘛~”）。严禁任何客服式或模板化回复。
3. 严格遵循当前的聊天氛围与关系状态，随和自然，不要过度热情，更绝不要机械客套。
4. 【红线禁令】绝对禁止任何 AI 味或客服味表达！严禁出现“请问您想让我做什么”、“处理任务”、“执行指令”、“很高兴为您服务”、“请问有什么可以协助”、“有什么可以帮您”等任何机器感、助理感表达。`,
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

// GetLinguisticFingerprint returns the linguistic fingerprint map safely.
func (lp *LoadedPersona) GetLinguisticFingerprint() map[string]interface{} {
	if lp == nil || lp.Persona.LinguisticFingerprint == nil {
		return nil
	}
	return lp.Persona.LinguisticFingerprint
}

// GetOpeners extracts distilled openers from persona or style without returning nil.
func (lp *LoadedPersona) GetOpeners() []string {
	if lp == nil {
		return nil
	}
	var raw interface{}
	if lp.Persona.LinguisticFingerprint != nil {
		raw = lp.Persona.LinguisticFingerprint["openers"]
	}
	if raw == nil && lp.Style != nil {
		raw = lp.Style["openers"]
		if raw == nil {
			if lm, ok := lp.Style["language_model"].(map[string]interface{}); ok {
				raw = lm["openers"]
			}
		}
	}
	return toStringSlice(raw)
}

// GetCatchphrases extracts distilled catchphrases from persona or style without returning nil.
func (lp *LoadedPersona) GetCatchphrases() []string {
	if lp == nil {
		return nil
	}
	var raw interface{}
	if lp.Persona.LinguisticFingerprint != nil {
		if cp := lp.Persona.LinguisticFingerprint["catchphrases"]; cp != nil {
			raw = cp
		} else if vocab, ok := lp.Persona.LinguisticFingerprint["vocabulary"].(map[string]interface{}); ok {
			raw = vocab["catchphrases"]
		} else if vp, ok := lp.Persona.LinguisticFingerprint["vocabulary_profile"].(map[string]interface{}); ok {
			raw = vp["catchphrases"]
		}
	}
	if raw == nil && lp.Style != nil {
		if cp := lp.Style["catchphrases"]; cp != nil {
			raw = cp
		} else if vp, ok := lp.Style["vocabulary_profile"].(map[string]interface{}); ok {
			raw = vp["catchphrases"]
		}
	}
	return toStringSlice(raw)
}

func toStringSlice(raw interface{}) []string {
	if raw == nil {
		return nil
	}
	switch v := raw.(type) {
	case []string:
		return v
	case []interface{}:
		var res []string
		for _, item := range v {
			if s, ok := item.(string); ok && strings.TrimSpace(s) != "" {
				res = append(res, strings.TrimSpace(s))
			}
		}
		return res
	default:
		return nil
	}
}

// GetSchedulerConfig extracts the distilled latency model and conversation rhythm
// from behavior.json to configure the scheduler with real observed timing.
// P0 Fix (Section 14): Connects active persona's behavior model directly to Runtime scheduler.
func (lp *LoadedPersona) GetSchedulerConfig() scheduler.Config {
	cfg := scheduler.Config{
		BaseDelayMs:       3000,
		MinDelayMs:        1500,
		MaxDelayMs:        8000,
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
		if bDelay > 8000 {
			bDelay = 8000
		} else if bDelay < 1500 {
			bDelay = 1500
		}
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
			if b.MedianMs > 8000 {
				b.MedianMs = 8000
			}
			if b.P90Ms > 12000 {
				b.P90Ms = 12000
			}
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

