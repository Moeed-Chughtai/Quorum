'use client';

import React, { useState, useMemo } from 'react';
import { type DecomposeResult } from '@/lib/api';

// ── Fake marketplace data ─────────────────────────────────────────────────────

const FAKE_WORKFLOWS = [
  {
    id: 'f1',
    title: 'SEO Content Suite',
    description: 'Keyword research, long-form article drafting, meta optimisation, and internal link suggestions — all in parallel.',
    category: 'content',
    agentCount: 6,
    models: ['gemma3:4b', 'gemma3:12b'],
    carbonRating: 'A+',
    stars: 4.9,
    uses: '3.2k',
    tags: ['SEO', 'Blog', 'Writing'],
  },
  {
    id: 'f2',
    title: 'Code Review & Security Audit',
    description: 'Static analysis, dependency vulnerability scan, test coverage report, and executive PR summary.',
    category: 'code',
    agentCount: 5,
    models: ['codegemma:7b', 'gemma3:4b'],
    carbonRating: 'A+',
    stars: 4.8,
    uses: '2.7k',
    tags: ['Security', 'Testing', 'CI/CD'],
  },
  {
    id: 'f3',
    title: 'Research Synthesis Engine',
    description: 'Multi-source literature review, claim extraction, contradiction detection, and executive summary generation.',
    category: 'research',
    agentCount: 7,
    models: ['gemma3:12b', 'gemma3:27b'],
    carbonRating: 'A',
    stars: 4.7,
    uses: '1.8k',
    tags: ['Academic', 'Citations', 'Summary'],
  },
  {
    id: 'f4',
    title: 'Data Analysis Pipeline',
    description: 'Schema inference, outlier detection, trend analysis, and automated chart generation from raw CSV or JSON.',
    category: 'data',
    agentCount: 6,
    models: ['gemma3:4b', 'gemma3:12b'],
    carbonRating: 'A+',
    stars: 4.9,
    uses: '4.1k',
    tags: ['CSV', 'Insights', 'Charts'],
  },
  {
    id: 'f5',
    title: 'Legal Document Reviewer',
    description: 'Contract clause extraction, risk flagging, obligation tracking, and plain-English summary for non-lawyers.',
    category: 'legal',
    agentCount: 5,
    models: ['gemma3:12b', 'gemma3:27b'],
    carbonRating: 'A',
    stars: 4.6,
    uses: '987',
    tags: ['Contracts', 'Risk', 'Compliance'],
  },
  {
    id: 'f6',
    title: 'Product Launch Strategy',
    description: 'Competitive landscape analysis, positioning statement, go-to-market messaging, and a launch checklist.',
    category: 'business',
    agentCount: 8,
    models: ['gemma3:4b', 'gemma3:12b', 'gemma3:27b'],
    carbonRating: 'A',
    stars: 4.8,
    uses: '1.4k',
    tags: ['GTM', 'Positioning', 'Strategy'],
  },
  {
    id: 'f7',
    title: 'Social Media Campaign',
    description: 'Audience research, content calendar, platform-specific copy, hashtag strategy, and performance benchmarks.',
    category: 'marketing',
    agentCount: 5,
    models: ['gemma3:4b', 'gemma3:12b'],
    carbonRating: 'A+',
    stars: 4.7,
    uses: '2.1k',
    tags: ['Instagram', 'LinkedIn', 'Twitter'],
  },
  {
    id: 'f8',
    title: 'Customer Support Automator',
    description: 'Intent classification, knowledge base retrieval, draft response generation, and escalation path routing.',
    category: 'support',
    agentCount: 4,
    models: ['gemma3:4b', 'phi4:14b'],
    carbonRating: 'A+',
    stars: 4.5,
    uses: '3.8k',
    tags: ['Tickets', 'NLP', 'Routing'],
  },
  {
    id: 'f9',
    title: 'Financial Report Analyser',
    description: 'Balance sheet parsing, ratio computation, peer benchmarking, and narrative summary for investor decks.',
    category: 'data',
    agentCount: 7,
    models: ['gemma3:12b', 'gemma3:27b'],
    carbonRating: 'A',
    stars: 4.8,
    uses: '1.2k',
    tags: ['Finance', 'KPIs', 'Reporting'],
  },
  {
    id: 'f10',
    title: 'Academic Literature Review',
    description: 'Abstract screening, theme clustering, citation network mapping, and structured literature review generation.',
    category: 'research',
    agentCount: 6,
    models: ['gemma3:12b', 'gemma3:4b'],
    carbonRating: 'A',
    stars: 4.6,
    uses: '743',
    tags: ['Papers', 'Citations', 'Synthesis'],
  },
  {
    id: 'f11',
    title: 'Brand Identity Kit',
    description: 'Brand audit, tone-of-voice guidelines, tagline variants, colour palette brief, and naming conventions.',
    category: 'design',
    agentCount: 5,
    models: ['gemma3:4b', 'gemma3:12b'],
    carbonRating: 'A+',
    stars: 4.7,
    uses: '1.6k',
    tags: ['Branding', 'Copy', 'Guidelines'],
  },
];

