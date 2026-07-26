import { apiRequest, createIdempotencyKey, HostingerApiError } from './hostingerApi';
import {
  readCachedCollection,
  writeCachedCollection,
  type CachedApiDocument,
} from './indexedDbDocumentCache';

export type ApiDocument = CachedApiDocument & { collection?: string };

export type LocalFilter = { type: 'where'; field: string; operator: string; value: any };
export type LocalOrder = { type: 'orderBy'; field: string; direction: 'asc' | 'desc' };
export type LocalLimit = { type: 'limit'; count: number };
export type LocalConstraint = LocalFilter | LocalOrder | LocalLimit;

type StoreListener = () => void;

type Mutation = {
  type: 'set' | 'update' | 'delete';
  collection: string;
  id: string;
  data?: Record<string, any>;
  merge?: boolean;
  expectedVersion?: number;
};

type ReadPrecondition = { collection: string; id: string; expectedVersion: number };

type ListResponse = {
  documents: ApiDocument[];
  nextCursor: string | null;
  snapshotCursor: number;
};

type ChangeResponse = {
  events: Array<{
    cursor: number;
    collection: string;
    id: string;
    operation: 'upsert' | 'delete';
    version: number;
    data: Record<string, any> | null;
    changedAt: string;
  }>;
  cursor: number;
  hasMore: boolean;
};

function nestedValue(data: Record<string, any>, path: string) {
  return path.split('.').reduce<any>((value, key) => (value == null ? undefined : value[key]), data);
}

function compareValues(left: any, right: any) {
  if (left === right) return 0;
  if (left === undefined || left === null) return -1;
  if (right === undefined || right === null) return 1;
  if (typeof left === 'number' && typeof right === 'number') return left - right;
  return String(left).localeCompare(String(right));
}

function matchesFilter(document: ApiDocument, filter: LocalFilter) {
  const actual = nestedValue(document.data, filter.field);
  const expected = filter.value;
  switch (filter.operator) {
    case '==': return actual === expected;
    case '!=': return actual !== expected;
    case '>=': return actual >= expected;
    case '<=': return actual <= expected;
    case '>': return actual > expected;
    case '<': return actual < expected;
    case 'in': return Array.isArray(expected) && expected.includes(actual);
    case 'array-contains': return Array.isArray(actual) && actual.includes(expected);
    default: return false;
  }
}

export class HostingerDocumentStore {
  private records = new Map<string, Map<string, ApiDocument>>();
  private loaded = new Set<string>();
  private hydrated = new Set<string>();
  private loading = new Map<string, Promise<void>>();
  private listeners = new Map<string, Set<StoreListener>>();
  private cursor = 0;
  private pollTimer: number | null = null;
  private polling = false;
  private userScope = 'signed-out';
  private generation = 0;

  setUserScope(userId: string) {
    const nextScope = userId || 'signed-out';
    if (nextScope === this.userScope) return;
    this.userScope = nextScope;
    this.generation++;
    this.records.clear();
    this.loaded.clear();
    this.hydrated.clear();
    this.loading.clear();
    this.cursor = 0;
    this.listeners.forEach(listeners => listeners.forEach(listener => listener()));
  }

  subscribe(collectionName: string, listener: StoreListener) {
    const listeners = this.listeners.get(collectionName) || new Set<StoreListener>();
    listeners.add(listener);
    this.listeners.set(collectionName, listeners);
    void this.ensureCollection(collectionName).catch(() => {
      // The onSnapshot compatibility layer reports the same load failure.
    });
    this.ensurePoller();
    return () => {
      listeners.delete(listener);
      if (!listeners.size) this.listeners.delete(collectionName);
    };
  }

  async ensureCollection(collectionName: string) {
    const generation = this.generation;
    const userScope = this.userScope;
    if (!this.hydrated.has(collectionName)) {
      this.hydrated.add(collectionName);
      const cached = await readCachedCollection(userScope, collectionName);
      if (generation !== this.generation) return;
      if (cached.length && !this.records.has(collectionName)) {
        this.records.set(collectionName, new Map(cached.map(document => [document.id, document])));
        this.notify(collectionName);
      }
    }
    if (this.loaded.has(collectionName)) return;
    const existingLoad = this.loading.get(collectionName);
    if (existingLoad) return existingLoad;
    const load = this.loadCollection(collectionName, generation, userScope)
      .catch(error => {
        if (generation !== this.generation) return;
        if (this.records.get(collectionName)?.size) return;
        throw error;
      })
      .finally(() => {
        if (this.loading.get(collectionName) === load) this.loading.delete(collectionName);
      });
    this.loading.set(collectionName, load);
    return load;
  }

