import {
  hostingerDocumentStore,
  type ApiDocument,
  type LocalConstraint,
} from './hostingerDocumentStore';
import { HostingerApiError } from './hostingerApi';

export type Firestore = { readonly __hostingerMySql: true };
export const hostingerDb: Firestore = Object.freeze({ __hostingerMySql: true as const });

export type CollectionReference = {
  type: 'collection';
  path: string;
  id: string;
  db: Firestore;
};

export type DocumentReference = {
  type: 'document';
  path: string;
  id: string;
  collectionName: string;
  parent: CollectionReference;
  db: Firestore;
};

export type Query = {
  type: 'query';
  collection: CollectionReference;
  constraints: LocalConstraint[];
};

export class DocumentSnapshot {
  readonly id: string;
  readonly ref: DocumentReference;
  readonly metadata: { fromCache: boolean; hasPendingWrites: boolean };

  constructor(ref: DocumentReference, private readonly document: ApiDocument | null, fromCache = false) {
    this.id = ref.id;
    this.ref = ref;
    this.metadata = { fromCache, hasPendingWrites: false };
  }

  exists() { return this.document !== null; }
  data() { return this.document?.data; }
  get(field: string) {
    return field.split('.').reduce<any>((value, key) => (value == null ? undefined : value[key]), this.document?.data);
  }
}

export class QueryDocumentSnapshot extends DocumentSnapshot {
  data() { return super.data() || {}; }
}

export class QuerySnapshot {
  readonly docs: QueryDocumentSnapshot[];
  readonly size: number;
  readonly empty: boolean;
  readonly metadata = { fromCache: false, hasPendingWrites: false };

  constructor(documents: ApiDocument[], collectionRef: CollectionReference) {
    this.docs = documents.map(document => new QueryDocumentSnapshot(doc(collectionRef, document.id), document));
    this.size = this.docs.length;
    this.empty = this.size === 0;
  }

  forEach(callback: (document: QueryDocumentSnapshot) => void) { this.docs.forEach(callback); }
}

export function getFirestore(_app?: unknown): Firestore { return hostingerDb; }
export async function enableIndexedDbPersistence() { return undefined; }

export function collection(parent: Firestore | DocumentReference, ...segments: string[]): CollectionReference {
  const prefix = 'type' in parent && parent.type === 'document' ? parent.path : '';
  const path = [prefix, ...segments].filter(Boolean).join('/');
  if (!path || path.split('/').length % 2 === 0) throw new Error(`Invalid collection path: ${path}`);
  return { type: 'collection', path, id: path.split('/').at(-1) || '', db: hostingerDb };
}

function autoId() {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = crypto.getRandomValues(new Uint8Array(20));
  return [...bytes].map(value => alphabet[value % alphabet.length]).join('');
}

export function doc(parent: Firestore | CollectionReference | DocumentReference, ...segments: string[]): DocumentReference {
  let path: string;
  if ('type' in parent && parent.type === 'collection') {
    path = `${parent.path}/${segments[0] || autoId()}`;
  } else if ('type' in parent && parent.type === 'document') {
    path = [parent.path, ...segments].join('/');
  } else {
    path = segments.join('/');
  }
  const parts = path.split('/').filter(Boolean);
  if (!parts.length || parts.length % 2 !== 0) throw new Error(`Invalid document path: ${path}`);
  const collectionPath = parts.slice(0, -1).join('/');
  return {
    type: 'document', path, id: parts.at(-1) || '', collectionName: parts[0],
    parent: { type: 'collection', path: collectionPath, id: parts.at(-2) || '', db: hostingerDb },
    db: hostingerDb,
  };
}

export function where(field: string, operator: string, value: any): LocalConstraint {
  return { type: 'where', field, operator, value };
}

export function orderBy(field: string, direction: 'asc' | 'desc' = 'asc'): LocalConstraint {
  return { type: 'orderBy', field, direction };
}

export function limit(count: number): LocalConstraint { return { type: 'limit', count }; }

