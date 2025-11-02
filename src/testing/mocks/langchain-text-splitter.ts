// Mock for langchain/text_splitter to avoid ReadableStream issues in tests

export class RecursiveCharacterTextSplitter {
    constructor(_config?: unknown) {
        // Mock constructor
    }

    async splitText(_text: string): Promise<string[]> {
        return [];
    }
}
