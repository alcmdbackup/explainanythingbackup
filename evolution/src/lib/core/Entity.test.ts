// Tests for Entity abstract class: verifies compile-time enforcement and generic CRUD methods.

import { Entity } from './Entity';
import { METRIC_CATALOG } from './metricCatalog';
import { RunEntity } from './entities/RunEntity';
import type {
  EntityType, ParentRelation, ChildRelation, EntityAction,
  ColumnDef, FilterDef, TabDef, EntityLink, EntityMetricRegistry,
} from './types';

// ─── Concrete test subclass ──────────────────────────────────────

interface TestRow {
  id: string;
  name: string;
  status: string;
  parent_id: string | null;
  created_at: string;
}

class TestEntity extends Entity<TestRow> {
  readonly type: EntityType = 'run';
  readonly table = 'test_table';
  readonly parents: ParentRelation[] = [
    { parentType: 'strategy', foreignKey: 'parent_id' },
  ];
  readonly children: ChildRelation[] = [
    { childType: 'variant', foreignKey: 'test_id', cascade: 'delete' },
  ];
  readonly metrics: EntityMetricRegistry = {
    duringExecution: [],
    atFinalization: [],
    atPropagation: [],
  };
  readonly listColumns: ColumnDef[] = [
    { key: 'name', label: 'Name' },
    { key: 'status', label: 'Status' },
  ];
  readonly listFilters: FilterDef[] = [
    { field: 'status', type: 'select', options: ['active', 'archived'] },
  ];
  readonly actions: EntityAction<TestRow>[] = [
    { key: 'archive', label: 'Archive' },
    { key: 'delete', label: 'Delete', danger: true },
  ];
  readonly renameField = 'name';
  readonly archiveColumn = 'status';
  readonly archiveValue = 'archived';
  readonly detailTabs: TabDef[] = [
    { id: 'overview', label: 'Overview' },
  ];
  readonly insertSchema = undefined;

  detailLinks(row: TestRow): EntityLink[] {
    return row.parent_id
      ? [{ label: 'Parent', entityType: 'strategy', entityId: row.parent_id }]
      : [];
  }
}

// ─── Tests ────────────────────────────────────────────────────────

describe('Entity abstract class', () => {
  let entity: TestEntity;

  beforeEach(() => {
    entity = new TestEntity();
  });

  it('has correct type and table', () => {
    expect(entity.type).toBe('run');
    expect(entity.table).toBe('test_table');
  });

  it('declares parents and children', () => {
    expect(entity.parents).toHaveLength(1);
    expect(entity.parents[0]!.parentType).toBe('strategy');
    expect(entity.children).toHaveLength(1);
    expect(entity.children[0]!.childType).toBe('variant');
  });

  it('has list columns and filters', () => {
    expect(entity.listColumns).toHaveLength(2);
    expect(entity.listFilters).toHaveLength(1);
  });

  it('has default sort', () => {
    expect(entity.defaultSort).toEqual({ column: 'created_at', dir: 'desc' });
  });

  it('has rename field', () => {
    expect(entity.renameField).toBe('name');
  });

  it('has archive config', () => {
    expect(entity.archiveColumn).toBe('status');
    expect(entity.archiveValue).toBe('archived');
  });

  it('generates detail links from row', () => {
    const row: TestRow = { id: '1', name: 'test', status: 'active', parent_id: 'p1', created_at: '' };
    const links = entity.detailLinks(row);
    expect(links).toHaveLength(1);
    expect(links[0]!).toEqual({ label: 'Parent', entityType: 'strategy', entityId: 'p1' });
  });

  it('returns empty detail links when no parent', () => {
    const row: TestRow = { id: '1', name: 'test', status: 'active', parent_id: null, created_at: '' };
    expect(entity.detailLinks(row)).toHaveLength(0);
  });

  describe('getById', () => {
    it('rejects invalid UUID', async () => {
      const mockDb = {} as any;
      const result = await entity.getById('not-a-uuid', mockDb);
      expect(result).toBeNull();
    });
  });

  describe('executeAction', () => {
    it('throws for unknown action', async () => {
      const mockDb = {} as any;
      await expect(entity.executeAction('nonexistent', 'id', mockDb))
        .rejects.toThrow("Unknown action 'nonexistent' on run");
    });

    it('rename calls db update with the rename field', async () => {
      const eqFn = jest.fn(() => Promise.resolve({ error: null }));
      const updateFn = jest.fn(() => ({ eq: eqFn }));
      const mockDb = { from: jest.fn(() => ({ update: updateFn })) } as any;

      await entity.executeAction('rename', 'test-id', mockDb, { name: 'New Name' });

      expect(mockDb.from).toHaveBeenCalledWith('test_table');
      expect(updateFn).toHaveBeenCalledWith({ name: 'New Name' });
      expect(eqFn).toHaveBeenCalledWith('id', 'test-id');
    });

    it('archive calls db update with archive column and value', async () => {
      const eqFn = jest.fn(() => Promise.resolve({ error: null }));
      const updateFn = jest.fn(() => ({ eq: eqFn }));
      const mockDb = { from: jest.fn(() => ({ update: updateFn })) } as any;

      await entity.executeAction('archive', 'test-id', mockDb);

      expect(mockDb.from).toHaveBeenCalledWith('test_table');
      expect(updateFn).toHaveBeenCalledWith({ status: 'archived' });
      expect(eqFn).toHaveBeenCalledWith('id', 'test-id');
    });
  });

  describe('metrics declarations', () => {
    it('has three lifecycle phases', () => {
      expect(entity.metrics).toHaveProperty('duringExecution');
      expect(entity.metrics).toHaveProperty('atFinalization');
      expect(entity.metrics).toHaveProperty('atPropagation');
    });

    it('RunEntity metric names reference valid METRIC_CATALOG entries', () => {
      const catalogNames = new Set(Object.keys(METRIC_CATALOG));
      const runEntity = new RunEntity();
      for (const def of [...runEntity.metrics.duringExecution, ...runEntity.metrics.atFinalization]) {
        expect(catalogNames).toContain(def.name);
      }
    });
  });
});