export function query(collectionRef: CollectionReference | Query, ...constraints: LocalConstraint[]): Query {
  if (collectionRef.type === 'query') {
    return { ...collectionRef, constraints: [...collectionRef.constraints, ...constraints] };
  }
  return { type: 'query', collection: collectionRef, constraints };
}

function resolveQuery(target: CollectionReference | Query) {
  return target.type === 'query'
    ? target
    : { type: 'query' as const, collection: target, constraints: [] as LocalConstraint[] };
}

export async function getDocs(target: CollectionReference | Query) {
  const resolved = resolveQuery(target);
  await hostingerDocumentStore.ensureCollection(resolved.collection.id);
  return new QuerySnapshot(hostingerDocumentStore.getLocalDocuments(resolved.collection.id, resolved.constraints), resolved.collection);
}

export async function getDoc(reference: DocumentReference) {
  const document = await hostingerDocumentStore.getDocument(reference.collectionName, reference.id);
  return new DocumentSnapshot(reference, document);
}

export function onSnapshot(
  target: DocumentReference,
  onNext: (snapshot: DocumentSnapshot) => void,
  onError?: (error: unknown) => void,
): () => void;
export function onSnapshot(
  target: CollectionReference | Query,
  onNext: (snapshot: QuerySnapshot) => void,
  onError?: (error: unknown) => void,
): () => void;
export function onSnapshot(
  target: CollectionReference | Query | DocumentReference,
  onNext: (snapshot: any) => void,
  onError?: (error: unknown) => void,
) {
  const isDocument = target.type === 'document';
  const collectionName = isDocument ? target.collectionName : resolveQuery(target).collection.id;
  let active = true;
  const emit = () => {
    if (!active) return;
    if (isDocument) {
      onNext(new DocumentSnapshot(target, hostingerDocumentStore.getLocalDocument(collectionName, target.id), true));
      return;
    }
    const resolved = resolveQuery(target);
    onNext(new QuerySnapshot(hostingerDocumentStore.getLocalDocuments(collectionName, resolved.constraints), resolved.collection));
  };
  const unsubscribe = hostingerDocumentStore.subscribe(collectionName, emit);
  void hostingerDocumentStore.ensureCollection(collectionName).then(emit).catch(error => onError?.(error));
  return () => { active = false; unsubscribe(); };
}

export async function addDoc(reference: CollectionReference, data: Record<string, any>) {
  const saved = await hostingerDocumentStore.add(reference.id, data);
  return doc(reference, saved.id);
}

export async function setDoc(reference: DocumentReference, data: Record<string, any>, options?: { merge?: boolean }) {
  await hostingerDocumentStore.set(reference.collectionName, reference.id, data, options?.merge === true);
}

export async function updateDoc(reference: DocumentReference, data: Record<string, any>) {
  await hostingerDocumentStore.update(reference.collectionName, reference.id, data);
}

export async function deleteDoc(reference: DocumentReference) {
  await hostingerDocumentStore.delete(reference.collectionName, reference.id);
}

export function increment(operand: number) {
  return { __gmhTransform: 'increment', operand };
}

export function serverTimestamp() {
  return { __gmhTransform: 'serverTimestamp' };
}

type TransactionMutation = {
  type: 'set' | 'update' | 'delete';
  reference: DocumentReference;
  data?: Record<string, any>;
  merge?: boolean;
};

function inferAtomicCommand(mutations: Array<{ type: string; collection: string; data?: Record<string, any> }>) {
  const collections = new Set(mutations.map(mutation => mutation.collection));
  const hasStatus = (collectionName: string, status: string) => mutations.some(mutation =>
    mutation.collection === collectionName && mutation.data?.status === status
  );
  if (collections.has('approvalRequests')) return 'approval-review';
  if (collections.has('saleReturns')) return 'sale-return';
  if (collections.has('purchaseReturns')) return 'purchase-return';
  if (collections.has('sales') && collections.has('medicines')) return 'pharmacy-checkout';
  if (collections.has('customerPayments')) return 'customer-payment';
  if (collections.has('purchases') && collections.has('medicines')) {
    const createsPurchase = mutations.some(mutation => mutation.collection === 'purchases' && mutation.type === 'set');
    return createsPurchase ? 'purchase-create' : 'purchase-stock-repair';
  }
  if (collections.has('admissions') && hasStatus('admissions', 'discharged')) return 'ipd-discharge';
  if (collections.has('admissions') && hasStatus('admissions', 'admitted')) return 'ipd-admit';
  if (collections.has('pharmacyOrders') && collections.has('bedTreatments')) {
    return hasStatus('pharmacyOrders', 'cancelled') ? 'ipd-order-cancel' : 'ipd-order-create';
  }
  if (collections.has('pharmacyOrders') && collections.has('medicines')) return 'pharmacy-dispense';
  if (collections.size === 1 && collections.has('notifications')) return 'notifications-read';
  return 'transaction';
}

