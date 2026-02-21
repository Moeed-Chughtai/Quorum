import React from "react";

export const CATEGORY_COLORS: Record<string, { bg: string; text: string; border: string }> = {
    coding: { bg: "bg-violet-500/10", text: "text-violet-400", border: "border-violet-500/30" },
    reasoning: { bg: "bg-amber-500/10", text: "text-amber-400", border: "border-amber-500/30" },
    research: { bg: "bg-cyan-500/10", text: "text-cyan-400", border: "border-cyan-500/30" },
    writing: { bg: "bg-emerald-500/10", text: "text-emerald-400", border: "border-emerald-500/30" },
    vision: { bg: "bg-pink-500/10", text: "text-pink-400", border: "border-pink-500/30" },
    math: { bg: "bg-orange-500/10", text: "text-orange-400", border: "border-orange-500/30" },
    data: { bg: "bg-teal-500/10", text: "text-teal-400", border: "border-teal-500/30" },
    general: { bg: "bg-zinc-500/10", text: "text-zinc-400", border: "border-zinc-500/30" },
};

export function CategoryBadge({ category }: { category: string }) {
    const c = CATEGORY_COLORS[category] ?? CATEGORY_COLORS.general;
    return (
        <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${c.bg} ${c.text} border ${c.border}`}>
            {category}
        </span>
    );
}
