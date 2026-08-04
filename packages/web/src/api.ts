/** 与本体 API（M3 server）的通信层。所有类型对应 /api/schema 的可 JSON 化视图。 */

export type Value = string | number | boolean | null;
export type ObjectRow = Record<string, Value>;

export interface PropertyDef {
  apiName: string;
  displayName: string;
  type: 'string' | 'number' | 'boolean' | 'date';
  nullable?: boolean;
}

export interface ObjectTypeDef {
  apiName: string;
  displayName: string;
  primaryKey: string;
  properties: PropertyDef[];
  datasource?: { kind: 'csv'; path: string };
}

export interface LinkTypeDef {
  apiName: string;
  displayName: string;
  source: string;
  target: string;
  sourceToTargetName: string;
  targetToSourceName: string;
}

export interface ParamDef {
  apiName: string;
  displayName: string;
  type: 'string' | 'number' | 'boolean' | 'date';
  required?: boolean;
}

export interface ActionTypeView {
  apiName: string;
  displayName: string;
  parameters: ParamDef[];
  criteria: { apiName: string; displayName: string; message: string }[];
}

export interface SchemaView {
  apiName: string;
  displayName: string;
  objectTypes: ObjectTypeDef[];
  linkTypes: LinkTypeDef[];
  actionTypes: ActionTypeView[];
  functions: { apiName: string; displayName: string }[];
}

export type ActionResult =
  | { ok: true; edits: unknown[]; sideEffects: { kind: string; message: string }[] }
  | { ok: false; stage: 'params'; message: string }
  | { ok: false; stage: 'criteria'; failedCriterion: string; message: string };

export interface AuditRecord {
  id: number;
  action: string;
  params: Record<string, Value>;
  edits: unknown[];
  at: string;
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(path);
  if (!res.ok) throw new Error((await res.json().catch(() => ({ error: res.statusText }))).error ?? res.statusText);
  return res.json() as Promise<T>;
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({ error: res.statusText }))).error ?? res.statusText);
  return res.json() as Promise<T>;
}

export const api = {
  schema: () => get<SchemaView>('/api/schema'),
  objects: (type: string, opts?: { where?: string[]; orderBy?: string; desc?: boolean; limit?: number }) => {
    const q = new URLSearchParams();
    for (const w of opts?.where ?? []) q.append('where', w);
    if (opts?.orderBy) q.set('orderBy', opts.orderBy);
    if (opts?.desc) q.set('desc', '1');
    if (opts?.limit) q.set('limit', String(opts.limit));
    const qs = q.toString();
    return get<ObjectRow[]>(`/api/objects/${type}${qs ? `?${qs}` : ''}`);
  },
  object: (type: string, pk: Value) => get<ObjectRow>(`/api/objects/${type}/${encodeURIComponent(String(pk))}`),
  links: (type: string, pk: Value, name: string) =>
    get<ObjectRow[]>(`/api/objects/${type}/${encodeURIComponent(String(pk))}/links/${name}`),
  count: (type: string, by?: string) =>
    get<{ key: Value; count: number }[] | { count: number }>(`/api/count/${type}${by ? `?by=${by}` : ''}`),
  action: (name: string, params: Record<string, Value>) => post<ActionResult>(`/api/actions/${name}`, { params }),
  fn: (name: string, params: Record<string, Value>) => post<unknown>(`/api/functions/${name}`, { params }),
  audit: (limit = 30) => get<AuditRecord[]>(`/api/audit?limit=${limit}`),
  notifications: (limit = 30) => get<{ id: number; message: string; at: string }[]>(`/api/notifications?limit=${limit}`),
};
