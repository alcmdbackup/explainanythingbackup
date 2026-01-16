import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

// Merges Tailwind classes intelligently, resolving conflicts like 'p-2 p-4' to 'p-4'
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
