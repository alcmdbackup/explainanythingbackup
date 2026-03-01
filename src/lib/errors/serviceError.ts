/**
 * ServiceError class for structured error propagation across services.
 * Extends Error with error codes, context, and optional details for debugging.
 */
import { ErrorCode, ERROR_CODES } from '@/lib/errorHandling';

export class ServiceError extends Error {
    readonly code: ErrorCode;
    readonly context: string;
    readonly details?: Record<string, unknown>;

    constructor(
        code: ErrorCode,
        message: string,
        context: string,
        options?: { details?: Record<string, unknown>; cause?: Error }
    ) {
        super(message, { cause: options?.cause });
        this.code = code;
        this.context = context;
        this.details = options?.details;
        this.name = 'ServiceError';
    }
}

export class GlobalBudgetExceededError extends ServiceError {
    constructor(message: string, details?: Record<string, unknown>) {
        super(ERROR_CODES.GLOBAL_BUDGET_EXCEEDED, message, 'LLMSpendingGate', { details });
        this.name = 'GlobalBudgetExceededError';
    }
}

export class LLMKillSwitchError extends ServiceError {
    constructor() {
        super(ERROR_CODES.LLM_KILL_SWITCH, 'LLM kill switch is enabled — all LLM calls are blocked', 'LLMSpendingGate');
        this.name = 'LLMKillSwitchError';
    }
}
