// Mock for openai/helpers/zod
export const zodResponseFormat = jest.fn((schema: any, name: string) => ({
  type: 'json_schema',
  json_schema: {
    name: name,
    schema: schema
  }
}));