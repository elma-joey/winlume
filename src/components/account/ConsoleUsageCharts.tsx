"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ConsoleEmptyState } from "@/components/console/ConsolePage";
import { DEFAULT_QUOTA_PER_UNIT } from "@/lib/catalog/plaza-display";
import { cn } from "@/lib/utils";
import type { ConsoleAccountUsageItem, ConsoleUsageCharts, ConsoleUsageModelSlice, ConsoleUsagePoint } from "@/lib/console/types";

function number(value: number) {
  return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 }).format(value);
}

function shortDate(isoDate: string) {
  const parsed = new Date(`${isoDate}T00:00:00Z`);
  return Number.isNaN(parsed.getTime())
    ? isoDate
    : new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric", timeZone: "UTC" }).format(parsed);
}

function DailyTrend({ points }: { points: ConsoleUsagePoint[] }) {
  const width = 640;
  const height = 220;
  const pad = { top: 16, right: 12, bottom: 28, left: 36 };
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;
  const maxCredits = Math.max(...points.map((point) => point.credits), 0);
  const maxRequests = Math.max(...points.map((point) => point.requests), 0);
  const scaleY = maxCredits > 0 ? maxCredits : 1;
  const barScale = maxRequests > 0 ? maxRequests : 1;
  const last = Math.max(points.length - 1, 1);

  const x = (index: number) => pad.left + (index / last) * innerW;
  const y = (value: number) => pad.top + innerH - (value / scaleY) * innerH;
  const line = points.map((point, index) => `${index === 0 ? "M" : "L"}${x(index).toFixed(1)} ${y(point.credits).toFixed(1)}`).join(" ");
  const area = `${line} L${x(points.length - 1).toFixed(1)} ${(pad.top + innerH).toFixed(1)} L${x(0).toFixed(1)} ${(pad.top + innerH).toFixed(1)} Z`;
  const ticks = [0, 0.5, 1].map((ratio) => ({
    y: pad.top + innerH * (1 - ratio),
    label: number(scaleY * ratio * 300),
  }));
  const labelEvery = Math.max(1, Math.ceil(points.length / 7));

  return (
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="近 14 天已结算额度趋势" className="h-56 w-full">
      {ticks.map((tick) => (
        <g key={tick.y}>
          <line x1={pad.left} x2={width - pad.right} y1={tick.y} y2={tick.y} className="stroke-line" strokeWidth="1" />
          <text x={pad.left - 8} y={tick.y + 3} textAnchor="end" className="fill-ink-400 text-[10px]">{tick.label}</text>
        </g>
      ))}
      {points.map((point, index) => {
        const barWidth = Math.max(innerW / points.length - 6, 4);
        const barHeight = (point.requests / barScale) * innerH * 0.45;
        return (
          <rect
            key={`bar-${point.date}`}
            x={x(index) - barWidth / 2}
            y={pad.top + innerH - barHeight}
            width={barWidth}
            height={barHeight}
            className="fill-sky-200/80"
          >
            <title>{`${point.date} · ${point.requests} 次请求`}</title>
          </rect>
        );
      })}
      <path d={area} className="fill-primary-500/10" />
      <path d={line} className="stroke-primary-500" fill="none" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      {points.map((point, index) => (
        <circle key={`dot-${point.date}`} cx={x(index)} cy={y(point.credits)} r="2.5" className="fill-primary-500">
          <title>{`${point.date} · ${number(point.credits * 300)} 额度`}</title>
        </circle>
      ))}
      {points.map((point, index) => (
        index % labelEvery === 0 || index === points.length - 1 ? (
          <text key={`label-${point.date}`} x={x(index)} y={height - 8} textAnchor="middle" className="fill-ink-400 text-[10px]">
            {shortDate(point.date)}
          </text>
        ) : null
      ))}
    </svg>
  );
}

function DistributionList({
  items,
  emptyTitle,
  emptyDescription,
}: {
  items: Array<{ id: string; label: string; hint: string; value: number }>;
  emptyTitle: string;
  emptyDescription: string;
}) {
  const max = Math.max(...items.map((item) => item.value), 0);
  if (items.length === 0 || max <= 0) {
    return <ConsoleEmptyState title={emptyTitle} description={emptyDescription} />;
  }
  return (
    <ul className="space-y-3">
      {items.map((item) => (
        <li key={item.id}>
          <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
            <span className="truncate font-mono text-xs text-ink-800">{item.label}</span>
            <span className="shrink-0 text-xs text-ink-500">{item.hint}</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-canvas">
            <div
              className="h-full rounded-full bg-primary-500"
              style={{ width: `${Math.max((item.value / max) * 100, 2)}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

export function ConsoleUsageCharts({
  charts,
  keys,
  className,
}: {
  charts: ConsoleUsageCharts | null;
  keys: ConsoleAccountUsageItem[];
  className?: string;
}) {
  const daily = charts?.daily ?? [];
  const hasDaily = daily.some((point) => point.requests > 0 || point.credits > 0);
  const models: ConsoleUsageModelSlice[] = charts?.byModel ?? [];
  const visibleKeys = keys.filter((item) => item.kind === "key" && item.totalUsed > 0);

  return (
    <div className={cn("grid gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(18rem,1fr)]", className)}>
      <Card>
        <CardHeader>
          <CardTitle>近 14 天趋势</CardTitle>
          <CardDescription>折线是已结算额度，浅色柱是请求次数。流式请求在结束后计入。</CardDescription>
        </CardHeader>
        <CardContent>
          {hasDaily ? <DailyTrend points={daily} /> : (
            <ConsoleEmptyState title="暂无趋势数据" description="该工作区近 14 天还没有可汇总的已结算请求。" />
          )}
        </CardContent>
      </Card>
      <div className="grid gap-4">
        <Card>
          <CardHeader>
            <CardTitle>模型分布</CardTitle>
            <CardDescription>按已结算额度排序，最多展示 7 个模型。</CardDescription>
          </CardHeader>
          <CardContent>
            <DistributionList
              items={models.map((item) => ({
                id: item.model,
                label: item.model,
                hint: `${number(item.credits * 300)} · ${item.requests} 次`,
                value: item.credits || item.requests,
              }))}
              emptyTitle="暂无模型用量"
              emptyDescription="有请求结算后，会按模型汇总额度。"
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>用量最高的 Key</CardTitle>
            <CardDescription>工作区额度账户下各 Key 的累计消耗。</CardDescription>
          </CardHeader>
          <CardContent>
            <DistributionList
              items={visibleKeys.map((item) => ({
                id: item.apiKeyId,
                label: item.name,
                hint: number(item.totalUsed / DEFAULT_QUOTA_PER_UNIT),
                value: item.totalUsed,
              }))}
              emptyTitle="暂无 Key 用量"
              emptyDescription="该工作区下的 Key 还没有产生已结算用量。"
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
