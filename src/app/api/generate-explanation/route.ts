import { NextRequest } from 'next/server';
import { MatchMode, UserInputType } from '@/lib/schemas/schemas';
import { generateExplanationLogic } from '@/lib/services/generateExplanation';

export async function POST(request: NextRequest) {
    try {
        const { userInput, savedId, matchMode, userid, userInputType } = await request.json();
        
        // Validate required parameters
        if (!userInput || !userid) {
            return Response.json(
                { error: 'Missing required parameters: userInput and userid are required' },
                { status: 400 }
            );
        }

        // Set defaults for optional parameters
        const finalSavedId = savedId ?? null;
        const finalMatchMode = matchMode ?? MatchMode.Normal;
        const finalUserInputType = userInputType ?? UserInputType.Query;

        const result = await generateExplanationLogic(
            userInput,
            finalSavedId,
            finalMatchMode,
            userid,
            finalUserInputType
        );

        // Return the result with appropriate status code
        const statusCode = result.error ? 400 : 200;
        return Response.json(result, { status: statusCode });

    } catch (error) {
        console.error('Error in generate-explanation API:', error);
        return Response.json(
            { error: 'Internal server error' },
            { status: 500 }
        );
    }
}