// Auto-generated Supabase Database types.
// Do not edit manually. Re-generate using: npm run db:types
/* eslint-disable @typescript-eslint/no-empty-object-type */

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      _backup_agent_metrics_pre_elo_fix: {
        Row: {
          id: string | null
          run_id: string | null
          agent_name: string | null
          avg_elo: number | null
          elo_gain: number | null
          elo_per_dollar: number | null
        }
        Insert: {
          id?: string | null
          run_id?: string | null
          agent_name?: string | null
          avg_elo?: number | null
          elo_gain?: number | null
          elo_per_dollar?: number | null
        }
        Update: {
          id?: string | null
          run_id?: string | null
          agent_name?: string | null
          avg_elo?: number | null
          elo_gain?: number | null
          elo_per_dollar?: number | null
        }
        Relationships: [
        ]
      }
      admin_audit_log: {
        Row: {
          id: number
          admin_user_id: string
          action: string
          entity_type: string
          entity_id: string
          details: Json | null
          ip_address: string | null
          user_agent: string | null
          created_at: string
        }
        Insert: {
          id?: number
          admin_user_id: string
          action: string
          entity_type: string
          entity_id: string
          details?: Json | null
          ip_address?: string | null
          user_agent?: string | null
          created_at?: string
        }
        Update: {
          id?: number
          admin_user_id?: string
          action?: string
          entity_type?: string
          entity_id?: string
          details?: Json | null
          ip_address?: string | null
          user_agent?: string | null
          created_at?: string
        }
        Relationships: [
        ]
      }
      admin_users: {
        Row: {
          id: number
          user_id: string
          role: string
          created_at: string
          created_by: string | null
        }
        Insert: {
          id?: number
          user_id: string
          role?: string
          created_at?: string
          created_by?: string | null
        }
        Update: {
          id?: number
          user_id?: string
          role?: string
          created_at?: string
          created_by?: string | null
        }
        Relationships: [
        ]
      }
      article_heading_links: {
        Row: {
          id: number
          explanation_id: number | null
          heading_text: string
          heading_text_lower: string
          standalone_title: string
          created_at: string
        }
        Insert: {
          id?: number
          explanation_id?: number | null
          heading_text: string
          heading_text_lower: string
          standalone_title: string
          created_at?: string
        }
        Update: {
          id?: number
          explanation_id?: number | null
          heading_text?: string
          heading_text_lower?: string
          standalone_title?: string
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "article_heading_links_explanation_id_fkey"
            columns: ["explanation_id"]
            isOneToOne: false
            referencedRelation: "explanations"
            referencedColumns: ["id"]
          },
        ]
      }
      article_link_overrides: {
        Row: {
          id: number
          explanation_id: number | null
          term: string
          term_lower: string
          override_type: string
          custom_standalone_title: string | null
          created_at: string
        }
        Insert: {
          id?: number
          explanation_id?: number | null
          term: string
          term_lower: string
          override_type: string
          custom_standalone_title?: string | null
          created_at?: string
        }
        Update: {
          id?: number
          explanation_id?: number | null
          term?: string
          term_lower?: string
          override_type?: string
          custom_standalone_title?: string | null
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "article_link_overrides_explanation_id_fkey"
            columns: ["explanation_id"]
            isOneToOne: false
            referencedRelation: "explanations"
            referencedColumns: ["id"]
          },
        ]
      }
      article_sources: {
        Row: {
          id: number
          explanation_id: number
          source_cache_id: number
          position: number
          created_at: string
        }
        Insert: {
          id?: number
          explanation_id: number
          source_cache_id: number
          position: number
          created_at?: string
        }
        Update: {
          id?: number
          explanation_id?: number
          source_cache_id?: number
          position?: number
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "article_sources_explanation_id_fkey"
            columns: ["explanation_id"]
            isOneToOne: false
            referencedRelation: "explanations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "article_sources_source_cache_id_fkey"
            columns: ["source_cache_id"]
            isOneToOne: false
            referencedRelation: "source_cache"
            referencedColumns: ["id"]
          },
        ]
      }
      candidate_occurrences: {
        Row: {
          id: number
          candidate_id: number | null
          explanation_id: number | null
          occurrence_count: number
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: number
          candidate_id?: number | null
          explanation_id?: number | null
          occurrence_count?: number
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: number
          candidate_id?: number | null
          explanation_id?: number | null
          occurrence_count?: number
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "candidate_occurrences_candidate_id_fkey"
            columns: ["candidate_id"]
            isOneToOne: false
            referencedRelation: "link_candidates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "candidate_occurrences_explanation_id_fkey"
            columns: ["explanation_id"]
            isOneToOne: false
            referencedRelation: "explanations"
            referencedColumns: ["id"]
          },
        ]
      }
      content_reports: {
        Row: {
          id: number
          explanation_id: number
          reporter_id: string
          reason: string
          details: string | null
          status: string
          reviewed_by: string | null
          reviewed_at: string | null
          review_notes: string | null
          created_at: string
        }
        Insert: {
          id?: number
          explanation_id: number
          reporter_id: string
          reason: string
          details?: string | null
          status?: string
          reviewed_by?: string | null
          reviewed_at?: string | null
          review_notes?: string | null
          created_at?: string
        }
        Update: {
          id?: number
          explanation_id?: number
          reporter_id?: string
          reason?: string
          details?: string | null
          status?: string
          reviewed_by?: string | null
          reviewed_at?: string | null
          review_notes?: string | null
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "content_reports_explanation_id_fkey"
            columns: ["explanation_id"]
            isOneToOne: false
            referencedRelation: "explanations"
            referencedColumns: ["id"]
          },
        ]
      }
      daily_cost_rollups: {
        Row: {
          date: string
          category: string
          total_cost_usd: number
          reserved_usd: number
          call_count: number
        }
        Insert: {
          date: string
          category: string
          total_cost_usd?: number
          reserved_usd?: number
          call_count?: number
        }
        Update: {
          date?: string
          category?: string
          total_cost_usd?: number
          reserved_usd?: number
          call_count?: number
        }
        Relationships: [
        ]
      }
      evolution_agent_invocations: {
        Row: {
          id: string
          run_id: string
          agent_name: string
          iteration: number
          execution_order: number
          success: boolean
          skipped: boolean
          cost_usd: number | null
          execution_detail: Json | null
          error_message: string | null
          duration_ms: number | null
          created_at: string
        }
        Insert: {
          id?: string
          run_id: string
          agent_name: string
          iteration?: number
          execution_order?: number
          success?: boolean
          skipped?: boolean
          cost_usd?: number | null
          execution_detail?: Json | null
          error_message?: string | null
          duration_ms?: number | null
          created_at?: string
        }
        Update: {
          id?: string
          run_id?: string
          agent_name?: string
          iteration?: number
          execution_order?: number
          success?: boolean
          skipped?: boolean
          cost_usd?: number | null
          execution_detail?: Json | null
          error_message?: string | null
          duration_ms?: number | null
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "evolution_agent_invocations_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "evolution_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      evolution_arena_comparisons: {
        Row: {
          id: string
          prompt_id: string
          entry_a: string
          entry_b: string
          winner: string
          confidence: number
          run_id: string | null
          status: string
          created_at: string
        }
        Insert: {
          id?: string
          prompt_id: string
          entry_a: string
          entry_b: string
          winner: string
          confidence?: number
          run_id?: string | null
          status?: string
          created_at?: string
        }
        Update: {
          id?: string
          prompt_id?: string
          entry_a?: string
          entry_b?: string
          winner?: string
          confidence?: number
          run_id?: string | null
          status?: string
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "evolution_arena_comparisons_prompt_id_fkey"
            columns: ["prompt_id"]
            isOneToOne: false
            referencedRelation: "evolution_prompts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "evolution_arena_comparisons_entry_a_fkey"
            columns: ["entry_a"]
            isOneToOne: false
            referencedRelation: "evolution_variants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "evolution_arena_comparisons_entry_b_fkey"
            columns: ["entry_b"]
            isOneToOne: false
            referencedRelation: "evolution_variants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "evolution_arena_comparisons_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "evolution_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      evolution_experiments: {
        Row: {
          id: string
          name: string
          prompt_id: string | null
          status: string
          config: Json | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          name: string
          prompt_id?: string | null
          status?: string
          config?: Json | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          name?: string
          prompt_id?: string | null
          status?: string
          config?: Json | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "evolution_experiments_prompt_id_fkey"
            columns: ["prompt_id"]
            isOneToOne: false
            referencedRelation: "evolution_prompts"
            referencedColumns: ["id"]
          },
        ]
      }
      evolution_explanations: {
        Row: {
          id: string
          explanation_id: number | null
          prompt_id: string | null
          title: string
          content: string
          source: string
          created_at: string
        }
        Insert: {
          id?: string
          explanation_id?: number | null
          prompt_id?: string | null
          title: string
          content: string
          source: string
          created_at?: string
        }
        Update: {
          id?: string
          explanation_id?: number | null
          prompt_id?: string | null
          title?: string
          content?: string
          source?: string
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "evolution_explanations_explanation_id_fkey"
            columns: ["explanation_id"]
            isOneToOne: false
            referencedRelation: "explanations"
            referencedColumns: ["id"]
          },
        ]
      }
      evolution_logs: {
        Row: {
          id: number
          run_id: string | null
          created_at: string
          level: string
          agent_name: string | null
          iteration: number | null
          variant_id: string | null
          message: string
          context: Json | null
          entity_type: string
          entity_id: string
          experiment_id: string | null
          strategy_id: string | null
        }
        Insert: {
          id?: number
          run_id?: string | null
          created_at?: string
          level?: string
          agent_name?: string | null
          iteration?: number | null
          variant_id?: string | null
          message: string
          context?: Json | null
          entity_type?: string
          entity_id: string
          experiment_id?: string | null
          strategy_id?: string | null
        }
        Update: {
          id?: number
          run_id?: string | null
          created_at?: string
          level?: string
          agent_name?: string | null
          iteration?: number | null
          variant_id?: string | null
          message?: string
          context?: Json | null
          entity_type?: string
          entity_id?: string
          experiment_id?: string | null
          strategy_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "evolution_logs_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "evolution_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      evolution_metrics: {
        Row: {
          id: string
          entity_type: string
          entity_id: string
          metric_name: string
          value: number
          sigma: number | null
          ci_lower: number | null
          ci_upper: number | null
          n: number
          origin_entity_type: string | null
          origin_entity_id: string | null
          aggregation_method: string | null
          source: string | null
          stale: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          entity_type: string
          entity_id: string
          metric_name: string
          value: number
          sigma?: number | null
          ci_lower?: number | null
          ci_upper?: number | null
          n?: number
          origin_entity_type?: string | null
          origin_entity_id?: string | null
          aggregation_method?: string | null
          source?: string | null
          stale?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          entity_type?: string
          entity_id?: string
          metric_name?: string
          value?: number
          sigma?: number | null
          ci_lower?: number | null
          ci_upper?: number | null
          n?: number
          origin_entity_type?: string | null
          origin_entity_id?: string | null
          aggregation_method?: string | null
          source?: string | null
          stale?: boolean
          created_at?: string
          updated_at?: string
        }
        Relationships: [
        ]
      }
      evolution_prompts: {
        Row: {
          id: string
          prompt: string
          name: string
          status: string
          deleted_at: string | null
          archived_at: string | null
          created_at: string
        }
        Insert: {
          id?: string
          prompt: string
          name?: string
          status?: string
          deleted_at?: string | null
          archived_at?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          prompt?: string
          name?: string
          status?: string
          deleted_at?: string | null
          archived_at?: string | null
          created_at?: string
        }
        Relationships: [
        ]
      }
      evolution_run_logs: {
        Row: {
          id: number | null
          run_id: string | null
          created_at: string | null
          level: string | null
          agent_name: string | null
          iteration: number | null
          variant_id: string | null
          message: string | null
          context: Json | null
        }
        Insert: {
          id?: number | null
          run_id?: string | null
          created_at?: string | null
          level?: string | null
          agent_name?: string | null
          iteration?: number | null
          variant_id?: string | null
          message?: string | null
          context?: Json | null
        }
        Update: {
          id?: number | null
          run_id?: string | null
          created_at?: string | null
          level?: string | null
          agent_name?: string | null
          iteration?: number | null
          variant_id?: string | null
          message?: string | null
          context?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "evolution_run_logs_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "evolution_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      evolution_runs: {
        Row: {
          id: string
          explanation_id: number | null
          prompt_id: string | null
          experiment_id: string | null
          strategy_id: string
          status: string
          pipeline_version: string
          runner_id: string | null
          error_message: string | null
          run_summary: Json | null
          last_heartbeat: string | null
          archived: boolean
          created_at: string
          completed_at: string | null
          budget_cap_usd: number
        }
        Insert: {
          id?: string
          explanation_id?: number | null
          prompt_id?: string | null
          experiment_id?: string | null
          strategy_id: string
          status?: string
          pipeline_version?: string
          runner_id?: string | null
          error_message?: string | null
          run_summary?: Json | null
          last_heartbeat?: string | null
          archived?: boolean
          created_at?: string
          completed_at?: string | null
          budget_cap_usd?: number
        }
        Update: {
          id?: string
          explanation_id?: number | null
          prompt_id?: string | null
          experiment_id?: string | null
          strategy_id?: string
          status?: string
          pipeline_version?: string
          runner_id?: string | null
          error_message?: string | null
          run_summary?: Json | null
          last_heartbeat?: string | null
          archived?: boolean
          created_at?: string
          completed_at?: string | null
          budget_cap_usd?: number
        }
        Relationships: [
          {
            foreignKeyName: "evolution_runs_prompt_id_fkey"
            columns: ["prompt_id"]
            isOneToOne: false
            referencedRelation: "evolution_prompts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "evolution_runs_experiment_id_fkey"
            columns: ["experiment_id"]
            isOneToOne: false
            referencedRelation: "evolution_experiments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "evolution_runs_strategy_id_fkey"
            columns: ["strategy_id"]
            isOneToOne: false
            referencedRelation: "evolution_strategies"
            referencedColumns: ["id"]
          },
        ]
      }
      evolution_strategies: {
        Row: {
          id: string
          name: string
          label: string
          description: string | null
          config: Json
          config_hash: string
          is_predefined: boolean
          pipeline_type: string
          status: string
          created_by: string
          stddev_final_elo: number | null
          avg_elo_per_dollar: number | null
          first_used_at: string
          last_used_at: string
          created_at: string
        }
        Insert: {
          id?: string
          name: string
          label?: string
          description?: string | null
          config: Json
          config_hash: string
          is_predefined?: boolean
          pipeline_type?: string
          status?: string
          created_by?: string
          stddev_final_elo?: number | null
          avg_elo_per_dollar?: number | null
          first_used_at?: string
          last_used_at?: string
          created_at?: string
        }
        Update: {
          id?: string
          name?: string
          label?: string
          description?: string | null
          config?: Json
          config_hash?: string
          is_predefined?: boolean
          pipeline_type?: string
          status?: string
          created_by?: string
          stddev_final_elo?: number | null
          avg_elo_per_dollar?: number | null
          first_used_at?: string
          last_used_at?: string
          created_at?: string
        }
        Relationships: [
        ]
      }
      evolution_variants: {
        Row: {
          id: string
          run_id: string | null
          explanation_id: number | null
          variant_content: string
          elo_score: number
          generation: number
          parent_variant_id: string | null
          agent_name: string | null
          match_count: number
          is_winner: boolean
          created_at: string
          mu: number
          sigma: number
          prompt_id: string | null
          synced_to_arena: boolean
          arena_match_count: number
          generation_method: string
          model: string | null
          cost_usd: number | null
          archived_at: string | null
          evolution_explanation_id: string | null
        }
        Insert: {
          id?: string
          run_id?: string | null
          explanation_id?: number | null
          variant_content: string
          elo_score?: number
          generation?: number
          parent_variant_id?: string | null
          agent_name?: string | null
          match_count?: number
          is_winner?: boolean
          created_at?: string
          mu?: number
          sigma?: number
          prompt_id?: string | null
          synced_to_arena?: boolean
          arena_match_count?: number
          generation_method?: string
          model?: string | null
          cost_usd?: number | null
          archived_at?: string | null
          evolution_explanation_id?: string | null
        }
        Update: {
          id?: string
          run_id?: string | null
          explanation_id?: number | null
          variant_content?: string
          elo_score?: number
          generation?: number
          parent_variant_id?: string | null
          agent_name?: string | null
          match_count?: number
          is_winner?: boolean
          created_at?: string
          mu?: number
          sigma?: number
          prompt_id?: string | null
          synced_to_arena?: boolean
          arena_match_count?: number
          generation_method?: string
          model?: string | null
          cost_usd?: number | null
          archived_at?: string | null
          evolution_explanation_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "evolution_variants_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "evolution_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "evolution_variants_prompt_id_fkey"
            columns: ["prompt_id"]
            isOneToOne: false
            referencedRelation: "evolution_prompts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "evolution_variants_evolution_explanation_id_fkey"
            columns: ["evolution_explanation_id"]
            isOneToOne: false
            referencedRelation: "evolution_explanations"
            referencedColumns: ["id"]
          },
        ]
      }
      explanationMetrics: {
        Row: {
          id: number
          explanationid: number
          total_saves: number
          total_views: number
          save_rate: number
          last_updated: string
        }
        Insert: {
          id?: number
          explanationid: number
          total_saves?: number
          total_views?: number
          save_rate?: number
          last_updated?: string
        }
        Update: {
          id?: number
          explanationid?: number
          total_saves?: number
          total_views?: number
          save_rate?: number
          last_updated?: string
        }
        Relationships: [
        ]
      }
      explanation_tags: {
        Row: {
          id: number
          explanation_id: number
          tag_id: number
          created_at: string
          isDeleted: boolean
        }
        Insert: {
          id?: number
          explanation_id: number
          tag_id: number
          created_at?: string
          isDeleted?: boolean
        }
        Update: {
          id?: number
          explanation_id?: number
          tag_id?: number
          created_at?: string
          isDeleted?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "explanation_tags_tag_id_fkey"
            columns: ["tag_id"]
            isOneToOne: false
            referencedRelation: "tags"
            referencedColumns: ["id"]
          },
        ]
      }
      explanations: {
        Row: {
          id: number
          explanation_title: string
          content: string
          timestamp: string
          primary_topic_id: number
          secondary_topic_id: number | null
          status: string
          source: string | null
          summary_teaser: string | null
          meta_description: string | null
          keywords: string[] | null
          delete_status: string
          delete_status_changed_at: string | null
          delete_reason: string | null
          delete_source: string
          moderation_reviewed: boolean
          moderation_reviewed_by: string | null
          moderation_reviewed_at: string | null
          legal_hold: boolean
        }
        Insert: {
          id?: number
          explanation_title: string
          content: string
          timestamp?: string
          primary_topic_id: number
          secondary_topic_id?: number | null
          status?: string
          source?: string | null
          summary_teaser?: string | null
          meta_description?: string | null
          keywords?: string[] | null
          delete_status?: string
          delete_status_changed_at?: string | null
          delete_reason?: string | null
          delete_source?: string
          moderation_reviewed?: boolean
          moderation_reviewed_by?: string | null
          moderation_reviewed_at?: string | null
          legal_hold?: boolean
        }
        Update: {
          id?: number
          explanation_title?: string
          content?: string
          timestamp?: string
          primary_topic_id?: number
          secondary_topic_id?: number | null
          status?: string
          source?: string | null
          summary_teaser?: string | null
          meta_description?: string | null
          keywords?: string[] | null
          delete_status?: string
          delete_status_changed_at?: string | null
          delete_reason?: string | null
          delete_source?: string
          moderation_reviewed?: boolean
          moderation_reviewed_by?: string | null
          moderation_reviewed_at?: string | null
          legal_hold?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "explanations_primary_topic_id_fkey"
            columns: ["primary_topic_id"]
            isOneToOne: false
            referencedRelation: "topics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "explanations_secondary_topic_id_fkey"
            columns: ["secondary_topic_id"]
            isOneToOne: false
            referencedRelation: "topics"
            referencedColumns: ["id"]
          },
        ]
      }
      feature_flags: {
        Row: {
          id: number
          name: string
          enabled: boolean
          description: string | null
          updated_by: string | null
          updated_at: string
          created_at: string
        }
        Insert: {
          id?: number
          name: string
          enabled?: boolean
          description?: string | null
          updated_by?: string | null
          updated_at?: string
          created_at?: string
        }
        Update: {
          id?: number
          name?: string
          enabled?: boolean
          description?: string | null
          updated_by?: string | null
          updated_at?: string
          created_at?: string
        }
        Relationships: [
        ]
      }
      link_candidates: {
        Row: {
          id: number
          term: string
          term_lower: string
          source: string
          status: Database["public"]["Enums"]["candidate_status"]
          total_occurrences: number
          article_count: number
          first_seen_explanation_id: number | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: number
          term: string
          term_lower: string
          source?: string
          status?: Database["public"]["Enums"]["candidate_status"]
          total_occurrences?: number
          article_count?: number
          first_seen_explanation_id?: number | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: number
          term?: string
          term_lower?: string
          source?: string
          status?: Database["public"]["Enums"]["candidate_status"]
          total_occurrences?: number
          article_count?: number
          first_seen_explanation_id?: number | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "link_candidates_first_seen_explanation_id_fkey"
            columns: ["first_seen_explanation_id"]
            isOneToOne: false
            referencedRelation: "explanations"
            referencedColumns: ["id"]
          },
        ]
      }
      link_whitelist: {
        Row: {
          id: number
          canonical_term: string
          canonical_term_lower: string
          standalone_title: string
          description: string | null
          is_active: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: number
          canonical_term: string
          canonical_term_lower: string
          standalone_title: string
          description?: string | null
          is_active?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: number
          canonical_term?: string
          canonical_term_lower?: string
          standalone_title?: string
          description?: string | null
          is_active?: boolean
          created_at?: string
          updated_at?: string
        }
        Relationships: [
        ]
      }
      link_whitelist_aliases: {
        Row: {
          id: number
          whitelist_id: number | null
          alias_term: string
          alias_term_lower: string
          created_at: string
        }
        Insert: {
          id?: number
          whitelist_id?: number | null
          alias_term: string
          alias_term_lower: string
          created_at?: string
        }
        Update: {
          id?: number
          whitelist_id?: number | null
          alias_term?: string
          alias_term_lower?: string
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "link_whitelist_aliases_whitelist_id_fkey"
            columns: ["whitelist_id"]
            isOneToOne: false
            referencedRelation: "link_whitelist"
            referencedColumns: ["id"]
          },
        ]
      }
      link_whitelist_snapshot: {
        Row: {
          id: number
          version: number
          data: Json
          updated_at: string
        }
        Insert: {
          id?: number
          version?: number
          data: Json
          updated_at?: string
        }
        Update: {
          id?: number
          version?: number
          data?: Json
          updated_at?: string
        }
        Relationships: [
        ]
      }
      llmCallTracking: {
        Row: {
          id: number
          prompt: string
          call_source: string
          content: string
          raw_api_response: string
          model: string | null
          prompt_tokens: number | null
          completion_tokens: number | null
          total_tokens: number | null
          reasoning_tokens: number | null
          finish_reason: string | null
          created_at: string
          userid: string
          estimated_cost_usd: number | null
          evolution_invocation_id: string | null
        }
        Insert: {
          id?: number
          prompt: string
          call_source: string
          content: string
          raw_api_response: string
          model?: string | null
          prompt_tokens?: number | null
          completion_tokens?: number | null
          total_tokens?: number | null
          reasoning_tokens?: number | null
          finish_reason?: string | null
          created_at?: string
          userid: string
          estimated_cost_usd?: number | null
          evolution_invocation_id?: string | null
        }
        Update: {
          id?: number
          prompt?: string
          call_source?: string
          content?: string
          raw_api_response?: string
          model?: string | null
          prompt_tokens?: number | null
          completion_tokens?: number | null
          total_tokens?: number | null
          reasoning_tokens?: number | null
          finish_reason?: string | null
          created_at?: string
          userid?: string
          estimated_cost_usd?: number | null
          evolution_invocation_id?: string | null
        }
        Relationships: [
        ]
      }
      llm_cost_config: {
        Row: {
          key: string
          value: Json
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          key: string
          value: Json
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          key?: string
          value?: Json
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
        ]
      }
      source_cache: {
        Row: {
          id: number
          url: string
          url_hash: string | null
          title: string | null
          favicon_url: string | null
          domain: string
          extracted_text: string | null
          is_summarized: boolean
          original_length: number | null
          fetch_status: string
          error_message: string | null
          fetched_at: string | null
          expires_at: string | null
          created_at: string
        }
        Insert: {
          id?: number
          url: string
          url_hash?: string | null
          title?: string | null
          favicon_url?: string | null
          domain: string
          extracted_text?: string | null
          is_summarized?: boolean
          original_length?: number | null
          fetch_status?: string
          error_message?: string | null
          fetched_at?: string | null
          expires_at?: string | null
          created_at?: string
        }
        Update: {
          id?: number
          url?: string
          url_hash?: string | null
          title?: string | null
          favicon_url?: string | null
          domain?: string
          extracted_text?: string | null
          is_summarized?: boolean
          original_length?: number | null
          fetch_status?: string
          error_message?: string | null
          fetched_at?: string | null
          expires_at?: string | null
          created_at?: string
        }
        Relationships: [
        ]
      }
      tags: {
        Row: {
          id: number
          tag_name: string
          tag_description: string
          created_at: string
          presetTagId: number | null
        }
        Insert: {
          id?: number
          tag_name: string
          tag_description: string
          created_at?: string
          presetTagId?: number | null
        }
        Update: {
          id?: number
          tag_name?: string
          tag_description?: string
          created_at?: string
          presetTagId?: number | null
        }
        Relationships: [
        ]
      }
      testing_edits_pipeline: {
        Row: {
          id: number
          set_name: string
          step: string
          content: string
          session_id: string | null
          explanation_id: number | null
          explanation_title: string | null
          user_prompt: string | null
          source_content: string | null
          session_metadata: Json | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: number
          set_name: string
          step: string
          content: string
          session_id?: string | null
          explanation_id?: number | null
          explanation_title?: string | null
          user_prompt?: string | null
          source_content?: string | null
          session_metadata?: Json | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: number
          set_name?: string
          step?: string
          content?: string
          session_id?: string | null
          explanation_id?: number | null
          explanation_title?: string | null
          user_prompt?: string | null
          source_content?: string | null
          session_metadata?: Json | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
        ]
      }
      topics: {
        Row: {
          id: number
          topic_title: string
          topic_description: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: number
          topic_title: string
          topic_description?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: number
          topic_title?: string
          topic_description?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
        ]
      }
      userExplanationEvents: {
        Row: {
          id: number
          userid: string
          event_name: string
          explanationid: number
          value: number
          metadata: string
          created_at: string
        }
        Insert: {
          id?: number
          userid: string
          event_name: string
          explanationid: number
          value: number
          metadata: string
          created_at?: string
        }
        Update: {
          id?: number
          userid?: string
          event_name?: string
          explanationid?: number
          value?: number
          metadata?: string
          created_at?: string
        }
        Relationships: [
        ]
      }
      userLibrary: {
        Row: {
          id: number
          explanationid: number
          userid: string
          created: string
        }
        Insert: {
          id?: number
          explanationid: number
          userid: string
          created?: string
        }
        Update: {
          id?: number
          explanationid?: number
          userid?: string
          created?: string
        }
        Relationships: [
          {
            foreignKeyName: "userLibrary_explanationid_fkey"
            columns: ["explanationid"]
            isOneToOne: false
            referencedRelation: "explanations"
            referencedColumns: ["id"]
          },
        ]
      }
      userQueries: {
        Row: {
          id: number
          timestamp: string
          user_query: string
          created_at: string
          updated_at: string
          matches: Json
          explanation_id: number | null
          userid: string
          newExplanation: boolean
          userInputType: string | null
          allowedQuery: boolean | null
          previousExplanationViewedId: number | null
        }
        Insert: {
          id?: number
          timestamp?: string
          user_query: string
          created_at?: string
          updated_at?: string
          matches: Json
          explanation_id?: number | null
          userid: string
          newExplanation: boolean
          userInputType?: string | null
          allowedQuery?: boolean | null
          previousExplanationViewedId?: number | null
        }
        Update: {
          id?: number
          timestamp?: string
          user_query?: string
          created_at?: string
          updated_at?: string
          matches?: Json
          explanation_id?: number | null
          userid?: string
          newExplanation?: boolean
          userInputType?: string | null
          allowedQuery?: boolean | null
          previousExplanationViewedId?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "userQueries_explanation_id_fkey"
            columns: ["explanation_id"]
            isOneToOne: false
            referencedRelation: "explanations"
            referencedColumns: ["id"]
          },
        ]
      }
      user_profiles: {
        Row: {
          user_id: string
          display_name: string | null
          is_disabled: boolean
          disabled_at: string | null
          disabled_by: string | null
          disabled_reason: string | null
          admin_notes: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          user_id: string
          display_name?: string | null
          is_disabled?: boolean
          disabled_at?: string | null
          disabled_by?: string | null
          disabled_reason?: string | null
          admin_notes?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          user_id?: string
          display_name?: string | null
          is_disabled?: boolean
          disabled_at?: string | null
          disabled_by?: string | null
          disabled_reason?: string | null
          admin_notes?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
        ]
      }
    }
    Views: {
      daily_llm_costs: {
        Row: {
          date: string | null
          model: string | null
          userid: string | null
          call_count: number | null
          total_prompt_tokens: number | null
          total_completion_tokens: number | null
          total_reasoning_tokens: number | null
          total_tokens: number | null
          total_cost_usd: number | null
        }
        Relationships: [
        ]
      }
    }
    Functions: {
      get_source_citation_counts: {
        Args: {
          p_limit?: number
          p_period?: string
        }
        Returns: Json
      }
      claim_evolution_run: {
        Args: {
          p_max_concurrent?: number
          p_run_id?: string
          p_runner_id: string
        }
        Returns: Json
      }
      replace_explanation_sources: {
        Args: {
          p_explanation_id: number
          p_source_ids: number[]
        }
        Returns: Json
      }
      check_and_reserve_llm_budget: {
        Args: {
          p_category: string
          p_estimated_cost: number
        }
        Returns: Json
      }
      remove_and_renumber_source: {
        Args: {
          p_explanation_id: number
          p_source_cache_id: number
        }
        Returns: Json
      }
      complete_experiment_if_done: {
        Args: {
          p_completed_run_id: string
          p_experiment_id: string
        }
        Returns: Json
      }
      increment_explanation_saves: {
        Args: {
          p_explanation_id: number
        }
        Returns: Json
      }
      get_explanation_view_counts: {
        Args: {
          p_limit?: number
          p_period?: string
        }
        Returns: Json
      }
      cancel_experiment: {
        Args: {
          p_experiment_id: string
        }
        Returns: Json
      }
      sync_to_arena: {
        Args: {
          p_entries: Json
          p_matches: Json
          p_prompt_id: string
          p_run_id: string
        }
        Returns: Json
      }
      reorder_explanation_sources: {
        Args: {
          p_explanation_id: number
          p_source_ids: number[]
        }
        Returns: Json
      }
      increment_explanation_views: {
        Args: {
          p_explanation_id: number
        }
        Returns: Json
      }
      refresh_all_explanation_metrics: {
        Args: {
        }
        Returns: Json
      }
      refresh_explanation_metrics: {
        Args: {
          explanation_ids: number[]
        }
        Returns: Json
      }
      reconcile_llm_reservation: {
        Args: {
          p_category: string
          p_reserved: number
        }
        Returns: Json
      }
      update_strategy_aggregates: {
        Args: {
          p_cost_usd: number
          p_final_elo: number
          p_strategy_id: string
        }
        Returns: Json
      }
      reset_orphaned_reservations: {
        Args: {
        }
        Returns: Json
      }
      get_co_cited_sources: {
        Args: {
          p_limit?: number
          p_source_id: number
        }
        Returns: Json
      }
    }
    Enums: {
      candidate_status: "pending" | "approved" | "rejected"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type PublicSchema = Database[Extract<keyof Database, "public">]

export type Tables<
  PublicTableNameOrOptions extends
    | keyof (PublicSchema["Tables"] & PublicSchema["Views"])
    | { schema: keyof Database },
  TableName extends PublicTableNameOrOptions extends { schema: keyof Database }
    ? keyof (Database[PublicTableNameOrOptions["schema"]]["Tables"] &
        Database[PublicTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = PublicTableNameOrOptions extends { schema: keyof Database }
  ? (Database[PublicTableNameOrOptions["schema"]]["Tables"] &
      Database[PublicTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : PublicTableNameOrOptions extends keyof (PublicSchema["Tables"] &
        PublicSchema["Views"])
    ? (PublicSchema["Tables"] &
        PublicSchema["Views"])[PublicTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  PublicTableNameOrOptions extends
    | keyof PublicSchema["Tables"]
    | { schema: keyof Database },
  TableName extends PublicTableNameOrOptions extends { schema: keyof Database }
    ? keyof Database[PublicTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = PublicTableNameOrOptions extends { schema: keyof Database }
  ? Database[PublicTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : PublicTableNameOrOptions extends keyof PublicSchema["Tables"]
    ? PublicSchema["Tables"][PublicTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  PublicTableNameOrOptions extends
    | keyof PublicSchema["Tables"]
    | { schema: keyof Database },
  TableName extends PublicTableNameOrOptions extends { schema: keyof Database }
    ? keyof Database[PublicTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = PublicTableNameOrOptions extends { schema: keyof Database }
  ? Database[PublicTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : PublicTableNameOrOptions extends keyof PublicSchema["Tables"]
    ? PublicSchema["Tables"][PublicTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  PublicEnumNameOrOptions extends
    | keyof PublicSchema["Enums"]
    | { schema: keyof Database },
  EnumName extends PublicEnumNameOrOptions extends { schema: keyof Database }
    ? keyof Database[PublicEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = PublicEnumNameOrOptions extends { schema: keyof Database }
  ? Database[PublicEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : PublicEnumNameOrOptions extends keyof PublicSchema["Enums"]
    ? PublicSchema["Enums"][PublicEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof PublicSchema["CompositeTypes"]
    | { schema: keyof Database },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof Database
  }
    ? keyof Database[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends { schema: keyof Database }
  ? Database[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof PublicSchema["CompositeTypes"]
    ? PublicSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never
