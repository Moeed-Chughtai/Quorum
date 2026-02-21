import React from "react";

export const CATEGORY_COLORS: Record<string, { bg: string; text: string; border: string }> = {
    coding: { bg: "bg-violet-50", text: "text-violet-600", border: "border-violet-200" },
    reasoning: { bg: "bg-amber-50", text: "text-amber-700", border: "border-amber-200" },
    research: { bg: "bg-sky-50", text: "text-sky-600", border: "border-sky-200" },
    writing: { bg: "bg-emerald-50", text: "text-emerald-600", border: "border-emerald-200" },
    vision: { bg: "bg-pink-50", text: "text-pink-600", border: "border-pink-200" },
    math: { bg: "bg-orange-50", text: "text-orange-600", border: "border-orange-200" },
    data: { bg: "bg-teal-50", text: "text-teal-600", border: "border-teal-200" },
    general: { bg: "bg-stone-50", text: "text-stone-500", border: "border-stone-200" },
};

export function CategoryBadge({ category }: { category: string }) {
    const c = CATEGORY_COLORS[category] ?? CATEGORY_COLORS.general;
    return (
        <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium uppercase tracking-wider ${c.bg} ${c.text} border ${c.border}`}>
            {category}
        </span>
    );
}
