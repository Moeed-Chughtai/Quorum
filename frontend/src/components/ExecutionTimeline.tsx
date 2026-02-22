'use client';

import React, { useMemo } from 'react';
import { type Subtask, type SubtaskExecution, type CarbonSummary } from '@/lib/api';

// ── CO₂ equivalency constants (published sources) ─────────────────────────────
// Driving: EEA 2023 EU fleet average ~120 gCO₂/km
// Phone charge: ~20 Wh × 0.4 kgCO₂/kWh world avg = 8 gCO₂/charge
// Google search: Google Environmental Report 2023 ~0.3 gCO₂/query
// LED 9 W for 1 h: 9 W × 0.475 kgCO₂/kWh world avg = 4.28 gCO₂/h
// Netflix HD 1 h: IEA 2020 revised estimate ~36 gCO₂/h
const EQ = {
    DRIVE_GCO2_PER_KM:    120,
    PHONE_GCO2:             8,
    SEARCH_GCO2:          0.3,
    LED_GCO2_PER_HOUR:   4.28,
    STREAM_GCO2_PER_HOUR:  36,
} as const;

function buildEquivalencies(gco2: number): { icon: string; label: string; value: string }[] {
    const items: { icon: string; label: string; value: string }[] = [];

    const searches = gco2 / EQ.SEARCH_GCO2;
    items.push({ icon: '🔍', label: 'Google searches', value: searches.toFixed(searches < 2 ? 1 : 0) });

    const phoneCharge = gco2 / EQ.PHONE_GCO2;
    items.push({ icon: '📱', label: 'phone charges', value: phoneCharge < 0.1 ? phoneCharge.toFixed(3) : phoneCharge.toFixed(2) });

    const driveKm = gco2 / EQ.DRIVE_GCO2_PER_KM;
    const driveM  = Math.round(driveKm * 1000);
    items.push({
        icon: '🚗',
        label: driveM < 1000 ? 'm of driving' : 'km of driving',
        value: driveM < 1000 ? String(driveM) : driveKm.toFixed(2),
    });

    const ledMins = (gco2 / EQ.LED_GCO2_PER_HOUR) * 60;
    items.push({
        icon: '💡',
        label: 'min LED light',
        value: ledMins < 1 ? ledMins.toFixed(1) : Math.round(ledMins).toFixed(0),
    });

    return items;
}

// ── Colours ──────────────────────────────────────────────────────────────────
const CAT_COLOR: Record<string, string> = {
    research: '#7c9ef8', code: '#d97757', writing: '#a78bfa',
    analysis: '#34d399', data: '#f59e0b', reasoning: '#f472b6',
    planning: '#60a5fa', retrieval: '#4ade80', translation: '#a3e635',
    default: '#a8a29e',
};
const cc = (c: string) => CAT_COLOR[c.toLowerCase()] ?? CAT_COLOR.default;

// ── SVG helpers ───────────────────────────────────────────────────────────────
const VW = 560, VH = 160;
const PL = 52, PR = 20, PT = 14, PB = 30;
const CW = VW - PL - PR;   // 488
const CH = VH - PT - PB;   // 116

const sx = (t: number, mT: number) => PL + (t / mT) * CW;
const sy = (v: number, mV: number) => PT + CH * (1 - v / mV);

function fmtG(v: number) {
    if (v === 0) return '0';
    if (v < 0.0001) return v.toExponential(1);
    return v.toFixed(4);
}

// ── Props ─────────────────────────────────────────────────────────────────────
interface Props {
    subtasks: Subtask[];
    taskStates: Record<number, SubtaskExecution>;
    executing: boolean;
    executionDone: boolean;
    carbonSummary: CarbonSummary | null;
    carbonTimeSeries: Array<{ t: number; actual: number }>;
}