  getLocalDocuments(collectionName: string, constraints: LocalConstraint[] = []) {
    let documents = [...(this.records.get(collectionName)?.values() || [])];
    for (const filter of constraints.filter((item): item is LocalFilter => item.type === 'where')) {
      documents = documents.filter(document => matchesFilter(document, filter));
    }
    const orders = constraints.filter((item): item is LocalOrder => item.type === 'orderBy');
    if (orders.length) {
      documents = documents.filter(document => orders.every(order => nestedValue(document.data, order.field) !== undefined));
      documents.sort((left, right) => {
        for (const order of orders) {
          const compared = compareValues(nestedValue(left.data, order.field), nestedValue(right.data, order.field));
          if (compared) return order.direction === 'desc' ? -compared : compared;
        }
        return left.id.localeCompare(right.id);
      });
    }
    const cap = constraints.find((item): item is LocalLimit => item.type === 'limit');
    return cap ? documents.slice(0, cap.count) : documents;
  }

  getLocalDocument(collectionName: string, id: string) {
    return this.records.get(collectionName)?.get(id) || null;
  }

  async getDocument(collectionName: string, id: string, fresh = false) {
    if (!fresh) {
      await this.ensureCollection(collectionName);
      return this.getLocalDocument(collectionName, id);
    }
    try {
      const document = await apiRequest<ApiDocument>(`/collections/${encodeURIComponent(collectionName)}/${encodeURIComponent(id)}`);
      this.applyDocument(collectionName, document);
      return document;
    } catch (error) {
      if (error instanceof HostingerApiError && error.status === 404) return null;
      throw error;
    }
  }

  async add(collectionName: string, data: Record<string, any>, id?: string) {
    const response = await apiRequest<{ document: ApiDocument }>(`/collections/${encodeURIComponent(collectionName)}`, {
      method: 'POST',
      body: JSON.stringify({ ...(id ? { id } : {}), data }),
      idempotencyKey: createIdempotencyKey('create'),
    });
    this.applyDocument(collectionName, response.document);
    return response.document;
  }

  async set(collectionName: string, id: string, data: Record<string, any>, merge = false) {
    const current = await this.getDocument(collectionName, id);
    const expectedVersion = current?.version ?? 0;
    const response = await apiRequest<{ document: ApiDocument }>(
      `/collections/${encodeURIComponent(collectionName)}/${encodeURIComponent(id)}`,
      {
        method: merge ? 'PATCH' : 'PUT',
        body: JSON.stringify({ data, expectedVersion, merge }),
        expectedVersion,
        idempotencyKey: createIdempotencyKey(merge ? 'patch' : 'set'),
      },
    );
    this.applyDocument(collectionName, response.document);
    return response.document;
  }

  async update(collectionName: string, id: string, data: Record<string, any>) {
    const current = await this.getDocument(collectionName, id);
    if (!current) throw new HostingerApiError('The requested record was not found.', 404, 'not_found');
    const response = await apiRequest<{ document: ApiDocument }>(
      `/collections/${encodeURIComponent(collectionName)}/${encodeURIComponent(id)}`,
      {
        method: 'PATCH',
        body: JSON.stringify({ data, expectedVersion: current.version }),
        expectedVersion: current.version,
        idempotencyKey: createIdempotencyKey('update'),
      },
    );
    this.applyDocument(collectionName, response.document);
    return response.document;
  }

