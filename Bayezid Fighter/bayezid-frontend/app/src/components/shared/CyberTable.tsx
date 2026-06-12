import { ReactNode } from 'react';

export interface CyberTableColumn {
  key: string;
  label: string;
  render?: (val: any, row: any) => ReactNode;
}

export interface CyberTableProps {
  columns: CyberTableColumn[];
  data: any[];
  loading?: boolean;
  emptyMessage?: string;
  onRowClick?: (row: any) => void;
}

export function CyberTable({ columns, data, loading, emptyMessage = 'No data', onRowClick }: CyberTableProps) {
  if (loading) {
    return (
      <div className="rounded-xl border border-slate-800 bg-slate-900/60 overflow-hidden w-full">
        <table className="w-full text-left">
          <thead className="bg-slate-800/50">
            <tr>
              {columns.map(c => (
                <th key={c.key} className="px-4 py-3 text-[10px] tracking-widest uppercase text-slate-400">
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {[...Array(5)].map((_, i) => (
              <tr key={i} className="border-t border-slate-800/50">
                {columns.map(c => (
                  <td key={c.key} className="px-4 py-4">
                    <div className="h-4 bg-slate-800 rounded animate-pulse w-full"></div>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  if (!data || data.length === 0) {
    return (
      <div className="rounded-xl border border-slate-800 bg-slate-900/60 overflow-hidden w-full h-32 flex items-center justify-center text-slate-500 text-sm">
        <div className="flex flex-col items-center gap-2">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="opacity-50"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><line x1="9" y1="9" x2="15" y2="15"></line><line x1="15" y1="9" x2="9" y2="15"></line></svg>
          {emptyMessage}
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/60 overflow-hidden w-full">
      <table className="w-full text-left">
        <thead className="bg-slate-800/50">
          <tr>
            {columns.map(c => (
              <th key={c.key} className="px-4 py-3 text-[10px] tracking-widest uppercase text-slate-400">
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((row, rowIndex) => (
            <tr 
              key={row.id || rowIndex} 
              onClick={() => onRowClick && onRowClick(row)}
              className={`border-t border-slate-800/50 transition-colors text-xs text-slate-300 ${
                rowIndex % 2 === 0 ? 'bg-transparent' : 'bg-slate-900/30'
              } ${onRowClick ? 'cursor-pointer hover:bg-slate-800/40 hover:border-l-2 hover:border-l-cyan-500' : 'hover:bg-slate-800/20'}`}
            >
              {columns.map(c => (
                <td key={c.key} className="px-4 py-3">
                  {c.render ? c.render(row[c.key], row) : row[c.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
