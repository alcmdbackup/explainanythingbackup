export const mockPineconeIndex = {
  namespace: jest.fn().mockReturnThis(),
  upsert: jest.fn().mockResolvedValue({ upsertedCount: 1 }),
  query: jest.fn().mockResolvedValue({
    matches: [
      {
        id: 'test-id-1',
        score: 0.95,
        values: [],
        metadata: {
          text: 'Test match 1',
        },
      },
    ],
  }),
  deleteOne: jest.fn().mockResolvedValue({}),
  deleteMany: jest.fn().mockResolvedValue({}),
  deleteAll: jest.fn().mockResolvedValue({}),
};

export const mockPinecone = {
  index: jest.fn().mockReturnValue(mockPineconeIndex),
};

export class Pinecone {
  index = mockPinecone.index;
}