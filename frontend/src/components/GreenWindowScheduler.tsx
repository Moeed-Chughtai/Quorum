'use client';

/**
 * GreenWindowScheduler
 *
 * Displays a 32-hour carbon-intensity timeline (24 h history + 8 h forecast)
 * and lets the user defer pipeline execution until the cleanest upcoming grid window.
 *
 * Data: real Electricity Maps history when API key is set; otherwise a
 * physics-informed synthetic two-cycle diurnal model (see carbon_tracker.py).
 */

import React, { useMemo } from 'react';
import { type CarbonForecast } from '@/lib/api';

// ── Chart geometry ────────────────────────────────────────────────────────────
const VW = 720, VH = 108;
const PL = 44, PR = 14, PT = 12, PB = 26;
const CW = VW - PL - PR;   // 662
const CH = VH - PT - PB;   // 70

// ── Colour helpers ────────────────────────────────────────────────────────────
/** Map gCO₂/kWh → a CSS color (green → amber → red scale). */
function intensityColor(v: number, alpha = 1): string {
    if (v < 100)  return `rgba(16,185,129,${alpha})`;  // emerald
    if (v < 200)  return `rgba(245,158,11,${alpha})`;  // amber
    if (v < 350)  return `rgba(249,115,22,${alpha})`;  // orange
    return              `rgba(239,68,68,${alpha})`;    // red
}

