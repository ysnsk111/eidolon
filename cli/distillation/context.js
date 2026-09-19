import fs from 'node:fs';

/**
 * EIDOLON Layer 6: Context Supplement & World Model
 * Implements Section 8 & Section 15 of the specification.
 * Strictly distinguishes historical conversation from supplied context.
 */

export async function buildWorldModel(contextFilePath, messages, turns, llmProvider = null) {
  let suppliedContextText = '';
  const suppliedFacts = [];

  // 1. Ingest supplementary context file if provided
  if (contextFilePath && fs.existsSync(contextFilePath)) {
    suppliedContextText = fs.readFileSync(contextFilePath, 'utf-8');
    parseSuppliedContext(suppliedContextText, suppliedFacts);
  }

  // 2. Extract entities, relationships, timeline events from conversation
  const conversationalFacts = extractFactsFromMessages(messages);

  // 3. If LLM provider is available, use LLM extraction for deeper entity/relationship mining
  let entities = [];
  let relationships = [];
  let timeline = [];

  if (llmProvider && (suppliedContextText || turns.length > 0)) {
    try {
      const summaryContext = `Supplied Background:
${suppliedContextText || 'None provided'}

Conversation Samples:
${turns.slice(0, 15).map((t) => `${t.context.map((c) => `${c.sender}: ${c.content}`).join('\n')}\n-> Target: ${t.target_message}`).join('\n---\n')}`;

      const instructions = `Extract world model graph:
Return JSON:
{
  "entities": [{ "id": string, "name": string, "type": "person"|"location"|"organization"|"item"|"concept", "description": string, "source": "supplied_context"|"historical_conversation" }],
  "relationships": [{ "source_entity": string, "relation": string, "target_entity": string, "temporal_state": "past"|"present"|"ongoing", "provenance": "supplied_context"|"historical_conversation" }],
  "timeline": [{ "event_id": string, "date_or_period": string, "title": string, "description": string, "impact": string, "provenance": "supplied_context"|"historical_conversation" }]
}`;

      const graph = await llmProvider.extract(summaryContext, instructions, { timeoutMs: 30000 });
      if (graph && graph.entities && graph.relationships) {
        entities = graph.entities;
        relationships = graph.relationships;
        timeline = graph.timeline || [];
      }
    } catch (_) {
      // Fallback to heuristic graph
    }
  }

  // Heuristic graph construction if LLM didn't populate
  if (entities.length === 0) {
    entities = buildHeuristicEntities(suppliedFacts, messages);
    relationships = buildHeuristicRelationships(suppliedFacts, messages);
    timeline = buildHeuristicTimeline(suppliedFacts, messages);
  }

  return {
    supplied_context_summary: suppliedContextText.trim() ? 'Included' : 'None',
    raw_supplied_context: suppliedContextText,
    entities,
    relationships,
    timeline,
    provenance_summary: {
      supplied_facts_count: suppliedFacts.length,
      conversational_facts_count: conversationalFacts.length,
      strict_provenance_enforced: true,
    },
  };
}

function parseSuppliedContext(text, factsList) {
  const lines = text.split(/\r?\n/);
  let currentSection = 'General';

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    if (trimmed.startsWith('#')) {
      currentSection = trimmed.replace(/^#+\s*/, '');
      continue;
    }

    const colonIdx = trimmed.indexOf(':') !== -1 ? trimmed.indexOf(':') : trimmed.indexOf('：');
    if (colonIdx !== -1) {
      const key = trimmed.slice(0, colonIdx).trim();
      const val = trimmed.slice(colonIdx + 1).trim();
      factsList.push({
        section: currentSection,
        key,
        value: val,
        source: 'supplied_context',
      });
    } else {
      factsList.push({
        section: currentSection,
        key: 'note',
        value: trimmed,
        source: 'supplied_context',
      });
    }
  }
}

function extractFactsFromMessages(messages) {
  const facts = [];
  const keywordPatterns = [
    { key: 'school', regex: /(学校|大学|高中|初中|同校|学妹|学长|同班|上课|下课)/ },
    { key: 'location', regex: /(北京|上海|广州|深圳|图书馆|食堂|宿舍|操场|教室|自习室)/ },
    { key: 'hobby', regex: /(喜欢|爱吃|听歌|打游戏|看电影|跑步|睡觉|猫|狗)/ },
    { key: 'emotion', regex: /(开心|难过|生气|烦|好累|想哭|太棒了)/ },
  ];

  for (const msg of messages) {
    for (const pat of keywordPatterns) {
      if (pat.regex.test(msg.content)) {
        facts.push({
          category: pat.key,
          snippet: msg.content,
          sender: msg.sender,
          timestamp: msg.timestamp,
          source: 'historical_conversation',
        });
        break;
      }
    }
  }
  return facts;
}

function buildHeuristicEntities(suppliedFacts, messages) {
  const entities = [];
  // Add speakers
  const speakers = Array.from(new Set(messages.map((m) => m.sender)));
  for (const s of speakers) {
    entities.push({
      id: `entity_${s.toLowerCase().replace(/[^a-z0-9]/g, '_')}`,
      name: s,
      type: 'person',
      description: 'Conversation participant',
      source: 'historical_conversation',
    });
  }

  // Add supplied entities
  for (const f of suppliedFacts) {
    if (['学校', '地区', '国家', 'World', 'Environment'].some((k) => f.key.includes(k) || f.section.includes(k))) {
      entities.push({
        id: `entity_${f.key.toLowerCase().replace(/[^a-z0-9]/g, '_')}`,
        name: f.value || f.key,
        type: 'location',
        description: `${f.section}: ${f.key}`,
        source: 'supplied_context',
      });
    }
  }

  return entities;
}

function buildHeuristicRelationships(suppliedFacts, messages) {
  const rels = [];
  const speakers = Array.from(new Set(messages.map((m) => m.sender)));

  if (speakers.length >= 2) {
    rels.push({
      source_entity: speakers[0],
      relation: 'interacts_with',
      target_entity: speakers[1],
      temporal_state: 'ongoing',
      provenance: 'historical_conversation',
    });
  }

  for (const f of suppliedFacts) {
    if (f.key.includes('关系') || f.section.includes('关系')) {
      rels.push({
        source_entity: speakers[0] || 'User',
        relation: f.value,
        target_entity: speakers[1] || 'Target',
        temporal_state: 'defined_in_context',
        provenance: 'supplied_context',
      });
    }
  }

  return rels;
}

function buildHeuristicTimeline(suppliedFacts, messages) {
  const timeline = [];
  if (messages.length > 0) {
    timeline.push({
      event_id: 'evt_first_chat',
      date_or_period: messages[0].timestamp,
      title: 'First Recorded Conversation',
      description: `First message initiated by ${messages[0].sender}`,
      impact: 'Establishes initial conversational rapport',
      provenance: 'historical_conversation',
    });
    timeline.push({
      event_id: 'evt_latest_chat',
      date_or_period: messages[messages.length - 1].timestamp,
      title: 'Latest Conversation Milestone',
      description: `Latest interaction recorded`,
      impact: 'Current conversation checkpoint',
      provenance: 'historical_conversation',
    });
  }

  for (const f of suppliedFacts) {
    if (f.key.includes('时间') || f.key.includes('认识') || f.key.includes('事件')) {
      timeline.push({
        event_id: `evt_ctx_${timeline.length + 1}`,
        date_or_period: 'Supplied Backstory',
        title: f.key,
        description: f.value,
        impact: 'Defines historical background',
        provenance: 'supplied_context',
      });
    }
  }

  return timeline;
}
