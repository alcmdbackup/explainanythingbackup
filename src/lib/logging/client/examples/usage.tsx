// src/lib/logging/client/examples/usage.tsx
'use client';

import React, { FormEvent, useCallback } from 'react';
import { createSafeEventHandler, createSafeAsyncFunction, withComponentLogging, logUserAction } from '../safeUserCodeWrapper';

// Example 1: Safe Event Handler Wrapping
export const MyForm = () => {
  // User explicitly wraps their event handlers
  const handleSubmit = createSafeEventHandler(
    async (event: FormEvent) => {
      event.preventDefault();

      // User business logic that gets logged safely
      const formData = new FormData(event.target as HTMLFormElement);
      await submitForm(formData);

      // Manual user action logging
      logUserAction('form_submitted', {
        formType: 'contact',
        fields: formData.keys()
      });
    },
    'handleSubmit'
  );

  const handleReset = createSafeEventHandler(
    () => {
      // User code that gets logged safely
      document.getElementById('myForm')?.reset();
      logUserAction('form_reset', { formType: 'contact' });
    },
    'handleReset'
  );

  return (
    <form id="myForm" onSubmit={handleSubmit}>
      <input name="email" type="email" required />
      <input name="message" type="text" required />
      <button type="submit">Submit</button>
      <button type="button" onClick={handleReset}>Reset</button>
    </form>
  );
};

// Example 2: Safe Async Function Wrapping
export const DataProcessor = () => {
  // User explicitly wraps their async operations
  const fetchUserData = createSafeAsyncFunction(
    async (userId: string) => {
      // User business logic that gets logged safely
      const response = await fetch(`/api/users/${userId}`);
      const userData = await response.json();
      return userData;
    },
    'fetchUserData'
  );

  const processData = createSafeAsyncFunction(
    async (data: any[]) => {
      // User code that gets logged safely
      const processed = data.map(item => ({
        ...item,
        processed: true,
        timestamp: Date.now()
      }));

      logUserAction('data_processed', {
        itemCount: data.length,
        processingTime: Date.now()
      });

      return processed;
    },
    'processData'
  );

  const handleFetchAndProcess = useCallback(async () => {
    try {
      const userData = await fetchUserData('123');
      const processedData = await processData(userData);

      // Manual logging for complex workflows
      logUserAction('fetch_and_process_completed', {
        userId: '123',
        resultCount: processedData.length
      });

      return processedData;
    } catch (error) {
      logUserAction('fetch_and_process_failed', {
        userId: '123',
        error: error.message
      });
      throw error;
    }
  }, []);

  return (
    <div>
      <button onClick={handleFetchAndProcess}>
        Fetch and Process Data
      </button>
    </div>
  );
};

// Example 3: Component-Level Logging (Optional)
export const MyComponent = withComponentLogging(() => {
  // Only the top-level component render gets logged
  // Internal React operations are NOT logged

  const handleClick = createSafeEventHandler(
    () => {
      // User code that gets logged safely
      logUserAction('button_clicked', { component: 'MyComponent' });
    },
    'handleClick'
  );

  return (
    <div>
      <h1>My Component</h1>
      <button onClick={handleClick}>Click Me</button>
    </div>
  );
}, 'MyComponent');

// Example 4: Business Logic Only (RECOMMENDED)
export const UserActions = {
  // SAFE: Only business logic gets wrapped
  submitFormAction: createSafeAsyncFunction(
    async (formData: FormData) => {
      // This is pure business logic - worth logging
      const validated = await validateForm(formData);
      const result = await saveUser(validated);

      logUserAction('user_created', {
        userId: result.id,
        source: 'form_submission'
      });

      return result;
    },
    'submitFormAction'
  ),

  deleteUserAction: createSafeAsyncFunction(
    async (userId: string) => {
      // Business logic that gets logged safely
      await deleteUser(userId);

      logUserAction('user_deleted', { userId });
    },
    'deleteUserAction'
  )
};

// Helper functions (NOT logged - just utilities)
async function submitForm(formData: FormData) {
  // Internal implementation - not logged
  return fetch('/api/submit', {
    method: 'POST',
    body: formData
  });
}

async function validateForm(formData: FormData) {
  // Validation logic - not logged
  const email = formData.get('email');
  if (!email) throw new Error('Email required');
  return { email };
}

async function saveUser(userData: any) {
  // Database operation - not logged
  return fetch('/api/users', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(userData)
  }).then(r => r.json());
}

async function deleteUser(userId: string) {
  // Database operation - not logged
  return fetch(`/api/users/${userId}`, {
    method: 'DELETE'
  });
}

// NEVER automatically wrapped:
// - Promise.prototype.then ❌
// - setTimeout/setInterval ❌
// - addEventListener ❌
// - Array.prototype.map ❌
// - React hooks (useState, useEffect) ❌
// - Browser APIs (fetch, console) ❌