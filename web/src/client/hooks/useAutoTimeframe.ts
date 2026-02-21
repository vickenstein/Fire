import { useCallback, useEffect, useRef, useState } from "react";
import type { IChartApi, Time, Range } from "lightweight-charts";
import { computeIndicators, WARMUP_BARS } from "../lib/computeIndicators";

interface BarData {
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  rsi_14?: number | null;
  macd_line?: number | null;
  macd_signal?: number | null;
  macd_histogram?: number | null;
  atr_14?: number | null;
}

type Timeframe = "1m" | "5m" | "15m" | "1h" | "5h" | "1d" | "1W" | "1M";

// Bar duration in seconds for each timeframe
const TF_SECONDS: Record<Timeframe, number> = {
  "1m": 60,
  "5m": 300,
  "15m": 900,
  "1h": 3600,
  "5h": 18000,
  "1d": 86400,
  "1W": 604800,
  "1M": 2592000, // ~30 days
};

const TF_ORDER: Timeframe[] = ["1m", "5m", "15m", "1h", "5h", "1d", "1W", "1M"];

/**
 * Jump-to-best resolution with zoom-direction awareness.
 *
 * Finds the finest timeframe where bars are at least 2px wide,
 * gated by zoom direction so we only switch when bars leave the
 * comfortable 2–10px range in the matching direction.
 */
function resolveTimeframe(
  durationSeconds: number,
  chartWidth: number,
  currentTf: Timeframe,
  zoomDirection: "in" | "out",
): Timeframe {
  const barCount = durationSeconds / TF_SECONDS[currentTf];
  const pxPerBar = chartWidth / barCount;

  // Direction gating: only switch if bars are outside comfortable range
  if (zoomDirection === "in" && pxPerBar <= 10) return currentTf;
  if (zoomDirection === "out" && pxPerBar >= 2) return currentTf;

  // Find the finest timeframe where bars are at least 2px wide
  for (let i = 0; i < TF_ORDER.length; i++) {
    const bc = durationSeconds / TF_SECONDS[TF_ORDER[i]];
    const ppb = chartWidth / bc;
    if (ppb >= 2) return TF_ORDER[i];
  }

  // All are too narrow, use coarsest
  return TF_ORDER[TF_ORDER.length - 1];
}

function toISODate(epochSeconds: number): string {
  return new Date(epochSeconds * 1000).toISOString().slice(0, 10);
}

interface UseAutoTimeframeOptions {
  ticker: string;
  chart: IChartApi | null;
  /** Chart container element — used to read pixel width */
  container: HTMLDivElement | null;
}

interface UseAutoTimeframeResult {
  timeframe: Timeframe;
  data: BarData[];
  loading: boolean;
  error: string | null;
}

export function useAutoTimeframe({
  ticker,
  chart,
  container,
}: UseAutoTimeframeOptions): UseAutoTimeframeResult {
  const [timeframe, setTimeframe] = useState<Timeframe>("1d");
  const [data, setData] = useState<BarData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const timeframeRef = useRef<Timeframe>("1d");
  // Track last visible duration to distinguish zoom from pan
  const lastDurationRef = useRef(0);
  // Cooldown after a timeframe switch — ignore range changes while data is loading
  const cooldownRef = useRef(false);

  const fetchData = useCallback(
    async (tf: Timeframe, signal?: AbortSignal, from?: string, to?: string) => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({ ticker, timeframe: tf });
        if (from) params.set("from", from);
        if (to) params.set("to", to);

        const res = await fetch(`/api/bars?${params}`, { signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const rows: BarData[] = await res.json();
        if (!Array.isArray(rows) || rows.length === 0) {
          setError("No data available for this ticker");
          setData([]);
          return;
        }
        setData(computeIndicators(rows));
      } catch (err: any) {
        if (err.name === "AbortError") return;
        setError(err.message);
      } finally {
        setLoading(false);
        setTimeout(() => {
          cooldownRef.current = false;
        }, 500);
      }
    },
    [ticker],
  );

  // Initial load at 1d when ticker changes
  useEffect(() => {
    const tf: Timeframe = "1d";
    setTimeframe(tf);
    timeframeRef.current = tf;
    cooldownRef.current = true;
    lastDurationRef.current = 0;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    fetchData(tf, controller.signal);

    return () => controller.abort();
  }, [ticker, fetchData]);

  // Subscribe to visible time range changes
  useEffect(() => {
    if (!chart) return;

    const handler = (range: Range<Time> | null) => {
      if (!range) return;
      if (cooldownRef.current) return;

      const chartWidth = container?.clientWidth ?? 800;
      const fromSec = range.from as number;
      const toSec = range.to as number;
      const duration = toSec - fromSec;
      if (duration <= 0) return;

      // Only re-evaluate on zoom (duration change), not pan
      const prevDuration = lastDurationRef.current;
      const durationDelta = Math.abs(duration - prevDuration) / (prevDuration || 1);
      lastDurationRef.current = duration;
      if (prevDuration > 0 && durationDelta < 0.10) return;

      const zoomDirection = duration < prevDuration ? "in" : "out";
      const newTf = resolveTimeframe(duration, chartWidth, timeframeRef.current, zoomDirection);

      if (newTf === timeframeRef.current) return;

      if (debounceRef.current) clearTimeout(debounceRef.current);

      setLoading(true);
      debounceRef.current = setTimeout(() => {
        cooldownRef.current = true;
        timeframeRef.current = newTf;
        setTimeframe(newTf);

        abortRef.current?.abort();
        const controller = new AbortController();
        abortRef.current = controller;

        // For fine timeframes, scope the fetch to visible range + buffer
        // Buffer must cover both viewport panning and indicator warmup
        if (newTf === "1m" || newTf === "5m" || newTf === "15m" || newTf === "1h" || newTf === "5h") {
          const warmupSeconds = WARMUP_BARS * TF_SECONDS[newTf];
          const buffer = Math.max(duration, warmupSeconds);
          const from = toISODate(fromSec - buffer);
          const to = toISODate(toSec + duration);
          fetchData(newTf, controller.signal, from, to);
        } else {
          fetchData(newTf, controller.signal);
        }
      }, 300);
    };

    chart.timeScale().subscribeVisibleTimeRangeChange(handler);

    return () => {
      chart.timeScale().unsubscribeVisibleTimeRangeChange(handler);
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [chart, container, fetchData]);

  return { timeframe, data, loading, error };
}
