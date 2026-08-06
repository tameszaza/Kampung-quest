"use client";

export interface TabOption {
  label: string;
  count?: number;
  showZero?: boolean;
  countStyle?: "badge" | "parentheses";
}

export function Tabs({
  tabs,
  active,
  onChange,
}: {
  tabs: Array<string | TabOption>;
  active: string;
  onChange: (tab: string) => void;
}) {
  const options = tabs.map((tab) => typeof tab === "string" ? { label: tab } : tab);

  return (
    <div
      className="tabs"
      role="tablist"
      style={{ gridTemplateColumns: `repeat(${Math.max(1, options.length)}, minmax(0, 1fr))` }}
    >
      {options.map(({ label, count, showZero, countStyle = "badge" }) => {
        const showBadge = count !== undefined && (showZero || count > 0);
        return (
          <button
            key={label}
            type="button"
            role="tab"
            aria-label={showBadge ? `${label}, ${count}` : label}
            aria-selected={active === label}
            className={active === label ? "active" : ""}
            onClick={() => onChange(label)}
          >
            <span>{label}</span>
            {showBadge && countStyle === "badge" ? <span className="tab-badge" aria-hidden="true">{count > 99 ? "99+" : count}</span> : null}
            {showBadge && countStyle === "parentheses" ? <span className="tab-count-parentheses" aria-hidden="true"> ({count > 99 ? "99+" : count})</span> : null}
          </button>
        );
      })}
    </div>
  );
}