class CompatibleTransaction {
  reads = new Map<string, { reference: DocumentReference; version: number }>();
  mutations: TransactionMutation[] = [];

  async get(reference: DocumentReference) {
    const document = await hostingerDocumentStore.getDocument(reference.collectionName, reference.id, true);
    this.reads.set(reference.path, { reference, version: document?.version || 0 });
    return new DocumentSnapshot(reference, document);
  }

  set(reference: DocumentReference, data: Record<string, any>, options?: { merge?: boolean }) {
    this.mutations.push({ type: 'set', reference, data, merge: options?.merge });
    return this;
  }

  update(reference: DocumentReference, data: Record<string, any>) {
    this.mutations.push({ type: 'update', reference, data, merge: true });
    return this;
  }

  delete(reference: DocumentReference) {
    this.mutations.push({ type: 'delete', reference });
    return this;
  }
}

export async function runTransaction<T>(_database: Firestore, operation: (transaction: CompatibleTransaction) => Promise<T>) {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    const transaction = new CompatibleTransaction();
    try {
      const result = await operation(transaction);
      const reads = [...transaction.reads.values()].map(read => ({
        collection: read.reference.collectionName, id: read.reference.id, expectedVersion: read.version,
      }));
      const mutations = [];
      for (const mutation of transaction.mutations) {
        const read = transaction.reads.get(mutation.reference.path);
        const current = read || {
          reference: mutation.reference,
          version: (await hostingerDocumentStore.getDocument(
            mutation.reference.collectionName, mutation.reference.id, true,
          ))?.version || 0,
        };
        mutations.push({
          type: mutation.type,
          collection: mutation.reference.collectionName,
          id: mutation.reference.id,
          ...(mutation.data ? { data: mutation.data } : {}),
          ...(mutation.merge ? { merge: true } : {}),
          expectedVersion: current.version,
        });
      }
      await hostingerDocumentStore.atomic(mutations, reads, inferAtomicCommand(mutations));
      return result;
    } catch (error) {
      lastError = error;
      if (!(error instanceof HostingerApiError) || error.code !== 'aborted') throw error;
    }
  }
  throw lastError;
}

export function writeBatch(_database: Firestore) {
  const mutations: TransactionMutation[] = [];
  return {
    set(reference: DocumentReference, data: Record<string, any>, options?: { merge?: boolean }) {
      mutations.push({ type: 'set', reference, data, merge: options?.merge });
      return this;
    },
    update(reference: DocumentReference, data: Record<string, any>) {
      mutations.push({ type: 'update', reference, data, merge: true });
      return this;
    },
    delete(reference: DocumentReference) {
      mutations.push({ type: 'delete', reference });
      return this;
    },
    async commit() {
      const payload = [];
      for (const mutation of mutations) {
        const current = await hostingerDocumentStore.getDocument(mutation.reference.collectionName, mutation.reference.id, true);
        payload.push({
          type: mutation.type,
          collection: mutation.reference.collectionName,
          id: mutation.reference.id,
          ...(mutation.data ? { data: mutation.data } : {}),
          ...(mutation.merge ? { merge: true } : {}),
          expectedVersion: current?.version || 0,
        });
      }
      await hostingerDocumentStore.atomic(payload, [], inferAtomicCommand(payload));
    },
  };
}
