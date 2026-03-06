/**
 * ServiceError class for structured error propagation across services.
 * Extends Error with error codes, context, and optional details for debugging.
 */
import { ErrorCode } from '@/lib/errorHandling';

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
