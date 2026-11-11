"use client";

import type { ColumnDef, PaginationState } from "@tanstack/react-table";
import { Check, Copy, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { DataTable } from "@/components/data-table/data-table";
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import { DataTableToolbar } from "@/components/data-table/data-table-toolbar";
import { useDataTable } from "@/components/data-table/use-data-table";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { ConsoleEmptyState } from "@/components/console/ConsolePage";
import { getConsoleUsageLogs } from "@/lib/console/client";
import type { ConsoleUsageLog, ConsoleUsageLogType } from "@/lib/console/types";

function dateTime(value: string) {
  if (!value) return "--";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? "--"
    : new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(parsed);
}

function number(value: number) {
  return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 4 }).format(value);
}

const columns: ColumnDef<ConsoleUsageLog>[] = [
  {
    accessorKey: "createdAt",
    header: ({ column }) => <DataTableColumnHeader column={column} title="时间" />,
    cell: ({ row }) => <span className="text-xs text-ink-500">{dateTime(row.original.createdAt)}</span>,
    meta: { label: "时间" },
  },
  {
    accessorKey: "tokenName",
    header: ({ column }) => <DataTableColumnHeader column={column} title="Key" />,
    cell: ({ row }) => <span className="text-sm text-ink-800">{row.original.tokenName || "--"}</span>,
    meta: { label: "Key" },
  },
  {
    accessorKey: "model",
    header: ({ column }) => <DataTableColumnHeader column={column} title="模型" />,
    cell: ({ row }) => <span className="font-mono text-xs text-ink-800">{row.original.model || "--"}</span>,
    meta: { label: "模型" },
  },
  {
    accessorKey: "type",
    header: ({ column }) => <DataTableColumnHeader column={column} title="状态" />,
    cell: ({ row }) => {
      if (row.original.type === "error") return <Badge variant="destructive">失败</Badge>;
      if (row.original.type === "consume") return <Badge variant="success">成功</Badge>;
      return <Badge variant="outline">其他</Badge>;
    },
    meta: { label: "状态" },
  },
  {
    id: "tokens",
    header: "Tokens",
    cell: ({ row }) => (
      <span className="font-mono text-xs text-ink-700">
        {number(row.original.promptTokens)} / {number(row.original.completionTokens)}
      </span>
    ),
    enableSorting: false,
    meta: { label: "Tokens" },
  },
  {
    accessorKey: "durationSeconds",
    header: ({ column }) => <DataTableColumnHeader column={column} title="耗时" />,
    cell: ({ row }) => <span className="font-mono text-xs text-ink-700">{number(row.original.durationSeconds)}s</span>,
    meta: { label: "耗时" },
  },
  {
    accessorKey: "credits",
    header: ({ column }) => <DataTableColumnHeader column={column} title="费用" />,
    cell: ({ row }) => <span className="font-mono text-xs text-ink-700">{number(row.original.credits * 300)}</span>,
    meta: { label: "费用" },
  },
  {
    accessorKey: "requestId",
    header: ({ column }) => <DataTableColumnHeader column={column} title="请求 ID" />,
    cell: ({ row }) => <span className="font-mono text-xs text-ink-500">{row.original.requestId || "--"}</span>,
    meta: { label: "请求 ID" },
  },
];

function DetailRow({ label, value, copyable }: { label: string; value: string; copyable?: boolean }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  }
  return (
    <div className="grid grid-cols-[7rem_minmax(0,1fr)] items-start gap-3 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="flex min-w-0 items-start gap-2">
        <span className="break-all text-foreground">{value}</span>
        {copyable && value !== "--" ? (
          <Button type="button" variant="ghost" size="icon" className="size-6 shrink-0" onClick={() => void copy()} aria-label={`复制${label}`}>
            {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
          </Button>
        ) : null}
      </dd>
    </div>
  );
}

