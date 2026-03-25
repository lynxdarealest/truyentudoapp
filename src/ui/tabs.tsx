import React from "react";
import clsx from "clsx";

type Tab = { key: string; label: string };

type TabsProps = {
  tabs: Tab[];
  active: string;
  onChange: (key: string) => void;
  variant?: "pill" | "underline";
  className?: string;
};

export const TFTabs: React.FC<TabsProps> = ({ tabs, active, onChange, variant = "pill", className }) => {
  if (variant === "underline") {
    return (
      <div className={clsx("flex gap-4 border-b border-slate-800", className)}>
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => onChange(t.key)}
            className={clsx(
              "pb-3 text-sm font-semibold transition-colors",
              active === t.key ? "text-slate-200 border-b-2 border-indigo-500" : "text-slate-400 hover:text-slate-200"
            )}
          >
            {t.label}
          </button>
        ))}
      </div>
    );
  }

  return (
    <div className={clsx("tf-pill-tabs", className)}>
      {tabs.map((t) => (
        <button
          key={t.key}
          onClick={() => onChange(t.key)}
          className={clsx(
            "tf-pill-btn",
            active === t.key ? "bg-indigo-600 text-white" : "text-slate-200 hover:bg-slate-800"
          )}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
};
