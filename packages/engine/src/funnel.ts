import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'csv-parse/sync';
import type { ObjectStore, ObjectRow } from './store.js';
import type { PropertyType } from './types.js';

export interface MaterializeReport {
  objectType: string;
  csvPath: string;
  totalRows: number;
  inserted: number;
  updated: number;
  skipped: { row: number; reason: string }[];
  nulled: { row: number; property: string; raw: string }[];
}

/** 数据源明确表示"无值"的标记（置空但不计入 nulled 报告；纯空串的数字列除外，见下）。 */
const EMPTY = new Set(['', '-', '--', 'null', 'NULL', 'N/A']);

/** 非空原始值 → 属性值。失败返回 ok:false（由调用方按 nullable 决定置空或跳行）。 */
function convert(
  raw: string,
  type: PropertyType,
): { ok: true; value: string | number | boolean } | { ok: false } {
  switch (type) {
    case 'string':
    case 'date':
      return { ok: true, value: raw };
    case 'number': {
      const n = Number(raw);
      return Number.isFinite(n) ? { ok: true, value: n } : { ok: false };
    }
    case 'boolean': {
      if (raw === 'true' || raw === '1') return { ok: true, value: true };
      if (raw === 'false' || raw === '0') return { ok: true, value: false };
      return { ok: false };
    }
  }
}

export function materializeCsv(
  store: ObjectStore,
  typeApiName: string,
  csvPath: string,
): MaterializeReport {
  const ot = store.registry.objectType(typeApiName);
  const records = parse(readFileSync(csvPath, 'utf8'), {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  }) as Record<string, string>[];

  const report: MaterializeReport = {
    objectType: ot.apiName,
    csvPath,
    totalRows: records.length,
    inserted: 0,
    updated: 0,
    skipped: [],
    nulled: [],
  };

  const rows: ObjectRow[] = [];

  records.forEach((rec, i) => {
    const rowNo = i + 1; // 1-based 数据行号（不含表头）
    const row: ObjectRow = {};
    const rowNulled: { row: number; property: string; raw: string }[] = [];
    for (const p of ot.properties) {
      const raw = rec[p.apiName] ?? '';
      const trimmed = raw.trim();
      let value: string | number | boolean | null;
      if (EMPTY.has(trimmed)) {
        value = null;
        // 数字列的纯空串是"该有数没有数"（如未盈利企业 PE），进 nulled 报告；
        // '-'/'null' 等显式无值标记不进报告。
        if (trimmed === '' && p.type === 'number' && p.nullable)
          rowNulled.push({ row: rowNo, property: p.apiName, raw });
      } else {
        const conv = convert(raw, p.type);
        if (!conv.ok) {
          if (p.nullable) {
            value = null;
            rowNulled.push({ row: rowNo, property: p.apiName, raw });
          } else {
            report.skipped.push({ row: rowNo, reason: `invalid value '${raw}' for non-nullable '${p.apiName}'` });
            return;
          }
        } else {
          value = conv.value;
        }
      }
      if (value === null && p.apiName === ot.primaryKey) {
        report.skipped.push({ row: rowNo, reason: `missing primary key '${ot.primaryKey}'` });
        return;
      }
      if (value === null && !p.nullable) {
        report.skipped.push({ row: rowNo, reason: `empty value for non-nullable '${p.apiName}'` });
        return;
      }
      row[p.apiName] = value;
    }
    rows.push(row);
    report.nulled.push(...rowNulled); // 跳过的行在上面 return，其 nulled 记录不进报告
  });

  const result = store.upsertMany(ot.apiName, rows);
  report.inserted = result.inserted;
  report.updated = result.updated;
  return report;
}

export function materializeAll(store: ObjectStore, datasetsDir: string): MaterializeReport[] {
  const reports: MaterializeReport[] = [];
  for (const ot of store.registry.objectTypes()) {
    if (!ot.datasource) continue;
    reports.push(materializeCsv(store, ot.apiName, join(datasetsDir, ot.datasource.path)));
  }
  return reports;
}