export function ConsoleUsageLogs({
  organizationId,
  resolving = false,
}: {
  organizationId: string | null;
  /** True while the caller is still resolving which workspace is active — avoids flashing the "no workspace" empty state before that's known. */
  resolving?: boolean;
}) {
  const [items, setItems] = useState<ConsoleUsageLog[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(Boolean(organizationId));
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<ConsoleUsageLog | null>(null);
  const [status, setStatus] = useState<"all" | ConsoleUsageLogType>("all");
  const [search, setSearch] = useState("");
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 20 });

  // organizationId typically arrives one tick after mount (parent resolves
  // the workspace first). Flip loading=true the instant that happens, in
  // the same render pass — otherwise there's a commit where organizationId
  // is already set but loading/items haven't caught up yet, and the table
  // paints its "empty" state for a frame before the real fetch effect fires.
  const [lastOrganizationId, setLastOrganizationId] = useState(organizationId);
  if (organizationId !== lastOrganizationId) {
    setLastOrganizationId(organizationId);
    if (organizationId) setLoading(true);
    setPagination((current) => (current.pageIndex === 0 ? current : { ...current, pageIndex: 0 }));
  }

  const load = useCallback(async () => {
    if (!organizationId) {
      setItems([]);
      setTotal(0);
      setError(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await getConsoleUsageLogs(organizationId, {
        page: pagination.pageIndex + 1,
        pageSize: pagination.pageSize,
        type: status === "all" ? undefined : status,
      });
      setItems(result.items);
      setTotal(result.total);
    } catch (reason) {
      setItems([]);
      setTotal(0);
      setError(reason instanceof Error ? reason.message : "无法加载请求日志。");
    } finally {
      setLoading(false);
    }
  }, [organizationId, pagination.pageIndex, pagination.pageSize, status]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const pageCount = Math.max(1, Math.ceil(total / pagination.pageSize));
  const table = useDataTable({
    columns,
    data: items,
    getRowId: (row) => row.id,
    manualPagination: true,
    pageCount,
    pagination,
    onPaginationChange: setPagination,
    globalFilter: search,
    onGlobalFilterChange: setSearch,
    initialVisibility: { requestId: false },
  });

  const description = useMemo(() => {
    if (!organizationId) return "加入工作区后可查看该额度账户下的单次请求。";
    if (total > items.length) return `第 ${pagination.pageIndex + 1} 页，共 ${total} 条。不展示渠道路由和倍率。`;
    return "单次请求的模型、耗时和费用。不展示渠道路由和倍率。";
  }, [organizationId, items.length, total, pagination.pageIndex]);

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3">
        <div>
          <CardTitle>请求日志</CardTitle>
          <CardDescription>{description}</CardDescription>
        </div>
        <Button type="button" variant="outline" size="sm" disabled={!organizationId || loading} onClick={() => void load()}>
          {loading ? <Spinner /> : <RefreshCw />}
          刷新
        </Button>
      </CardHeader>
      <CardContent>
        {!organizationId && resolving ? (
          <div className="flex min-h-24 items-center justify-center gap-2 text-sm text-muted-foreground">
            <Spinner /> 正在加载请求日志…
          </div>
        ) : !organizationId ? (
          <ConsoleEmptyState title="还没有工作区" description="请求日志按工作区额度账户查询。" />
        ) : error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : (
          <div className="flex flex-col gap-3">
            <DataTableToolbar table={table} globalSearch searchPlaceholder="搜索模型、Key 或请求 ID…" viewOptionsLabel="筛选列名">
              <Select
                value={status}
                onValueChange={(value) => {
                  setStatus(value as "all" | ConsoleUsageLogType);
                  setPagination((current) => (current.pageIndex === 0 ? current : { ...current, pageIndex: 0 }));
                }}
              >
                <SelectTrigger aria-label="按状态筛选" className="h-8 w-28">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="all">全部状态</SelectItem>
                    <SelectItem value="consume">成功</SelectItem>
                    <SelectItem value="error">失败</SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
            </DataTableToolbar>
            {loading && items.length === 0 ? (
              <div className="flex min-h-24 items-center justify-center gap-2 text-sm text-muted-foreground">
                <Spinner /> 正在加载请求日志…
              </div>
            ) : (
              <DataTable
                table={table}
                columnCount={columns.length}
                emptyTitle="暂无请求日志"
                emptyDescription="没有匹配的请求。换个筛选或等有调用后再看。"
                onRowClick={setSelected}
              />
            )}
          </div>
        )}
      </CardContent>

      <Dialog open={Boolean(selected)} onOpenChange={(open) => { if (!open) setSelected(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>请求详情</DialogTitle>
            <DialogDescription>只展示账户侧可见字段，不含渠道路由和倍率。</DialogDescription>
          </DialogHeader>
          {selected ? (
            <dl className="flex flex-col gap-3">
              <DetailRow label="时间" value={dateTime(selected.createdAt)} />
              <DetailRow label="Key" value={selected.tokenName || "--"} />
              <DetailRow label="模型" value={selected.model || "--"} copyable />
              <DetailRow
                label="状态"
                value={selected.type === "error" ? "失败" : selected.type === "consume" ? "成功" : "其他"}
              />
              <DetailRow label="输入 Tokens" value={number(selected.promptTokens)} />
              <DetailRow label="输出 Tokens" value={number(selected.completionTokens)} />
              <DetailRow label="耗时" value={`${number(selected.durationSeconds)}s`} />
              <DetailRow label="费用" value={number(selected.credits * 300)} />
              <DetailRow label="流式" value={selected.streamed ? "是" : "否"} />
              <DetailRow label="请求 ID" value={selected.requestId || "--"} copyable />
              {selected.content ? <DetailRow label="说明" value={selected.content} /> : null}
            </dl>
          ) : null}
        </DialogContent>
      </Dialog>
    </Card>
  );
}
