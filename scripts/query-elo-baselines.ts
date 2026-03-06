/**
 * Query baseline Elo/dollar metrics for Phase 1 of Elo budget optimization.
 * Runs SQL queries against arena and llmCallTracking tables.
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

async function queryMethodEffectiveness() {
  console.log('\n=== Method Effectiveness (Elo/Dollar) ===\n');

  // Query evolution_arena_entries joined with evolution_arena_elo
  const { data, error } = await supabase
    .from('evolution_arena_entries')
    .select(`
      id,
      generation_method,
      model,
      total_cost_usd,
      evolution_arena_elo!inner (
        elo_rating,
        elo_per_dollar
      )
    `)
    .is('deleted_at', null);

  if (error) {
    console.error('Error querying arena:', error.message);
    return;
  }

  if (!data || data.length === 0) {
    console.log('No Arena entries found. Run scripts/run-prompt-bank.ts first.');
    return;
  }

  // Aggregate by generation_method and model
  const byMethodModel = new Map<string, {
    count: number;
    totalElo: number;
    totalCost: number;
    totalEloPerDollar: number;
    validEpdCount: number;
  }>();

  for (const entry of data) {
    const key = `${entry.generation_method}|${entry.model}`;
    const existing = byMethodModel.get(key) ?? {
      count: 0,
      totalElo: 0,
      totalCost: 0,
      totalEloPerDollar: 0,
      validEpdCount: 0,
    };

    const eloData = Array.isArray(entry.evolution_arena_elo)
      ? entry.evolution_arena_elo[0]
      : entry.evolution_arena_elo;

    existing.count++;
    existing.totalElo += eloData?.elo_rating ?? 1200;
    existing.totalCost += entry.total_cost_usd ?? 0;
    if (eloData?.elo_per_dollar) {
      existing.totalEloPerDollar += eloData.elo_per_dollar;
      existing.validEpdCount++;
    }

    byMethodModel.set(key, existing);
  }

  // Format results
  const results = Array.from(byMethodModel.entries())
    .map(([key, stats]) => {
      const [method, model] = key.split('|');
      return {
        method,
        model,
        count: stats.count,
        avgElo: (stats.totalElo / stats.count).toFixed(1),
        avgCost: (stats.totalCost / stats.count).toFixed(4),
        avgEloPerDollar: stats.validEpdCount > 0
          ? (stats.totalEloPerDollar / stats.validEpdCount).toFixed(1)
          : 'N/A',
      };
    })
    .sort((a, b) => {
      const aEpd = parseFloat(a.avgEloPerDollar) || 0;
      const bEpd = parseFloat(b.avgEloPerDollar) || 0;
      return bEpd - aEpd;
    });

  console.table(results);
  return results;
}

async function queryAgentCosts() {
  console.log('\n=== Agent Costs (from llmCallTracking) ===\n');

  // Query llmCallTracking for evolution-related calls
  const { data, error } = await supabase
    .from('llmCallTracking')
    .select('call_source, model, prompt_tokens, completion_tokens, estimated_cost_usd')
    .like('call_source', 'evolution_%')
    .gte('created_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString());

  if (error) {
    console.error('Error querying llmCallTracking:', error.message);
    return;
  }

  if (!data || data.length === 0) {
    console.log('No evolution LLM calls found in last 30 days.');
    console.log('Run some evolution pipelines first to collect baseline data.');
    return;
  }

  // Aggregate by agent and model
  const byAgentModel = new Map<string, {
    calls: number;
    totalPromptTokens: number;
    totalCompletionTokens: number;
    totalCost: number;
  }>();

  for (const row of data) {
    const agent = row.call_source?.replace('evolution_', '') ?? 'unknown';
    const key = `${agent}|${row.model}`;
    const existing = byAgentModel.get(key) ?? {
      calls: 0,
      totalPromptTokens: 0,
      totalCompletionTokens: 0,
      totalCost: 0,
    };

    existing.calls++;
    existing.totalPromptTokens += row.prompt_tokens ?? 0;
    existing.totalCompletionTokens += row.completion_tokens ?? 0;
    existing.totalCost += row.estimated_cost_usd ?? 0;

    byAgentModel.set(key, existing);
  }

  // Format results
  const results = Array.from(byAgentModel.entries())
    .map(([key, stats]) => {
      const [agent, model] = key.split('|');
      return {
        agent,
        model,
        calls: stats.calls,
        avgPromptTokens: Math.round(stats.totalPromptTokens / stats.calls),
        avgCompletionTokens: Math.round(stats.totalCompletionTokens / stats.calls),
        avgCostUsd: (stats.totalCost / stats.calls).toFixed(6),
        totalCostUsd: stats.totalCost.toFixed(4),
      };
    })
    .sort((a, b) => parseFloat(b.totalCostUsd) - parseFloat(a.totalCostUsd));

  console.table(results);
  return results;
}

async function main() {
  console.log('Phase 1: Establishing Baselines\n');
  console.log('Querying existing data from arena and llmCallTracking...');

  const methodResults = await queryMethodEffectiveness();
  const agentResults = await queryAgentCosts();

  // Summary
  console.log('\n=== Summary ===\n');
  if (methodResults && methodResults.length > 0) {
    console.log(`Found ${methodResults.length} method/model combinations in arena`);
    const bestMethod = methodResults[0];
    if (bestMethod.avgEloPerDollar !== 'N/A') {
      console.log(`Best Elo/dollar: ${bestMethod.method} with ${bestMethod.model} (${bestMethod.avgEloPerDollar} Elo/$)`);
    }
  } else {
    console.log('No Arena data available for baseline.');
  }

  if (agentResults && agentResults.length > 0) {
    console.log(`Found ${agentResults.length} agent/model combinations in llmCallTracking`);
    const totalCost = agentResults.reduce((sum, r) => sum + parseFloat(r.totalCostUsd), 0);
    console.log(`Total evolution cost in last 30 days: $${totalCost.toFixed(4)}`);
  } else {
    console.log('No llmCallTracking data available for agent cost baseline.');
  }

  console.log('\nPhase 1 complete. Proceed to Phase 2 for cost attribution instrumentation.');
}

main().catch(console.error);
