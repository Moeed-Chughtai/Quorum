'use client';

/**
 * GreenWindowScheduler — sidebar panel edition
 *
 * Compact vertical layout designed for a ~320px sidebar alongside the
 * ReactFlow agent graph. Shows:
 *   - Current carbon intensity (big number + colour bar)
 *   - 32-bar sparkline (24 h history + 8 h forecast), CSS-based (no SVG scale issues)
 *   - Green window callout
 *   - Run Now / Wait buttons
 *
 * Data: real Electricity Maps history when API key is set; otherwise a
 * physics-informed synthetic two-cycle diurnal model (see carbon_tracker.py).
 */

import React, { useMemo } from 'react';
import { type CarbonForecast } from '@/lib/api';

// ── Colour helpers ─────────────────────────────────────────────────────────────
function intensityHex(v: number): string {
    if (v < 100) return '#10b981'; // emerald
    if (v < 200) return '#f59e0b'; // amber
    if (v < 350) return '#f97316'; // orange
    return '#ef4444';              // red
}

function intensityLabel(v: number): string {
    if (v < 100) return 'Very low carbon';
    if (v < 200) return 'Low carbon';
    if (v < 350) return 'Moderate';
    return 'High carbon';
}

function fmtMins(mins: number): string {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    if (h === 0) return `${m}m`;
    return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

// ── Icons ──────────────────────────────────────────────────────────────────────
function SunIcon() {
    return (
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v2.25m6.364.386-1.591 1.591M21 12h-2.25m-.386 6.364-1.591-1.591M12 18.75V21m-4.773-4.227-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0Z" />
        </svg>
    );
}

function ClockIcon() {
    return (
        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
        </svg>
    );
}

// ── Props ──────────────────────────────────────────────────────────────────────
interface Props {
    forecast: CarbonForecast;
    onRunNow: () => void;
    onSchedule: (delayMs: number) => void;
    /** Formatted countdown string e.g. "01:47" or null if not scheduled. */
    countdown: string | null;
    onCancelSchedule: () => void;
    disabled?: boolean;
}

export default function GreenWindowScheduler({
    forecast, onRunNow, onSchedule, countdown, onCancelSchedule, disabled,
}: Props) {
    const { history, forecast: fc, green_window: gw, current_intensity, zone, source } = forecast;

    const allPts = useMemo(() => [...history, ...fc], [history, fc]);
    const minI = Math.min(...allPts.map(p => p.intensity));
    const maxI = Math.max(...allPts.map(p => p.intensity));
    const range = (maxI - minI) || 10;

    const fcColor = intensityHex(current_intensity);
    const isScheduled = countdown !== null;

    // ── Countdown mode ─────────────────────────────────────────────────────────
    if (isScheduled) {
        return (
            <div className="h-full flex flex-col rounded-xl border border-emerald-800/40 overflow-hidden"
                style={{ background: 'linear-gradient(160deg, rgba(6,78,59,0.22) 0%, var(--surface) 60%)' }}>

                {/* Header */}
                <div className="px-4 py-3 border-b border-emerald-800/20 shrink-0 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <span className="relative flex h-2 w-2">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-400" />
                        </span>
                        <span className="text-[10px] font-semibold text-emerald-400 uppercase tracking-[0.15em]">
                            Scheduled
                        </span>
                    </div>
                    <span className="text-[9px] text-emerald-700 font-mono">{zone}</span>
                </div>

                {/* Countdown */}
                <div className="flex-1 flex flex-col items-center justify-center px-4 py-6">
                    <div className="text-[10px] text-emerald-600 uppercase tracking-[0.15em] mb-2">
                        Executing in
                    </div>
                    <div className="text-[52px] font-extralight tabular-nums text-emerald-400 leading-none tracking-tight">
                        {countdown}
                    </div>
                    {gw && (
                        <div className="mt-4 text-center">
                            <div className="text-[11px] text-emerald-300 font-mono tabular-nums">
                                {gw.intensity.toFixed(0)} gCO₂/kWh
                            </div>
                            <div className="text-[10px] text-emerald-600 mt-0.5">
                                ↓{gw.savings_pct.toFixed(1)}% cleaner than now
                            </div>
                        </div>
                    )}
                </div>

                {/* Actions */}
                <div className="px-4 pb-5 space-y-2 shrink-0">
                    <button
                        onClick={onRunNow}
                        className="w-full py-2 rounded-lg text-[11px] border border-[var(--border)] text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors"
                    >
                        Run Now Anyway
                    </button>
                    <button
                        onClick={onCancelSchedule}
                        className="w-full py-2 rounded-lg text-[11px] border border-red-900/30 text-red-400 hover:bg-red-950/20 transition-colors"
                    >
                        Cancel Schedule
                    </button>
                </div>
            </div>
        );
    }

    // ── Normal mode ────────────────────────────────────────────────────────────
    return (
        <div className="h-full flex flex-col rounded-xl border border-[var(--border)] overflow-hidden"
            style={{ background: 'var(--surface)' }}>

            {/* Header */}
            <div className="px-4 py-3 border-b border-[var(--border)] shrink-0 flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                    <span className="text-emerald-500"><SunIcon /></span>
                    <span className="text-[11px] font-semibold text-[var(--text-primary)]">
                        Grid Carbon
                    </span>
                    <span className="text-[10px] text-[var(--text-tertiary)]">· {zone}</span>
                </div>
                <span className={`text-[9px] px-1.5 py-0.5 rounded-full border font-mono ${
                    source === 'electricity_maps'
                        ? 'border-emerald-800/30 text-emerald-500 bg-emerald-950/20'
                        : 'border-[var(--border)] text-[var(--text-tertiary)] bg-[var(--surface-raised)]'
                }`}>
                    {source === 'electricity_maps' ? 'live' : 'modelled'}
                </span>
            </div>

            {/* Current intensity */}
            <div className="px-4 pt-4 pb-3 border-b border-[var(--border)] shrink-0">
                <div className="text-[9px] uppercase tracking-[0.15em] text-[var(--text-tertiary)] mb-2">
                    Right now
                </div>
                <div className="flex items-baseline gap-1.5 mb-2.5">
                    <span className="text-[38px] font-extralight tabular-nums leading-none" style={{ color: fcColor }}>
                        {current_intensity.toFixed(0)}
                    </span>
                    <span className="text-[11px] text-[var(--text-tertiary)]">gCO₂/kWh</span>
                </div>
                {/* Intensity gradient bar */}
                <div className="h-1 rounded-full overflow-hidden mb-1.5" style={{ background: 'var(--border)' }}>
                    <div
                        className="h-full rounded-full transition-all duration-700"
                        style={{
                            width: `${Math.min(100, (current_intensity / 500) * 100)}%`,
                            background: `linear-gradient(to right, #10b981, ${fcColor})`,
                        }}
                    />
                </div>
                <div className="text-[10px] font-medium" style={{ color: fcColor }}>
                    {intensityLabel(current_intensity)}
                </div>
            </div>

            {/* Sparkline — CSS bar chart */}
            <div className="px-4 py-3 border-b border-[var(--border)] shrink-0">
                <div className="text-[9px] uppercase tracking-[0.15em] text-[var(--text-tertiary)] mb-2.5">
                    24 h history · 8 h forecast
                </div>
                <div className="flex items-end gap-px" style={{ height: '52px' }}>
                    {allPts.map((pt, i) => {
                        const pct = Math.max(6, ((pt.intensity - minI) / range) * 100);
                        const isForecast = i >= history.length;
                        const isNow = i === history.length - 1;
                        const isGW = gw ? pt.dt === gw.dt : false;
                        const color = isGW ? '#10b981'
                            : isForecast ? intensityHex(pt.intensity)
                            : '#94a3b8';
                        const opacity = isForecast ? 0.7 : 0.35;
                        return (
                            <div key={i} className="flex-1 flex flex-col justify-end relative" style={{ height: '100%' }}>
                                {isNow && (
                                    <div
                                        className="absolute top-0 bottom-0 left-1/2 -translate-x-1/2 w-px"
                                        style={{ background: fcColor, opacity: 0.5 }}
                                    />
                                )}
                                <div
                                    style={{
                                        height: `${pct}%`,
                                        background: isGW ? '#10b981' : color,
                                        opacity: isGW ? 1 : opacity,
                                        borderRadius: '2px 2px 0 0',
                                        position: 'relative',
                                    }}
                                />
                            </div>
                        );
                    })}
                </div>
                <div className="flex justify-between mt-1.5 text-[8px] font-mono text-[var(--text-tertiary)]">
                    <span>-24h</span>
                    <span style={{ color: fcColor }} className="font-semibold">Now</span>
                    {gw && <span className="text-emerald-500">+{Math.round(gw.minutes_from_now / 60)}h best</span>}
                    <span>+8h</span>
                </div>
            </div>

            {/* Green window info (or "near minimum" note) */}
            <div className="px-4 py-3 border-b border-[var(--border)] shrink-0">
                {gw ? (
                    <div className="flex items-start gap-2.5">
                        <div className="w-6 h-6 rounded-lg bg-emerald-950/40 border border-emerald-800/30 flex items-center justify-center shrink-0 mt-0.5">
                            <ClockIcon />
                        </div>
                        <div>
                            <div className="text-[10px] font-semibold text-emerald-400">
                                Green window in {fmtMins(gw.minutes_from_now)}
                            </div>
                            <div className="flex items-baseline gap-1.5 mt-0.5">
                                <span className="text-[13px] font-mono tabular-nums text-emerald-300">
                                    {gw.intensity.toFixed(0)} gCO₂/kWh
                                </span>
                            </div>
                            <div className="text-[9px] text-emerald-600 mt-0.5">
                                ↓{gw.savings_pct.toFixed(1)}% cleaner than now
                            </div>
                        </div>
                    </div>
                ) : (
                    <div className="flex items-center gap-2">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" />
                        <span className="text-[10px] text-[var(--text-tertiary)]">
                            Grid is near its daily minimum
                        </span>
                    </div>
                )}
            </div>

            {/* Spacer */}
            <div className="flex-1" />

            {/* Action buttons */}
            <div className="px-4 pb-4 pt-3 space-y-2 shrink-0">
                {gw && (
                    <button
                        onClick={() => onSchedule(gw.minutes_from_now * 60 * 1000)}
                        disabled={disabled}
                        className="w-full py-2.5 rounded-xl text-[12px] font-medium bg-emerald-950/40 border border-emerald-700/40 text-emerald-300 hover:bg-emerald-950/60 hover:border-emerald-600/60 disabled:opacity-30 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2"
                    >
                        <ClockIcon />
                        Wait {fmtMins(gw.minutes_from_now)} · Save {gw.savings_pct.toFixed(0)}%
                    </button>
                )}
                <button
                    onClick={onRunNow}
                    disabled={disabled}
                    className="w-full py-2.5 rounded-xl text-[12px] font-medium border border-[var(--border)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--accent-border)] disabled:opacity-30 disabled:cursor-not-allowed transition-all"
                >
                    Run Now
                </button>
            </div>
        </div>
    );
}
