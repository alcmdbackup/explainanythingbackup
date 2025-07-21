'use server'

import { createSupabaseServerClient } from '@/lib/utils/supabase/server';
import { userExplanationEventsSchema, type UserExplanationEventsType } from '@/lib/schemas/schemas';

/**
 * Service for tracking user events related to explanations in Supabase
 * 
 * Example usage:
 * ```typescript
 * // Track an explanation view event
 * const event = await createUserExplanationEvent({ 
 *   event_name: "explanation_viewed",
 *   userid: "user123",
 *   explanationid: 456,
 *   value: 1,
 *   metadata: "{\"duration_seconds\": 30, \"source\": \"search\"}"
 * });
 * ```
 */

/**
 * Creates a new user explanation event record in the database
 * • Validates input data against userExplanationEventsSchema before insertion
 * • Inserts validated event data into userExplanationEvents table
 * • Returns the created record with database-generated fields
 * • Provides detailed error logging for debugging failed insertions
 * • Used by analytics and tracking functions to record user interactions
 */
export async function createUserExplanationEvent(eventData: UserExplanationEventsType): Promise<UserExplanationEventsType> {
  const supabase = await createSupabaseServerClient();
  
  // Validate input data against schema
  const validationResult = userExplanationEventsSchema.safeParse(eventData);
  if (!validationResult.success) {
    console.error('Invalid event data:', validationResult.error);
    throw new Error(`Invalid event data: ${validationResult.error.message}`);
  }
  
  console.log('Creating user explanation event with data:', eventData);
  console.log('validationResult.data contents:', JSON.stringify(validationResult.data, null, 2));
  
  const { data, error } = await supabase
    .from('userExplanationEvents')
    .insert(validationResult.data)
    .select()
    .single();

  if (error) {
    console.error('Error creating user explanation event:', error);
    console.error('Error details:', {
      message: error.message,
      details: error.details,
      hint: error.hint,
      code: error.code
    });
    throw error;
  }
  
  console.log('Successfully created user explanation event:', data);
  return data;
} 