export default function ExecutionTimeline({
    subtasks, taskStates, executing, carbonSummary, carbonTimeSeries,
}: Props) {

    const hasData = carbonTimeSeries.length > 0;

    // ── Chart bounds ─────────────────────────────────────────────────────────
    const maxT = Math.max(
        carbonSummary?.pipeline_time_s ?? 0,
        carbonTimeSeries.at(-1)?.t ?? 0,
        1,
    );
    const baselineCo2 = carbonSummary?.baseline_gco2;
    const finalActual = carbonTimeSeries.at(-1)?.actual ?? 0;
    const maxCo2 = Math.max(baselineCo2 ?? 0, finalActual) * 1.15 || 0.001;

    // ── SVG paths ─────────────────────────────────────────────────────────────
    const { linePath, fillPath } = useMemo(() => {
        if (carbonTimeSeries.length === 0) return { linePath: '', fillPath: '' };
        const pts = carbonTimeSeries.map(p =>
            `${sx(p.t, maxT).toFixed(1)},${sy(p.actual, maxCo2).toFixed(1)}`
        );
        const bottom = (PT + CH).toFixed(1);
        const startX = PL.toFixed(1);
        const lastX = sx(carbonTimeSeries.at(-1)!.t, maxT).toFixed(1);
        const line = `M ${startX},${bottom} L ${pts.join(' L ')}`;
        return { linePath: line, fillPath: `${line} L ${lastX},${bottom} Z` };
    }, [carbonTimeSeries, maxT, maxCo2]);

    const baselineY = baselineCo2 != null ? sy(baselineCo2, maxCo2) : null;

    // ── Agent completion markers (cumulative CO₂ at each point) ───────────────
    const markers = useMemo(() => {
        const done = subtasks
            .map(st => ({ st, exec: taskStates[st.id] }))
            .filter(({ exec }) => exec?.completedAt != null && exec?.gco2 != null)
            .sort((a, b) => a.exec.completedAt! - b.exec.completedAt!);
        let cum = 0;
        return done.map(({ st, exec }, i) => {
            cum += exec.gco2!;
            return {
                x: sx(exec.completedAt!, maxT),
                y: sy(cum, maxCo2),
                label: `#${String(st.id).padStart(2, '0')}`,
                cat: st.category,
                above: i % 2 === 0,
            };
        });
    }, [subtasks, taskStates, maxT, maxCo2]);

    // ── Per-agent breakdown ───────────────────────────────────────────────────
    const breakdown = useMemo(() => {
        const done = subtasks
            .map(st => ({ st, exec: taskStates[st.id] }))
            .filter(({ exec }) => exec?.gco2 != null && exec.status === 'completed');
        const mx = Math.max(...done.map(d => d.exec.gco2!), 0.00001);
        return done
            .sort((a, b) => (b.exec.gco2 ?? 0) - (a.exec.gco2 ?? 0))
            .map(({ st, exec }) => ({
                ...st, gco2: exec.gco2!, duration: exec.duration,
                pct: (exec.gco2! / mx) * 100,
            }));
    }, [subtasks, taskStates]);

    if (!hasData) return null;

    const yTicks = [0, 0.25, 0.5, 0.75, 1.0];
    const xTicks = [0, 0.25, 0.5, 0.75, 1.0];
    const lastPt = carbonTimeSeries.at(-1);

    return (
        <div className="border-t border-[var(--border)] bg-[var(--surface-raised)]/30">
            <div className="max-w-5xl mx-auto px-6 py-6 space-y-4">

                {/* ── Header ── */}
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                        <div className="w-6 h-6 rounded-md bg-emerald-100 border border-emerald-200 flex items-center justify-center">
                            <svg className="w-3.5 h-3.5 text-emerald-600" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v2.25m6.364.386-1.591 1.591M21 12h-2.25m-.386 6.364-1.591-1.591M12 18.75V21m-4.773-4.227-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0Z" />
                            </svg>
                        </div>
                        <span className="text-[12px] font-semibold text-[var(--text-primary)]">Carbon Impact</span>
                        {executing && (
                            <span className="flex items-center gap-1 text-[9px] text-emerald-600 bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 rounded-full font-medium">
                                <span className="w-1 h-1 rounded-full bg-emerald-500 animate-pulse" />
                                Live
                            </span>
                        )}
                    </div>
                    {carbonSummary && (
                        <span className="text-[9px] text-[var(--text-tertiary)] font-mono bg-[var(--surface-raised)] border border-[var(--border-subtle)] px-2 py-1 rounded-md">
                            {carbonSummary.zone} · {carbonSummary.carbon_intensity} gCO₂/kWh
                        </span>
                    )}
                </div>

                {/* ── SVG line chart ── */}
                <div className="bg-white rounded-xl border border-[var(--border-subtle)] shadow-sm overflow-hidden">

                    {/* Legend */}
                    <div className="flex items-center justify-between px-4 pt-3 pb-0.5">
                        <div className="flex items-center gap-5">
                            <div className="flex items-center gap-1.5">
                                <div className="w-5 h-[2px] bg-emerald-500 rounded-full" />
                                <span className="text-[9px] text-[var(--text-tertiary)]">Actual (routed)</span>
                            </div>
                            {baselineCo2 && (
                                <div className="flex items-center gap-1.5">
                                    <svg width="20" height="4" style={{ overflow: 'visible' }}>
                                        <line x1="0" y1="2" x2="20" y2="2" stroke="#d97757" strokeWidth="1.5" strokeDasharray="4,3" />
                                    </svg>
                                    <span className="text-[9px] text-[var(--text-tertiary)]">70B baseline</span>
                                </div>
                            )}
                        </div>
                        <span className="text-[8px] text-[var(--text-tertiary)] font-mono opacity-60">gCO₂</span>
                    </div>

                    {/* SVG */}
                    <svg viewBox={`0 0 ${VW} ${VH}`} className="w-full" style={{ display: 'block' }}>
                        <defs>
                            <linearGradient id="cg-fill" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stopColor="#10b981" stopOpacity="0.28" />
                                <stop offset="100%" stopColor="#10b981" stopOpacity="0.02" />
                            </linearGradient>
                        </defs>

                        {/* Grid lines */}
                        {yTicks.map(f => (
                            <line key={f} x1={PL} y1={sy(f * maxCo2, maxCo2)} x2={VW - PR} y2={sy(f * maxCo2, maxCo2)}
                                stroke="#f0ede8" strokeWidth="0.5" />
                        ))}

                        {/* Y-axis labels */}
                        {yTicks.map(f => (
                            <text key={f} x={PL - 5} y={sy(f * maxCo2, maxCo2) + 3}
                                textAnchor="end" fontSize="7" fill="#c4c0bb" fontFamily="monospace">
                                {fmtG(f * maxCo2)}
                            </text>
                        ))}

                        {/* X-axis labels */}
                        {xTicks.map(f => (
                            <text key={f} x={sx(f * maxT, maxT)} y={VH - 5}
                                textAnchor="middle" fontSize="7" fill="#c4c0bb" fontFamily="monospace">
                                {Math.round(f * maxT)}s
                            </text>
                        ))}

                        {/* Axes */}
                        <line x1={PL} y1={PT} x2={PL} y2={PT + CH} stroke="#e8e5e0" strokeWidth="0.75" />
                        <line x1={PL} y1={PT + CH} x2={VW - PR} y2={PT + CH} stroke="#e8e5e0" strokeWidth="0.75" />

                        {/* Baseline dashed line */}
                        {baselineY != null && (
                            <>
                                <line x1={PL} y1={baselineY} x2={VW - PR} y2={baselineY}
                                    stroke="#d97757" strokeWidth="1.2" strokeDasharray="5,4" opacity="0.55" />
                                <text x={VW - PR - 3} y={baselineY - 4} textAnchor="end"
                                    fontSize="7.5" fill="#d97757" opacity="0.55" fontFamily="ui-sans-serif,sans-serif,system-ui">
                                    70B baseline
                                </text>
                            </>
                        )}

                        {/* Filled area under actual line */}
                        {fillPath && <path d={fillPath} fill="url(#cg-fill)" />}

                        {/* Actual line */}
                        {linePath && (
                            <path d={linePath} fill="none" stroke="#10b981" strokeWidth="2.2"
                                strokeLinejoin="round" strokeLinecap="round" />
                        )}

                        {/* Agent completion dots */}
                        {markers.map((m, i) => (
                            <g key={i}>
                                <circle cx={m.x} cy={m.y} r="3.5" fill="white" stroke={cc(m.cat)} strokeWidth="1.5" />
                                <text x={m.x} y={m.above ? m.y - 7 : m.y + 13}
                                    textAnchor="middle" fontSize="6.5" fill="#a8a29e" fontFamily="monospace">
                                    {m.label}
                                </text>
                            </g>
                        ))}

                        {/* Live pulsing dot at end of line */}
                        {executing && lastPt && (
                            <>
                                <circle cx={sx(lastPt.t, maxT)} cy={sy(lastPt.actual, maxCo2)} r="4" fill="#10b981" opacity="0.2">
                                    <animate attributeName="r" values="3;8;3" dur="2s" repeatCount="indefinite" />
                                    <animate attributeName="opacity" values="0.2;0.04;0.2" dur="2s" repeatCount="indefinite" />
                                </circle>
                                <circle cx={sx(lastPt.t, maxT)} cy={sy(lastPt.actual, maxCo2)} r="3" fill="#10b981" />
                            </>
                        )}
                    </svg>
                </div>

                {/* ── Stat cards ── */}
                {carbonSummary && (
                    <div className="grid grid-cols-2 gap-4">

                        {/* CO₂ saved */}
                        <div className="bg-white rounded-xl border border-emerald-100 px-5 py-4 shadow-sm">
                            <div className="text-[9px] uppercase tracking-[0.15em] text-emerald-700 font-semibold mb-1.5">
                                CO₂ Saved · Agent Routing
                            </div>
                            <div className="text-[40px] font-light text-emerald-600 tabular-nums leading-none animate-count">
                                {carbonSummary.savings_pct.toFixed(1)}<span className="text-[18px]">%</span>
                            </div>
                            <div className="mt-3 space-y-1.5">
                                <div className="flex items-center gap-2">
                                    <span className="text-[8px] font-mono text-emerald-600 w-14 shrink-0">Routed</span>
                                    <div className="flex-1 h-2 bg-emerald-50 rounded-full overflow-hidden">
                                        <div className="h-full bg-emerald-500 rounded-full transition-all duration-1000 ease-out"
                                            style={{ width: `${(carbonSummary.agent_gco2 / carbonSummary.baseline_gco2) * 100}%` }} />
                                    </div>
                                    <span className="text-[8px] font-mono text-emerald-600 tabular-nums">{carbonSummary.agent_gco2.toFixed(4)}g</span>
                                </div>
                                <div className="flex items-center gap-2">
                                    <span className="text-[8px] font-mono text-[#d97757] w-14 shrink-0">70B base</span>
                                    <div className="flex-1 h-2 bg-[#d97757]/10 rounded-full overflow-hidden">
                                        <div className="h-full bg-[#d97757]/45 rounded-full w-full" />
                                    </div>
                                    <span className="text-[8px] font-mono text-[#d97757] tabular-nums">{carbonSummary.baseline_gco2.toFixed(4)}g</span>
                                </div>
                            </div>
                        </div>

                        {/* Time saved */}
                        <div className="bg-white rounded-xl border border-[var(--accent)]/15 px-5 py-4 shadow-sm">
                            <div className="text-[9px] uppercase tracking-[0.15em] text-[var(--accent)] font-semibold mb-1.5">
                                Time Saved · Parallelism
                            </div>
                            <div className="text-[40px] font-light text-[var(--accent)] tabular-nums leading-none animate-count">
                                {carbonSummary.time_savings_pct.toFixed(1)}<span className="text-[18px]">%</span>
                            </div>
                            <div className="mt-3 space-y-1.5">
                                <div className="flex items-center gap-2">
                                    <span className="text-[8px] font-mono text-[var(--accent)] w-14 shrink-0">Parallel</span>
                                    <div className="flex-1 h-2 bg-[var(--accent)]/8 rounded-full overflow-hidden">
                                        <div className="h-full bg-[var(--accent)] rounded-full transition-all duration-1000 ease-out"
                                            style={{ width: `${(carbonSummary.pipeline_time_s / carbonSummary.sequential_time_s) * 100}%` }} />
                                    </div>
                                    <span className="text-[8px] font-mono text-[var(--accent)] tabular-nums">{carbonSummary.pipeline_time_s}s</span>
                                </div>
                                <div className="flex items-center gap-2">
                                    <span className="text-[8px] font-mono text-[var(--text-tertiary)] w-14 shrink-0">Sequential</span>
                                    <div className="flex-1 h-2 bg-[var(--border)] rounded-full overflow-hidden">
                                        <div className="h-full bg-[var(--text-tertiary)]/35 rounded-full w-full" />
                                    </div>
                                    <span className="text-[8px] font-mono text-[var(--text-tertiary)] tabular-nums">{carbonSummary.sequential_time_s}s</span>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {/* ── Per-agent CO₂ breakdown ── */}
                {breakdown.length > 0 && (
                    <div className="bg-white rounded-xl border border-[var(--border-subtle)] shadow-sm overflow-hidden">
                        <div className="px-4 py-3 border-b border-[var(--border-subtle)] bg-[var(--surface-raised)]/40 flex items-center justify-between">
                            <span className="text-[10px] font-semibold text-[var(--text-primary)] uppercase tracking-[0.1em]">
                                Per-agent CO₂
                            </span>
                            {carbonSummary && (
                                <span className="text-[9px] font-mono text-[var(--text-tertiary)]">
                                    {carbonSummary.total_tokens.toLocaleString()} tokens
                                </span>
                            )}
                        </div>
                        <div className="px-4 py-3 space-y-2">
                            {breakdown.map(a => (
                                <div key={a.id} className="flex items-center gap-3 min-w-0">
                                    <span className="text-[9px] font-mono text-[var(--text-tertiary)] w-6 shrink-0">
                                        #{String(a.id).padStart(2, '0')}
                                    </span>
                                    <span className="text-[10px] text-[var(--text-secondary)] w-28 truncate shrink-0" title={a.title}>
                                        {a.title}
                                    </span>
                                    <span className="text-[8px] font-mono text-[var(--text-tertiary)] bg-[var(--surface-raised)] px-1.5 py-0.5 rounded border border-[var(--border-subtle)] shrink-0 max-w-[96px] truncate hidden sm:block">
                                        {a.assigned_model}
                                    </span>
                                    <div className="flex-1 h-2.5 bg-[var(--surface-raised)] rounded-full overflow-hidden border border-[var(--border-subtle)]">
                                        <div
                                            className="h-full rounded-full transition-all duration-700 ease-out"
                                            style={{ width: `${a.pct}%`, backgroundColor: cc(a.category), opacity: 0.82 }}
                                        />
                                    </div>
                                    <span className="text-[8px] font-mono text-emerald-600 tabular-nums w-16 shrink-0 text-right">
                                        {a.gco2.toFixed(5)}g
                                    </span>
                                    {a.duration != null && (
                                        <span className="text-[8px] font-mono text-[var(--text-tertiary)] tabular-nums w-8 shrink-0 text-right">
                                            {a.duration}s
                                        </span>
                                    )}
                                </div>
                            ))}
                        </div>
                        <div className="px-4 pb-3 flex items-center gap-2 text-[8px] font-mono text-[var(--text-tertiary)]">
                            <span className="text-emerald-600">{breakdown.reduce((s, a) => s + a.gco2, 0).toFixed(5)} gCO₂</span>
                            <span>·</span>
                            <span>{breakdown.length} agents</span>
                        </div>
                    </div>
                )}

                {/* ── Carbon Receipt ── */}
                {carbonSummary && (
                    <div className="bg-white rounded-xl border border-[var(--border-subtle)] shadow-sm overflow-hidden">
                        <div className="px-4 py-3 border-b border-[var(--border-subtle)] bg-[var(--surface-raised)]/40 flex items-center gap-2">
                            <svg className="w-3.5 h-3.5 text-emerald-600" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M9 14.25l6-6m4.5-3.493V21.75l-3.75-1.5-3.75 1.5-3.75-1.5-3.75 1.5V4.757c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0 1 11.186 0c1.1.128 1.907 1.077 1.907 2.185Z" />
                            </svg>
                            <span className="text-[10px] font-semibold text-[var(--text-primary)] uppercase tracking-[0.1em]">
                                Carbon Receipt
                            </span>
                        </div>
                        <div className="px-4 py-3 space-y-3">
                            {/* Pipeline cost equivalencies */}
                            <div>
                                <div className="text-[9px] text-[var(--text-tertiary)] mb-2">
                                    This pipeline used{' '}
                                    <span className="font-mono text-emerald-600">{carbonSummary.pipeline_gco2.toFixed(4)} gCO₂</span>
                                    {' '}— equivalent to:
                                </div>
                                <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
                                    {buildEquivalencies(carbonSummary.pipeline_gco2).map(eq => (
                                        <div key={eq.label}
                                            className="bg-[var(--surface-raised)] border border-[var(--border-subtle)] rounded-lg px-2.5 py-2 flex flex-col gap-0.5">
                                            <span className="text-[14px] leading-none">{eq.icon}</span>
                                            <span className="text-[10px] font-mono font-medium text-[var(--text-primary)] tabular-nums">
                                                {eq.value}×
                                            </span>
                                            <span className="text-[8px] text-[var(--text-tertiary)] leading-tight">
                                                {eq.label}
                                            </span>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            {/* Savings equivalency */}
                            {carbonSummary.savings_pct > 0 && (() => {
                                const savedGco2 = Math.max(0, carbonSummary.baseline_gco2 - carbonSummary.agent_gco2);
                                if (savedGco2 < 0.0001) return null;
                                const savedKm = savedGco2 / EQ.DRIVE_GCO2_PER_KM * 1000; // metres
                                const savedSearches = savedGco2 / EQ.SEARCH_GCO2;
                                return (
                                    <div className="pt-2 border-t border-[var(--border-subtle)] flex items-start gap-2">
                                        <div className="w-4 h-4 rounded-full bg-emerald-100 border border-emerald-200 flex items-center justify-center shrink-0 mt-0.5">
                                            <svg className="w-2.5 h-2.5 text-emerald-600" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
                                                <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 10.5 12 3m0 0 7.5 7.5M12 3v18" />
                                            </svg>
                                        </div>
                                        <div className="text-[9px] text-[var(--text-tertiary)] leading-relaxed">
                                            By routing to specialist models instead of the{' '}
                                            <span className="font-mono">{carbonSummary.zone}</span> orchestrator for all tasks,
                                            you avoided{' '}
                                            <span className="font-mono text-emerald-600">{savedGco2.toFixed(4)} gCO₂</span>
                                            {' '}— like not driving{' '}
                                            <span className="font-mono text-emerald-600">
                                                {savedKm < 1000 ? `${Math.round(savedKm)}m` : `${(savedKm / 1000).toFixed(2)}km`}
                                            </span>
                                            {' '}or skipping{' '}
                                            <span className="font-mono text-emerald-600">{savedSearches.toFixed(0)} Google searches</span>.
                                        </div>
                                    </div>
                                );
                            })()}
                        </div>

                        {/* Footer: sources */}
                        <div className="px-4 pb-3 text-[7.5px] text-[var(--text-tertiary)] opacity-50 leading-relaxed">
                            Sources: EEA 2023 (driving), IEA 2020 (streaming), Google Env. Report 2023 (search), A100 TDP model (GPU inference)
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
