// Jest mock for d3 — stubs for D3's fluent chaining API.
const chain = () => ({
  select: jest.fn().mockReturnThis(),
  selectAll: jest.fn().mockReturnThis(),
  attr: jest.fn().mockReturnThis(),
  style: jest.fn().mockReturnThis(),
  append: jest.fn().mockReturnThis(),
  call: jest.fn().mockReturnThis(),
  datum: jest.fn().mockReturnThis(),
  on: jest.fn().mockReturnThis(),
  data: jest.fn().mockReturnThis(),
  enter: jest.fn().mockReturnThis(),
  text: jest.fn().mockReturnThis(),
  filter: jest.fn().mockReturnThis(),
  remove: jest.fn().mockReturnThis(),
});

export const select = jest.fn().mockReturnValue(chain());
export const selectAll = jest.fn().mockReturnValue(chain());
export const zoom = jest.fn().mockReturnValue({
  scaleExtent: jest.fn().mockReturnThis(),
  on: jest.fn().mockReturnThis(),
});
export const zoomIdentity = { x: 0, y: 0, k: 1 };
export const scaleLinear = jest.fn().mockReturnValue({
  domain: jest.fn().mockReturnThis(),
  range: jest.fn().mockReturnThis(),
});
