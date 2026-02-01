// Jest mock for d3-dag — stubs for Sugiyama layout.
export const dagStratify = jest.fn().mockReturnValue({
  id: jest.fn().mockReturnThis(),
  parentIds: jest.fn().mockReturnThis(),
});

export const sugiyama = jest.fn().mockReturnValue({
  nodeSize: jest.fn().mockReturnThis(),
  layering: jest.fn().mockReturnThis(),
  decross: jest.fn().mockReturnThis(),
  coord: jest.fn().mockReturnThis(),
});