  async delete(collectionName: string, id: string) {
    const current = await this.getDocument(collectionName, id);
    if (!current) throw new HostingerApiError('The requested record was not found.', 404, 'not_found');
    await apiRequest<{ deleted: boolean }>(`/collections/${encodeURIComponent(collectionName)}/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      body: JSON.stringify({ expectedVersion: current.version }),
      expectedVersion: current.version,
      idempotencyKey: createIdempotencyKey('delete'),
    });
    this.removeDocument(collectionName, id);
  }

  async atomic(mutations: Mutation[], reads: ReadPrecondition[] = [], command = 'transaction') {
    const response = await apiRequest<{ documents: Array<ApiDocument | { collection: string; id: string; deleted: true }>; cursor: number }>(
      `/commands/${encodeURIComponent(command)}`,
      {
        method: 'POST',
        body: JSON.stringify({ mutations, reads }),
        idempotencyKey: createIdempotencyKey(command),
      },
    );
    for (const document of response.documents || []) {
      if ('deleted' in document && document.deleted) this.removeDocument(document.collection, document.id);
      else {
        const saved = document as ApiDocument;
        this.applyDocument(saved.collection || mutations.find(item => item.id === saved.id)?.collection || '', saved);
      }
    }
    this.cursor = Math.max(this.cursor, Number(response.cursor || 0));
    return response;
  }

  async nextCounter(counter: string, prefix: string) {
    return apiRequest<{ value: number; formatted: string; documentVersion: number }>('/commands/counter-next', {
      method: 'POST',
      body: JSON.stringify({ counter, prefix }),
      idempotencyKey: createIdempotencyKey(`counter-${counter}`),
    });
  }

  async createPatient(data: Record<string, any>) {
    const response = await apiRequest<{ document: ApiDocument; mrn: string }>('/commands/patient-create', {
      method: 'POST',
      body: JSON.stringify({ data }),
      idempotencyKey: createIdempotencyKey('patient-create'),
    });
    this.applyDocument('patients', response.document);
    return response;
  }

  private async loadCollection(collectionName: string, generation: number, userScope: string) {
    const documents: ApiDocument[] = [];
    let after = '';
    let snapshotCursor = 0;
    do {
      const query = new URLSearchParams({ limit: '5000' });
      if (after) query.set('after', after);
      const response = await apiRequest<ListResponse>(`/collections/${encodeURIComponent(collectionName)}?${query}`);
      documents.push(...response.documents);
      after = response.nextCursor || '';
      snapshotCursor = Math.max(snapshotCursor, Number(response.snapshotCursor || 0));
    } while (after);
    if (generation !== this.generation) return;
    this.records.set(collectionName, new Map(documents.map(document => [document.id, document])));
    this.loaded.add(collectionName);
    if (this.cursor === 0) this.cursor = snapshotCursor;
    await writeCachedCollection(userScope, collectionName, documents);
    this.notify(collectionName);
    if (snapshotCursor > 0) await this.catchUpCollection(collectionName, snapshotCursor, generation);
  }

  private async catchUpCollection(collectionName: string, after: number, generation: number) {
    let cursor = after;
    let hasMore = false;
    do {
      const query = new URLSearchParams({ after: String(cursor), collections: collectionName, limit: '5000' });
      const response = await apiRequest<ChangeResponse>(`/changes?${query}`);
      if (generation !== this.generation) return;
      this.applyEvents(response.events);
      cursor = response.cursor;
      hasMore = response.hasMore;
    } while (hasMore);
  }

  private ensurePoller() {
    if (this.pollTimer !== null || this.polling) return;
    const delay = document.visibilityState === 'visible' ? 10_000 : 60_000;
    this.pollTimer = window.setTimeout(() => {
      this.pollTimer = null;
      void this.pollChanges();
    }, delay);
  }

  private async pollChanges() {
    const generation = this.generation;
    for (const collectionName of this.listeners.keys()) {
      if (!this.loaded.has(collectionName) && !this.loading.has(collectionName)) {
        try { await this.ensureCollection(collectionName); } catch { /* Retry on the next poll. */ }
      }
      if (generation !== this.generation) return;
    }
    if (this.polling || !this.loaded.size || this.cursor === 0) {
      this.ensurePoller();
      return;
    }
    this.polling = true;
    try {
      let hasMore = false;
      do {
        const query = new URLSearchParams({
          after: String(this.cursor),
          collections: [...this.loaded].join(','),
          limit: '5000',
        });
        const response = await apiRequest<ChangeResponse>(`/changes?${query}`);
        if (generation !== this.generation) return;
        this.applyEvents(response.events);
        this.cursor = Math.max(this.cursor, Number(response.cursor || this.cursor));
        hasMore = response.hasMore;
      } while (hasMore);
    } catch {
      // Connectivity state is maintained by apiRequest; cached records remain available.
    } finally {
      this.polling = false;
      this.ensurePoller();
    }
  }

  private applyEvents(events: ChangeResponse['events']) {
    const changed = new Set<string>();
    for (const event of events) {
      if (!this.loaded.has(event.collection)) continue;
      if (event.operation === 'delete') {
        this.records.get(event.collection)?.delete(event.id);
      } else if (event.data) {
        const previous = this.records.get(event.collection)?.get(event.id);
        this.records.get(event.collection)?.set(event.id, {
          id: event.id,
          data: event.data,
          version: event.version,
          createdAt: previous?.createdAt,
          updatedAt: event.changedAt,
        });
      }
      changed.add(event.collection);
    }
    changed.forEach(collectionName => {
      this.notify(collectionName);
      void this.persist(collectionName);
    });
  }

  private applyDocument(collectionName: string, document: ApiDocument) {
    if (!collectionName) return;
    const records = this.records.get(collectionName) || new Map<string, ApiDocument>();
    records.set(document.id, document);
    this.records.set(collectionName, records);
    this.notify(collectionName);
    void this.persist(collectionName);
  }

  private removeDocument(collectionName: string, id: string) {
    this.records.get(collectionName)?.delete(id);
    this.notify(collectionName);
    void this.persist(collectionName);
  }

  private notify(collectionName: string) {
    this.listeners.get(collectionName)?.forEach(listener => listener());
  }

  private async persist(collectionName: string) {
    await writeCachedCollection(this.userScope, collectionName, [...(this.records.get(collectionName)?.values() || [])]);
  }
}

export const hostingerDocumentStore = new HostingerDocumentStore();
