import { formatDistanceToNow, format, isToday, isYesterday } from 'date-fns';

/**
 * Formats a date as a user-friendly string for UI display.
 * - Returns 'X minutes/hours ago' for recent dates.
 * - Returns 'Yesterday' for dates within the last day.
 * - Returns 'MMM d, yyyy, h:mm a' for older dates.
 * - Used by UI components to display explanation timestamps.
 * - Calls date-fns helpers for formatting logic.
 */
export function formatUserFriendlyDate(dateInput: string | Date): string {
  const date = typeof dateInput === 'string' ? new Date(dateInput) : dateInput;
  if (isNaN(date.getTime())) return '';

  if (isToday(date)) {
    // Less than 1 hour ago: 'X minutes ago', else 'Today, h:mm a'
    const diffMinutes = Math.floor((Date.now() - date.getTime()) / 60000);
    if (diffMinutes < 60) {
      return formatDistanceToNow(date, { addSuffix: true });
    }
    return `Today, ${format(date, 'h:mm a')}`;
  }
  if (isYesterday(date)) {
    return `Yesterday, ${format(date, 'h:mm a')}`;
  }
  return format(date, 'MMM d, yyyy, h:mm a');
} 