/** Scale a gCO₂/kWh value to a CSS hue for the fill gradient. */
function intensityHex(v: number): string {
    if (v < 100)  return '#10b981';
    if (v < 200)  return '#f59e0b';
    if (v < 350)  return '#f97316';
    return              '#ef4444';
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmtMins(mins: number): string {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    if (h === 0) return `${m}m`;
    return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

function fmtTime(isoStr: string): string {
    try {
        const d = new Date(isoStr);
        return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch { return ''; }
}

// ── Props ─────────────────────────────────────────────────────────────────────
interface Props {
    forecast: CarbonForecast;
    onRunNow: () => void;
    onSchedule: (delayMs: number) => void;
    /** Formatted countdown string e.g. "01:47:22" or null if not scheduled. */
    countdown: string | null;
    onCancelSchedule: () => void;
    disabled?: boolean;
}

export default function GreenWindowScheduler({
    forecast, onRunNow, onSchedule, countdown, onCancelSchedule, disabled,
}: Props) {
    const { history, forecast: fc, green_window: gw, current_intensity, zone, source } = forecast;

    // ── Combine history + forecast into a single 32-point array ──────────────
    const allPts = useMemo(() => [...history, ...fc], [history, fc]);
    const N = allPts.length; // typically 32

    // ── Chart scales ─────────────────────────────────────────────────────────
    const minI = Math.min(...allPts.map(p => p.intensity));
    const maxI = Math.max(...allPts.map(p => p.intensity));
    const yPad = (maxI - minI) * 0.25 || 10;
    const yLo  = Math.max(0, minI - yPad * 0.3);
    const yHi  = maxI + yPad;

    const px = (i: number) => PL + (i / (N - 1)) * CW;
    const py = (v: number) => PT + CH * (1 - (v - yLo) / (yHi - yLo));

    // "Now" sits between the last history sample and the first forecast sample.
    const nowX = px(history.length - 0.5);

    // Green window x-position in the forecast slice
    const gwIdx = gw ? fc.findIndex(p => p.dt === gw.dt) : -1;
    const gwX   = gwIdx >= 0 ? px(history.length + gwIdx) : null;

    // ── SVG paths ─────────────────────────────────────────────────────────────
    const { histPath, histFill, fcPath, fcFill } = useMemo(() => {
        const pts = (arr: typeof allPts, offset: number) =>
            arr.map((p, i) => `${px(offset + i).toFixed(1)},${py(p.intensity).toFixed(1)}`).join(' L ');

        const historyStr = pts(history, 0);
        const fcStr      = pts(fc, history.length);

        const hLast = px(history.length - 1).toFixed(1);
        const fLast = px(history.length + fc.length - 1).toFixed(1);
        const bot   = (PT + CH).toFixed(1);

        const histLine = `M ${PL.toFixed(1)},${py(history[0].intensity).toFixed(1)} L ${historyStr}`;
        const fcLine   = `M ${px(history.length).toFixed(1)},${py(fc[0].intensity).toFixed(1)} L ${fcStr}`;

        return {
            histPath: histLine,
            histFill: `${histLine} L ${hLast},${bot} L ${PL.toFixed(1)},${bot} Z`,
            fcPath:   fcLine,
            fcFill:   `${fcLine} L ${fLast},${bot} L ${px(history.length).toFixed(1)},${bot} Z`,
        };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [history, fc, yLo, yHi, N]);

    // Y-axis ticks
    const range = yHi - yLo;
    const step  = range > 200 ? 100 : range > 80 ? 50 : range > 30 ? 20 : 10;
    const yTicks: number[] = [];
    for (let v = Math.ceil(yLo / step) * step; v <= yHi; v += step) yTicks.push(v);

    // X-axis labels: −18h, −12h, −6h, Now, +2h, +4h, +6h, +8h
    const xLabels = useMemo(() => {
        const labels: { x: number; label: string; isNow?: boolean }[] = [];
        [-18, -12, -6].forEach(h => {
            const i = history.length + h; // history.length ≈ 24
            if (i >= 0) labels.push({ x: px(i), label: `${h}h` });
        });
        labels.push({ x: nowX, label: 'Now', isNow: true });
        [2, 4, 6, 8].forEach(h => {
            const i = history.length + h - 1; // h-1 because fc[0] = +1h
            if (i < N) labels.push({ x: px(i), label: `+${h}h` });
        });
        return labels;
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [nowX, history.length, N]);

    const fcColor = intensityHex(current_intensity);
    const isScheduled = countdown !== null;

    // ── Render: countdown mode ────────────────────────────────────────────────
    if (isScheduled) {
        return (
            <div className="rounded-xl border border-emerald-200/60 bg-gradient-to-br from-emerald-950/25 to-[var(--surface)] overflow-hidden">
                <div className="px-5 py-4 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <span className="relative flex h-2.5 w-2.5">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-400" />
                        </span>
                        <span className="text-[11px] font-semibold text-emerald-400 uppercase tracking-[0.12em]">
                            Scheduled for Green Window
                        </span>
                        <span className="text-[10px] text-emerald-700/60 font-mono">{zone}</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={onRunNow}
                            className="px-3 py-1 rounded-lg text-[11px] border border-[var(--border)] text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors"
                        >
                            Run Now Anyway
                        </button>
                        <button
                            onClick={onCancelSchedule}
                            className="px-3 py-1 rounded-lg text-[11px] border border-red-800/30 text-red-400 hover:bg-red-950/20 transition-colors"
                        >
                            Cancel
                        </button>
                    </div>
                </div>
                <div className="px-5 pb-5 flex items-end gap-8">
                    <div>
                        <div className="text-[11px] text-emerald-600/70 mb-0.5">Executing in</div>
                        <div className="text-[42px] font-light tabular-nums tracking-tight text-emerald-400 leading-none">
                            {countdown}
                        </div>
                    </div>
                    {gw && (
                        <div className="pb-1">
                            <div className="text-[10px] text-[var(--text-tertiary)] mb-0.5">Target window</div>
                            <div className="text-[13px] text-emerald-300">
                                {gw.intensity.toFixed(0)} gCO₂/kWh at {fmtTime(gw.dt)}
                            </div>
                            <div className="text-[10px] text-emerald-600 mt-0.5">
                                {gw.savings_pct.toFixed(1)}% cleaner than now
                            </div>
                        </div>
                    )}
                </div>
            </div>
        );
    }

    // ── Render: normal mode ───────────────────────────────────────────────────
    return (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] overflow-hidden shadow-sm">
            {/* Header */}
            <div className="px-4 pt-3 pb-1 flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <svg className="w-3.5 h-3.5 text-emerald-500" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v2.25m6.364.386-1.591 1.591M21 12h-2.25m-.386 6.364-1.591-1.591M12 18.75V21m-4.773-4.227-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0Z" />
                    </svg>
                    <span className="text-[11px] font-semibold text-[var(--text-primary)]">
                        Grid Carbon Forecast · {zone}
                    </span>
                    <span className={`text-[9px] px-1.5 py-0.5 rounded-full border font-mono ${
                        source === 'electricity_maps'
                            ? 'border-emerald-800/30 text-emerald-500 bg-emerald-950/20'
                            : 'border-[var(--border)] text-[var(--text-tertiary)] bg-[var(--surface-raised)]'
                    }`}>
                        {source === 'electricity_maps' ? 'live data' : 'modelled'}
                    </span>
                </div>
                <span className="text-[9px] text-[var(--text-tertiary)] font-mono opacity-60">gCO₂/kWh</span>
            </div>

            {/* SVG Chart */}
            <div className="px-1">
                <svg viewBox={`0 0 ${VW} ${VH}`} className="w-full" style={{ display: 'block' }}>
                    <defs>
                        {/* History fill: muted grey */}
                        <linearGradient id="gws-hist-fill" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#94a3b8" stopOpacity="0.18" />
                            <stop offset="100%" stopColor="#94a3b8" stopOpacity="0.03" />
                        </linearGradient>
                        {/* Forecast fill: intensity-colored */}
                        <linearGradient id="gws-fc-fill" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor={fcColor} stopOpacity="0.30" />
                            <stop offset="100%" stopColor={fcColor} stopOpacity="0.03" />
                        </linearGradient>
                        {/* Green window highlight */}
                        <linearGradient id="gws-gw-fill" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#10b981" stopOpacity="0.15" />
                            <stop offset="100%" stopColor="#10b981" stopOpacity="0.03" />
                        </linearGradient>
                        <clipPath id="gws-chart-clip">
                            <rect x={PL} y={PT} width={CW} height={CH} />
                        </clipPath>
                    </defs>

                    {/* Horizontal grid */}
                    {yTicks.map(v => (
                        <line key={v} x1={PL} y1={py(v)} x2={VW - PR} y2={py(v)}
                            stroke="#f0ede8" strokeWidth="0.5" />
                    ))}

                    {/* Y-axis labels */}
                    {yTicks.filter((_, i) => i % 2 === 0).map(v => (
                        <text key={v} x={PL - 4} y={py(v) + 3}
                            textAnchor="end" fontSize="7" fill="#c4c0bb" fontFamily="monospace">
                            {v}
                        </text>
                    ))}

                    {/* X-axis labels */}
                    {xLabels.map(({ x, label, isNow }) => (
                        <text key={label} x={x} y={VH - 5}
                            textAnchor="middle" fontSize={isNow ? '8' : '6.5'}
                            fontWeight={isNow ? '600' : '400'}
                            fill={isNow ? '#10b981' : '#c4c0bb'}
                            fontFamily="monospace">
                            {label}
                        </text>
                    ))}

                    {/* Axes */}
                    <line x1={PL} y1={PT} x2={PL} y2={PT + CH} stroke="#e8e5e0" strokeWidth="0.75" />
                    <line x1={PL} y1={PT + CH} x2={VW - PR} y2={PT + CH} stroke="#e8e5e0" strokeWidth="0.75" />

                    <g clipPath="url(#gws-chart-clip)">
                        {/* Green window shaded region */}
                        {gwX != null && gwX > nowX && (
                            <rect
                                x={nowX} y={PT}
                                width={gwX - nowX} height={CH}
                                fill="url(#gws-gw-fill)"
                            />
                        )}

                        {/* History fill + line */}
                        <path d={histFill} fill="url(#gws-hist-fill)" />
                        <path d={histPath} fill="none" stroke="#94a3b8" strokeWidth="1.5"
                            strokeLinejoin="round" strokeLinecap="round" opacity="0.55" />

                        {/* Forecast fill + line */}
                        <path d={fcFill} fill="url(#gws-fc-fill)" />
                        <path d={fcPath} fill="none" stroke={fcColor} strokeWidth="2"
                            strokeLinejoin="round" strokeLinecap="round" />

                        {/* Green window dot */}
                        {gwX != null && gwIdx >= 0 && (
                            <>
                                <circle
                                    cx={gwX}
                                    cy={py(fc[gwIdx].intensity)}
                                    r="4" fill="white"
                                    stroke="#10b981" strokeWidth="1.8"
                                />
                                <circle cx={gwX} cy={py(fc[gwIdx].intensity)} r="1.5" fill="#10b981" />
                            </>
                        )}

                        {/* Current time dot */}
                        <circle
                            cx={nowX}
                            cy={py(current_intensity)}
                            r="4" fill="white"
                            stroke={fcColor} strokeWidth="2"
                        />
                        <circle cx={nowX} cy={py(current_intensity)} r="1.8" fill={fcColor} />
                    </g>

                    {/* "Now" vertical dashed line */}
                    <line x1={nowX} y1={PT} x2={nowX} y2={PT + CH}
                        stroke="#10b981" strokeWidth="1" strokeDasharray="3,3" opacity="0.5" />
                </svg>
            </div>

            {/* Info row + action buttons */}
            <div className="px-4 pb-3 pt-1 flex items-center gap-3 flex-wrap">
                {/* Current */}
                <div className="flex items-center gap-2 min-w-0">
                    <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: fcColor }} />
                    <div>
                        <div className="text-[9px] text-[var(--text-tertiary)] uppercase tracking-[0.1em]">Now</div>
                        <div className="text-[12px] font-mono tabular-nums" style={{ color: fcColor }}>
                            {current_intensity.toFixed(0)} gCO₂/kWh
                        </div>
                    </div>
                </div>

                {/* Green window */}
                {gw && (
                    <>
                        <div className="w-px h-7 bg-[var(--border)] shrink-0" />
                        <div className="flex items-center gap-2 min-w-0">
                            <svg className="w-3 h-3 text-emerald-500 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v2.25m6.364.386-1.591 1.591M21 12h-2.25m-.386 6.364-1.591-1.591M12 18.75V21m-4.773-4.227-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0Z" />
                            </svg>
                            <div>
                                <div className="text-[9px] text-emerald-600 uppercase tracking-[0.1em]">
                                    Green window in {fmtMins(gw.minutes_from_now)}
                                </div>
                                <div className="text-[12px] font-mono tabular-nums text-emerald-400">
                                    {gw.intensity.toFixed(0)} gCO₂/kWh
                                    <span className="text-[10px] text-emerald-600 ml-1.5">
                                        −{gw.savings_pct.toFixed(1)}% cleaner
                                    </span>
                                </div>
                            </div>
                        </div>
                    </>
                )}

                {!gw && (
                    <>
                        <div className="w-px h-7 bg-[var(--border)] shrink-0" />
                        <div className="text-[10px] text-[var(--text-tertiary)]">
                            Grid is already near its daily minimum
                        </div>
                    </>
                )}

                {/* Spacer */}
                <div className="flex-1" />

                {/* Action buttons */}
                <div className="flex items-center gap-2 shrink-0">
                    <button
                        onClick={onRunNow}
                        disabled={disabled}
                        className="px-4 py-1.5 rounded-lg text-[12px] font-medium border border-[var(--border)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--accent-border)] disabled:opacity-30 disabled:cursor-not-allowed transition-all"
                    >
                        Run Now
                    </button>
                    {gw && (
                        <button
                            onClick={() => onSchedule(gw.minutes_from_now * 60 * 1000)}
                            disabled={disabled}
                            className="px-4 py-1.5 rounded-lg text-[12px] font-medium bg-emerald-950/40 border border-emerald-700/40 text-emerald-300 hover:bg-emerald-950/60 hover:border-emerald-600/60 disabled:opacity-30 disabled:cursor-not-allowed transition-all flex items-center gap-1.5"
                        >
                            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
                            </svg>
                            Wait {fmtMins(gw.minutes_from_now)} · Save {gw.savings_pct.toFixed(0)}%
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}