const CATEGORIES = ['All', 'content', 'code', 'research', 'data', 'legal', 'business', 'marketing', 'support', 'design'];

const CATEGORY_META: Record<string, { label: string; color: string; bg: string; border: string }> = {
  content:   { label: 'Content',   color: '#a78bfa', bg: 'rgba(167,139,250,0.08)', border: 'rgba(167,139,250,0.5)' },
  code:      { label: 'Code',      color: '#60a5fa', bg: 'rgba(96,165,250,0.08)',  border: 'rgba(96,165,250,0.5)'  },
  research:  { label: 'Research',  color: '#fbbf24', bg: 'rgba(251,191,36,0.08)',  border: 'rgba(251,191,36,0.5)'  },
  data:      { label: 'Data',      color: '#22d3ee', bg: 'rgba(34,211,238,0.08)',  border: 'rgba(34,211,238,0.5)'  },
  legal:     { label: 'Legal',     color: '#94a3b8', bg: 'rgba(148,163,184,0.08)', border: 'rgba(148,163,184,0.5)' },
  business:  { label: 'Business',  color: '#818cf8', bg: 'rgba(129,140,248,0.08)', border: 'rgba(129,140,248,0.5)' },
  marketing: { label: 'Marketing', color: '#f472b6', bg: 'rgba(244,114,182,0.08)', border: 'rgba(244,114,182,0.5)' },
  support:   { label: 'Support',   color: '#34d399', bg: 'rgba(52,211,153,0.08)',  border: 'rgba(52,211,153,0.5)'  },
  design:    { label: 'Design',    color: '#fb923c', bg: 'rgba(251,146,60,0.08)',  border: 'rgba(251,146,60,0.5)'  },
};

// ── Sub-components ────────────────────────────────────────────────────────────

function Stars({ value }: { value: number }) {
  return (
    <span className="flex items-center gap-1">
      <svg className="w-3 h-3" viewBox="0 0 24 24" fill="#fbbf24">
        <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
      </svg>
      <span className="text-[11px] font-semibold tabular-nums" style={{ color: 'var(--text-primary)' }}>{value.toFixed(1)}</span>
    </span>
  );
}

function CarbonPill({ rating }: { rating: string }) {
  const c = rating === 'A+' ? '#10b981' : '#84cc16';
  return (
    <span
      className="text-[9px] font-bold px-1.5 py-0.5 rounded-full border tracking-wide"
      style={{ color: c, borderColor: c + '40', background: c + '14' }}
    >
      🌿 {rating}
    </span>
  );
}

function CategoryPill({ category, size = 'sm' }: { category: string; size?: 'sm' | 'xs' }) {
  const m = CATEGORY_META[category];
  if (!m) return null;
  return (
    <span
      className={`font-semibold uppercase tracking-[0.1em] rounded-full px-2 py-0.5 ${size === 'xs' ? 'text-[8px]' : 'text-[9px]'}`}
      style={{ color: m.color, background: m.bg }}
    >
      {m.label}
    </span>
  );
}

