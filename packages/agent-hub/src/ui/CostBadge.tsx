/**
 * 成本徽章：把美元成本格式化为紧凑可读形式。
 */
export interface CostBadgeProps {
  costUsd?: number;
  label?: string;
}

/** $1.23 / $0.0123 / --（未知） */
export function formatCost(costUsd?: number): string {
  if (costUsd === undefined || costUsd === null || !Number.isFinite(costUsd)) return '--';
  if (costUsd >= 1) return `$${costUsd.toFixed(2)}`;
  if (costUsd >= 0.01) return `$${costUsd.toFixed(4)}`;
  return `$${costUsd.toFixed(6)}`;
}

export function CostBadge({ costUsd, label = '成本' }: CostBadgeProps) {
  return (
    <span className="sf-ah-cost" title="本次会话/运行的模型开销估算">
      {label} {formatCost(costUsd)}
    </span>
  );
}
