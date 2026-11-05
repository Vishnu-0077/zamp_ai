import { useState, type ReactNode } from 'react';

export interface TabDef {
  id: string;
  label: ReactNode;
  render: () => ReactNode;
  hidden?: boolean;
}

/** Tab strip driven by a definition array: add a tab by appending a TabDef. */
export function Tabs({ tabs, initial, onChange }: { tabs: TabDef[]; initial?: string; onChange?: (id: string) => void }) {
  const visible = tabs.filter((t) => !t.hidden);
  const [active, setActive] = useState(initial && visible.some((t) => t.id === initial) ? initial : visible[0]?.id);
  const current = visible.find((t) => t.id === active) ?? visible[0];
  return (
    <div>
      <div className="tabs" role="tablist">
        {visible.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={t.id === current?.id}
            onClick={() => {
              setActive(t.id);
              onChange?.(t.id);
            }}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div role="tabpanel">{current?.render()}</div>
    </div>
  );
}
