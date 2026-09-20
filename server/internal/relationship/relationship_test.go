package relationship_test

import (
	"testing"
	"time"

	"eidolon/server/internal/relationship"
)

func TestRelationship_BaselineAndPerception(t *testing.T) {
	engine := relationship.NewEngine()
	state := engine.GetOrCreateState("session_1", "user_1")

	if state.Relationship.Phase != relationship.PhaseNormal {
		t.Fatalf("Expected PhaseNormal, got %s", state.Relationship.Phase)
	}

	// 1. Test Apology Perception
	pApology := engine.Perceive("真的非常对不起，我之前态度不好", nil)
	if pApology.Intent != "apology" {
		t.Errorf("Expected intent 'apology', got '%s'", pApology.Intent)
	}
	if pApology.ApologyStrength < 0.8 {
		t.Errorf("Expected high apology strength, got %f", pApology.ApologyStrength)
	}

	// 2. Test Complaint Perception
	pComplaint := engine.Perceive("你怎么又不理我了？", nil)
	if pComplaint.Intent != "complaint" {
		t.Errorf("Expected intent 'complaint', got '%s'", pComplaint.Intent)
	}
	if pComplaint.Affection <= 0 {
		t.Errorf("Expected positive affection on attachment-seeking complaint, got %f", pComplaint.Affection)
	}

	// 3. Test Provocation Perception
	pProvoke := engine.Perceive("你真的有病吧，烦死了", nil)
	if pProvoke.Intent != "provocation" {
		t.Errorf("Expected intent 'provocation', got '%s'", pProvoke.Intent)
	}
	if pProvoke.Sentiment >= 0 {
		t.Errorf("Expected negative sentiment on provocation, got %f", pProvoke.Sentiment)
	}
}

func TestRelationship_ConflictAndDecay(t *testing.T) {
	engine := relationship.NewEngine()
	state := engine.GetOrCreateState("session_2", "user_2")

	// Apply severe provocation
	p1 := engine.Perceive("闭嘴，你真的很恶心，滚远点", nil)
	engine.Step(state, p1)

	if state.Relationship.Irritation <= 0.2 {
		t.Errorf("Expected increased irritation, got %f", state.Relationship.Irritation)
	}
	if state.Relationship.Hurt <= 0.2 {
		t.Errorf("Expected increased hurt, got %f", state.Relationship.Hurt)
	}

	// Another provocation escalates into COLD or CONFLICT
	p2 := engine.Perceive("快滚，受够你了", nil)
	engine.Step(state, p2)

	plan := engine.PlanResponse(state, p2)
	if plan.ColdnessScore < 0.3 {
		t.Errorf("Expected coldness score > 0.3, got %f", plan.ColdnessScore)
	}
	if plan.Warmth > 0.4 {
		t.Errorf("Expected reduced warmth under conflict, got %f", plan.Warmth)
	}

	// Simulate temporal decay: fast forward 12 hours
	state.Relationship.LastInteraction = time.Now().UTC().Add(-12 * time.Hour)
	initIrritation := state.Relationship.Irritation

	engine.Step(state, relationship.PerceptionResult{Intent: "chat", Sentiment: 0.1})
	if state.Relationship.Irritation >= initIrritation {
		t.Errorf("Expected irritation to decay after 12h, before=%f after=%f", initIrritation, state.Relationship.Irritation)
	}
}

func TestRelationship_ApologyAndReconciliation(t *testing.T) {
	engine := relationship.NewEngine()
	state := engine.GetOrCreateState("session_3", "user_3")

	// Force into conflict state
	state.Relationship.Phase = relationship.PhaseConflict
	state.Relationship.Hurt = 0.8
	state.Relationship.Irritation = 0.7
	state.Relationship.Trust = 0.4

	// User apologizes sincerely
	pApol := engine.Perceive("对不起，我之前太冲动了，真的很抱歉", nil)
	engine.Step(state, pApol)

	// Hurt should decrease by at least 30% per reconciliation formula
	if state.Relationship.Hurt > 0.6 {
		t.Errorf("Expected hurt to significantly reduce after apology, got %f", state.Relationship.Hurt)
	}
	// Trust should increase
	if state.Relationship.Trust <= 0.4 {
		t.Errorf("Expected trust to improve after apology, got %f", state.Relationship.Trust)
	}
	// Phase should transition to RECOVERING rather than jumping straight to NORMAL
	if state.Relationship.Phase != relationship.PhaseRecovering {
		t.Errorf("Expected transition to PhaseRecovering, got %s", state.Relationship.Phase)
	}
}

func TestRelationship_Serialization(t *testing.T) {
	engine := relationship.NewEngine()
	state := engine.GetOrCreateState("session_4", "user_4")
	state.Relationship.Warmth = 0.88
	state.Relationship.Phase = relationship.PhaseWarm

	serialized, err := state.Serialize()
	if err != nil {
		t.Fatalf("Serialization failed: %v", err)
	}

	deserialized, err := relationship.DeserializeState(serialized)
	if err != nil {
		t.Fatalf("Deserialization failed: %v", err)
	}

	if deserialized.Relationship.Phase != relationship.PhaseWarm {
		t.Errorf("Expected PhaseWarm, got %s", deserialized.Relationship.Phase)
	}
	if deserialized.Relationship.Warmth != 0.88 {
		t.Errorf("Expected Warmth 0.88, got %f", deserialized.Relationship.Warmth)
	}
}