function ModelChip({ name }: { name: string }) {
  return (
    <span
      className="text-[9px] font-mono px-1.5 py-0.5 rounded border"
      style={{ color: 'var(--text-tertiary)', borderColor: 'var(--border)', background: 'var(--surface-raised)' }}
    >
      {name}
    </span>
  );
}

// ── Featured real card (full-width horizontal) ────────────────────────────────

function FeaturedRealCard({ result, onSelect }: { result: DecomposeResult; onSelect: () => void }) {
  const uniqueModels = Array.from(new Set(result.subtasks.map(s => s.assigned_model)));
  const categories = Array.from(new Set(result.subtasks.map(s => s.category)));
  const topCategory = categories[0] ?? 'content';
  const meta = CATEGORY_META[topCategory] ?? CATEGORY_META.content;

  const title = result.original_prompt.length > 80
    ? result.original_prompt.slice(0, 80) + '…'
    : result.original_prompt;

  return (
    <div
      onClick={onSelect}
      className="group relative rounded-2xl border overflow-hidden cursor-pointer transition-all duration-300 hover:shadow-2xl"
      style={{
        borderColor: meta.border,
        background: 'var(--surface)',
        boxShadow: `0 0 0 1px ${meta.border}`,
      }}
    >
      {/* Gradient top accent */}
      <div className="h-[3px]" style={{ background: `linear-gradient(90deg, ${meta.color}, var(--accent))` }} />

      <div className="flex items-stretch">
        {/* Left: info */}
        <div className="flex-1 px-6 py-5">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-[9px] font-bold uppercase tracking-[0.2em] flex items-center gap-1.5" style={{ color: 'var(--accent)' }}>
              <span style={{ color: 'var(--accent)' }}>✦</span> Generated for your prompt
            </span>
            <CategoryPill category={topCategory} size="xs" />
            <CarbonPill rating="A+" />
          </div>

          <h2 className="text-[17px] font-semibold leading-snug mb-1.5 group-hover:opacity-90 transition-opacity" style={{ color: 'var(--text-primary)' }}>
            {title}
          </h2>
          <p className="text-[12px] mb-4" style={{ color: 'var(--text-tertiary)' }}>
            {result.subtasks.length} specialised agents · runs in parallel · carbon-optimised routing
          </p>

          {/* Divider */}
          <div className="h-px mb-3" style={{ background: 'var(--border)' }} />

          {/* Models */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[9px] uppercase tracking-wider mr-1" style={{ color: 'var(--text-tertiary)' }}>Models</span>
            {uniqueModels.map(m => <ModelChip key={m} name={m} />)}
            {categories.slice(0, 4).map(cat => <CategoryPill key={cat} category={cat} size="xs" />)}
          </div>
        </div>

        {/* Right: stats + CTA */}
        <div
          className="shrink-0 w-52 flex flex-col items-stretch justify-between px-5 py-5 border-l"
          style={{ borderColor: 'var(--border)', background: 'var(--surface-raised)' }}
        >
          <div className="space-y-2">
            <div>
              <div className="text-[9px] uppercase tracking-wider mb-1" style={{ color: 'var(--text-tertiary)' }}>Agents</div>
              <div className="text-[28px] font-extralight tabular-nums leading-none" style={{ color: 'var(--text-primary)' }}>
                {result.subtasks.length}
              </div>
            </div>
            <div className="h-1 rounded-full overflow-hidden" style={{ background: 'var(--border)' }}>
              <div
                className="h-full rounded-full"
                style={{
                  width: `${Math.min(100, (result.subtasks.length / 10) * 100)}%`,
                  background: `linear-gradient(90deg, var(--accent), ${meta.color})`,
                }}
              />
            </div>
            <div className="text-[9px]" style={{ color: 'var(--text-tertiary)' }}>Just created · unique to you</div>
          </div>

          <button
            onClick={(e) => { e.stopPropagation(); onSelect(); }}
            className="w-full py-2.5 rounded-xl text-[13px] font-semibold text-white flex items-center justify-center gap-2 transition-all duration-200 hover:opacity-90 active:scale-[0.98]"
            style={{ background: 'var(--accent)' }}
          >
            Run workflow
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Standard fake workflow card ───────────────────────────────────────────────

function WorkflowCard({ w }: { w: typeof FAKE_WORKFLOWS[0] }) {
  const meta = CATEGORY_META[w.category] ?? CATEGORY_META.content;

  return (
    <div
      className="group relative rounded-xl border overflow-hidden transition-all duration-200 hover:shadow-lg hover:-translate-y-0.5 flex flex-col"
      style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}
    >
      {/* Left category accent bar */}
      <div className="absolute left-0 top-0 bottom-0 w-[3px] rounded-l-xl" style={{ background: meta.color }} />

      <div className="pl-5 pr-4 pt-4 pb-4 flex flex-col flex-1">
        {/* Header row */}
        <div className="flex items-start justify-between gap-2 mb-3">
          <CategoryPill category={w.category} />
          <Stars value={w.stars} />
        </div>

        {/* Title + description */}
        <h3 className="text-[13px] font-semibold leading-snug mb-1.5 group-hover:text-[var(--accent)] transition-colors" style={{ color: 'var(--text-primary)' }}>
          {w.title}
        </h3>
        <p className="text-[11px] leading-relaxed line-clamp-2 mb-4" style={{ color: 'var(--text-tertiary)' }}>
          {w.description}
        </p>

        {/* Divider */}
        <div className="h-px mb-3" style={{ background: 'var(--border)' }} />

        {/* Models */}
        <div className="mb-3">
          <div className="text-[8px] uppercase tracking-wider mb-1.5" style={{ color: 'var(--text-tertiary)' }}>Models</div>
          <div className="flex flex-wrap gap-1">
            {w.models.map((m, i) => <ModelChip key={i} name={m} />)}
          </div>
        </div>

        {/* Tags */}
        <div className="flex flex-wrap gap-1 mb-4">
          {w.tags.map(tag => (
            <span
              key={tag}
              className="text-[8px] px-1.5 py-0.5 rounded-full border"
              style={{ color: 'var(--text-tertiary)', borderColor: 'var(--border)' }}
            >
              {tag}
            </span>
          ))}
        </div>

        {/* Stats row */}
        <div className="flex items-center gap-3 mb-3 mt-auto">
          <span className="text-[9px] font-mono tabular-nums flex items-center gap-1" style={{ color: 'var(--text-tertiary)' }}>
            <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z" />
            </svg>
            {w.uses}
          </span>
          <span className="text-[9px] font-mono" style={{ color: 'var(--text-tertiary)' }}>{w.agentCount} agents</span>
          <div className="ml-auto">
            <CarbonPill rating={w.carbonRating} />
          </div>
        </div>

        {/* CTA */}
        <button
          disabled
          className="w-full py-2 rounded-lg text-[11px] font-medium border transition-all cursor-not-allowed opacity-50"
          style={{ borderColor: 'var(--border)', color: 'var(--text-tertiary)', background: 'var(--surface-raised)' }}
          title="Sign in to use marketplace workflows"
        >
          Use Workflow
        </button>
      </div>
    </div>
  );
}

// ── Main marketplace component ─────────────────────────────────────────────────

interface Props {
  result: DecomposeResult;
  onSelectReal: () => void;
}

export default function WorkflowMarketplace({ result, onSelectReal }: Props) {
  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState('All');

  const filteredFake = useMemo(() => {
    let list = FAKE_WORKFLOWS;
    if (activeCategory !== 'All') list = list.filter(w => w.category === activeCategory);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(w =>
        w.title.toLowerCase().includes(q) ||
        w.description.toLowerCase().includes(q) ||
        w.tags.some(t => t.toLowerCase().includes(q))
      );
    }
    return list;
  }, [search, activeCategory]);

  return (
    <div className="flex-1 overflow-y-auto" style={{ background: 'var(--bg)' }}>
      {/* ── Page header ── */}
      <div className="border-b" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
        <div className="max-w-5xl mx-auto px-6 py-6">
          <div className="flex items-center justify-between gap-6">
            <div>
              <p className="text-[9px] uppercase tracking-[0.25em] font-bold mb-1.5" style={{ color: 'var(--accent)' }}>
                Workflow Marketplace
              </p>
              <h1 className="text-[22px] font-light tracking-tight" style={{ color: 'var(--text-primary)' }}>
                Find, run, and deploy AI workflows
              </h1>
            </div>

            {/* Search */}
            <div className="relative shrink-0 w-64">
              <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 pointer-events-none" style={{ color: 'var(--text-tertiary)' }} fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
              </svg>
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search workflows…"
                className="w-full pl-9 pr-4 py-2 rounded-xl text-[12px] border outline-none transition-all focus:border-[var(--accent)]"
                style={{ background: 'var(--surface-raised)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
              />
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-6 py-6">
        {/* ── Featured card ── */}
        <div className="mb-8">
          <div className="flex items-center justify-between mb-3">
            <span className="text-[10px] font-semibold uppercase tracking-[0.15em]" style={{ color: 'var(--text-tertiary)' }}>
              ✦ Your workflow
            </span>
          </div>
          <FeaturedRealCard result={result} onSelect={onSelectReal} />
        </div>

        {/* ── Divider ── */}
        <div className="flex items-center gap-4 mb-6">
          <div className="h-px flex-1" style={{ background: 'var(--border)' }} />
          <span className="text-[10px] uppercase tracking-[0.15em] shrink-0" style={{ color: 'var(--text-tertiary)' }}>
            More from the marketplace
          </span>
          <div className="h-px flex-1" style={{ background: 'var(--border)' }} />
        </div>

        {/* ── Category filters ── */}
        <div className="flex items-center gap-2 flex-wrap mb-6">
          {CATEGORIES.map(cat => {
            const isActive = activeCategory === cat;
            const meta = CATEGORY_META[cat];
            return (
              <button
                key={cat}
                onClick={() => setActiveCategory(cat)}
                className="px-3 py-1 rounded-full text-[10px] font-semibold border transition-all"
                style={{
                  borderColor: isActive ? (meta?.color ?? 'var(--accent)') : 'var(--border)',
                  background: isActive ? (meta?.bg ?? 'var(--accent-subtle)') : 'transparent',
                  color: isActive ? (meta?.color ?? 'var(--accent)') : 'var(--text-tertiary)',
                }}
              >
                {meta?.label ?? 'All'}
              </button>
            );
          })}
          <span className="ml-auto text-[10px]" style={{ color: 'var(--text-tertiary)' }}>
            {filteredFake.length} workflow{filteredFake.length !== 1 ? 's' : ''}
          </span>
        </div>

        {/* ── Grid ── */}
        {filteredFake.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredFake.map(w => <WorkflowCard key={w.id} w={w} />)}
          </div>
        ) : (
          <div className="py-20 text-center">
            <div className="w-12 h-12 rounded-2xl border flex items-center justify-center mx-auto mb-4" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
              <svg className="w-5 h-5" style={{ color: 'var(--text-tertiary)' }} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
              </svg>
            </div>
            <p className="text-[13px]" style={{ color: 'var(--text-tertiary)' }}>No marketplace workflows match</p>
            <p className="text-[11px] mt-1" style={{ color: 'var(--text-tertiary)', opacity: 0.6 }}>Your generated workflow is ready above</p>
          </div>
        )}

        {/* Footer */}
        <div className="mt-12 pb-8 flex items-center justify-between">
          <p className="text-[10px] uppercase tracking-[0.15em]" style={{ color: 'var(--text-tertiary)' }}>
            {FAKE_WORKFLOWS.length + 1} workflows · updated daily
          </p>
          <p className="text-[10px]" style={{ color: 'var(--text-tertiary)', opacity: 0.5 }}>
            Marketplace workflows are for demo purposes
          </p>
        </div>
      </div>
    </div>
  );
}
