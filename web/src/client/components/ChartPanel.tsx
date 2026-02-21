import { useEffect, useRef, useState } from "react";
import {
  createChart,
  type IChartApi,
  type ISeriesApi,
  ColorType,
  CrosshairMode,
} from "lightweight-charts";
import { useAutoTimeframe } from "../hooks/useAutoTimeframe";

interface Props {
  ticker: string;
  onTimeframeChange?: (timeframe: string) => void;
}

function toChartTime(ts: string): number {
  return Math.floor(new Date(ts).getTime() / 1000);
}

export function ChartPanel({ ticker, onTimeframeChange }: Props) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const rsiContainerRef = useRef<HTMLDivElement>(null);
  const macdContainerRef = useRef<HTMLDivElement>(null);

  // Chart API refs (persist across data changes)
  const chartRef = useRef<IChartApi | null>(null);
  const rsiChartRef = useRef<IChartApi | null>(null);
  const macdChartRef = useRef<IChartApi | null>(null);

  // Series refs
  const candlestickRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volumeRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const rsiRef = useRef<ISeriesApi<"Line"> | null>(null);
  const rsiOverBoughtRef = useRef<ISeriesApi<"Line"> | null>(null);
  const rsiOverSoldRef = useRef<ISeriesApi<"Line"> | null>(null);
  const macdLineRef = useRef<ISeriesApi<"Line"> | null>(null);
  const macdSignalRef = useRef<ISeriesApi<"Line"> | null>(null);
  const macdHistRef = useRef<ISeriesApi<"Histogram"> | null>(null);

  const isInitialLoadRef = useRef(true);

  // Expose chart to the hook via state
  const [mainChart, setMainChart] = useState<IChartApi | null>(null);

  const { timeframe, data, loading, error } = useAutoTimeframe({
    ticker,
    chart: mainChart,
    container: chartContainerRef.current,
  });

  // Notify parent of timeframe changes
  useEffect(() => {
    onTimeframeChange?.(timeframe);
  }, [timeframe, onTimeframeChange]);

  // Reset initial load flag when ticker changes
  useEffect(() => {
    isInitialLoadRef.current = true;
  }, [ticker]);

  // EFFECT 1: Chart creation (runs once on mount)
  useEffect(() => {
    if (
      !chartContainerRef.current ||
      !rsiContainerRef.current ||
      !macdContainerRef.current
    )
      return;

    const mainContainer = chartContainerRef.current;
    const rsiContainer = rsiContainerRef.current;
    const macdContainer = macdContainerRef.current;

    const chart = createChart(mainContainer, {
      layout: {
        background: { type: ColorType.Solid, color: "#0a0a0a" },
        textColor: "#9ca3af",
      },
      grid: {
        vertLines: { color: "#1f2937" },
        horzLines: { color: "#1f2937" },
      },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: "#374151" },
      timeScale: {
        borderColor: "#374151",
        timeVisible: true,
        secondsVisible: false,
      },
      width: mainContainer.clientWidth,
      height: mainContainer.clientHeight,
    });

    const candlestickSeries = chart.addCandlestickSeries({
      upColor: "#22c55e",
      downColor: "#ef4444",
      borderUpColor: "#22c55e",
      borderDownColor: "#ef4444",
      wickUpColor: "#22c55e",
      wickDownColor: "#ef4444",
    });

    const volumeSeries = chart.addHistogramSeries({
      priceFormat: { type: "volume" },
      priceScaleId: "volume",
    });
    chart.priceScale("volume").applyOptions({
      scaleMargins: { top: 0.8, bottom: 0 },
    });

    const rsiChart = createChart(rsiContainer, {
      layout: {
        background: { type: ColorType.Solid, color: "#0a0a0a" },
        textColor: "#9ca3af",
      },
      grid: {
        vertLines: { color: "#1f2937" },
        horzLines: { color: "#1f2937" },
      },
      rightPriceScale: { borderColor: "#374151" },
      timeScale: {
        borderColor: "#374151",
        timeVisible: true,
        secondsVisible: false,
        visible: false,
      },
      width: rsiContainer.clientWidth,
      height: rsiContainer.clientHeight,
    });

    const rsiSeries = rsiChart.addLineSeries({
      color: "#a855f7",
      lineWidth: 1,
      priceFormat: { type: "custom", formatter: (v: number) => v.toFixed(1) },
    });
    const rsiOverBought = rsiChart.addLineSeries({
      color: "#374151",
      lineWidth: 1,
      lineStyle: 2,
    });
    const rsiOverSold = rsiChart.addLineSeries({
      color: "#374151",
      lineWidth: 1,
      lineStyle: 2,
    });

    const macdChart = createChart(macdContainer, {
      layout: {
        background: { type: ColorType.Solid, color: "#0a0a0a" },
        textColor: "#9ca3af",
      },
      grid: {
        vertLines: { color: "#1f2937" },
        horzLines: { color: "#1f2937" },
      },
      rightPriceScale: { borderColor: "#374151" },
      timeScale: {
        borderColor: "#374151",
        timeVisible: true,
        secondsVisible: false,
      },
      width: macdContainer.clientWidth,
      height: macdContainer.clientHeight,
    });

    const macdLineSeries = macdChart.addLineSeries({
      color: "#3b82f6",
      lineWidth: 1,
    });
    const macdSignalSeries = macdChart.addLineSeries({
      color: "#f97316",
      lineWidth: 1,
    });
    const macdHistogramSeries = macdChart.addHistogramSeries({
      color: "#6b7280",
    });

    // Sync time scales
    chart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
      if (range) {
        rsiChart.timeScale().setVisibleLogicalRange(range);
        macdChart.timeScale().setVisibleLogicalRange(range);
      }
    });
    macdChart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
      if (range) {
        chart.timeScale().setVisibleLogicalRange(range);
        rsiChart.timeScale().setVisibleLogicalRange(range);
      }
    });

    // Resize observer
    const handleResize = () => {
      chart.applyOptions({
        width: mainContainer.clientWidth,
        height: mainContainer.clientHeight,
      });
      rsiChart.applyOptions({
        width: rsiContainer.clientWidth,
        height: rsiContainer.clientHeight,
      });
      macdChart.applyOptions({
        width: macdContainer.clientWidth,
        height: macdContainer.clientHeight,
      });
    };
    const observer = new ResizeObserver(handleResize);
    observer.observe(mainContainer);
    observer.observe(rsiContainer);
    observer.observe(macdContainer);

    // Store refs
    chartRef.current = chart;
    rsiChartRef.current = rsiChart;
    macdChartRef.current = macdChart;
    candlestickRef.current = candlestickSeries;
    volumeRef.current = volumeSeries;
    rsiRef.current = rsiSeries;
    rsiOverBoughtRef.current = rsiOverBought;
    rsiOverSoldRef.current = rsiOverSold;
    macdLineRef.current = macdLineSeries;
    macdSignalRef.current = macdSignalSeries;
    macdHistRef.current = macdHistogramSeries;

    setMainChart(chart);

    return () => {
      observer.disconnect();
      chart.remove();
      rsiChart.remove();
      macdChart.remove();
      chartRef.current = null;
      rsiChartRef.current = null;
      macdChartRef.current = null;
      setMainChart(null);
    };
  }, []);

  // EFFECT 2: Apply data to existing series
  useEffect(() => {
    if (!data.length) return;
    if (!candlestickRef.current || !volumeRef.current || !chartRef.current)
      return;

    const chart = chartRef.current;

    // Save viewport before replacing data
    const savedRange = chart.timeScale().getVisibleRange();

    // Candlestick
    candlestickRef.current.setData(
      data.map((d) => ({
        time: toChartTime(d.timestamp) as any,
        open: Number(d.open),
        high: Number(d.high),
        low: Number(d.low),
        close: Number(d.close),
      })),
    );

    // Volume
    volumeRef.current.setData(
      data.map((d) => ({
        time: toChartTime(d.timestamp) as any,
        value: Number(d.volume),
        color:
          Number(d.close) >= Number(d.open) ? "#22c55e40" : "#ef444440",
      })),
    );

    // RSI
    const rsiData = data
      .filter((d) => d.rsi_14 != null)
      .map((d) => ({
        time: toChartTime(d.timestamp) as any,
        value: Number(d.rsi_14),
      }));

    if (rsiRef.current) {
      if (rsiData.length > 0) {
        rsiRef.current.setData(rsiData);
        const times = rsiData.map((d) => d.time);
        rsiOverBoughtRef.current?.setData([
          { time: times[0], value: 70 },
          { time: times[times.length - 1], value: 70 },
        ]);
        rsiOverSoldRef.current?.setData([
          { time: times[0], value: 30 },
          { time: times[times.length - 1], value: 30 },
        ]);
      } else {
        rsiRef.current.setData([]);
        rsiOverBoughtRef.current?.setData([]);
        rsiOverSoldRef.current?.setData([]);
      }
    }

    // MACD
    const macdLine = data
      .filter((d) => d.macd_line != null)
      .map((d) => ({
        time: toChartTime(d.timestamp) as any,
        value: Number(d.macd_line),
      }));
    const macdSignal = data
      .filter((d) => d.macd_signal != null)
      .map((d) => ({
        time: toChartTime(d.timestamp) as any,
        value: Number(d.macd_signal),
      }));
    const macdHist = data
      .filter((d) => d.macd_histogram != null)
      .map((d) => ({
        time: toChartTime(d.timestamp) as any,
        value: Number(d.macd_histogram),
        color: Number(d.macd_histogram) >= 0 ? "#22c55e" : "#ef4444",
      }));

    if (macdLineRef.current) {
      if (macdLine.length > 0) {
        macdLineRef.current.setData(macdLine);
        macdSignalRef.current?.setData(macdSignal);
        macdHistRef.current?.setData(macdHist);
      } else {
        macdLineRef.current.setData([]);
        macdSignalRef.current?.setData([]);
        macdHistRef.current?.setData([]);
      }
    }

    // Viewport management
    if (isInitialLoadRef.current) {
      chart.timeScale().fitContent();
      rsiChartRef.current?.timeScale().fitContent();
      macdChartRef.current?.timeScale().fitContent();
      isInitialLoadRef.current = false;
    } else if (savedRange) {
      requestAnimationFrame(() => {
        chart.timeScale().setVisibleRange(savedRange);
        // Explicitly sync sub-charts after data + viewport change
        const logicalRange = chart.timeScale().getVisibleLogicalRange();
        if (logicalRange) {
          rsiChartRef.current?.timeScale().setVisibleLogicalRange(logicalRange);
          macdChartRef.current?.timeScale().setVisibleLogicalRange(logicalRange);
        }
      });
    }
  }, [data]);

  return (
    <div className="h-full flex flex-col">
      {/* Status bar */}
      <div className="flex items-center gap-3 px-4 py-1 text-xs text-gray-500 border-b border-gray-800">
        <span className="font-mono font-bold text-gray-300">{ticker}</span>
        <span className="px-1.5 py-0.5 rounded bg-gray-800 text-orange-400 font-mono text-[10px]">
          {timeframe.toUpperCase()}
        </span>
        {loading && <span className="text-yellow-500">Loading...</span>}
        {error && <span className="text-red-500">{error}</span>}
        {data.length > 0 && (
          <span>{data.length.toLocaleString()} bars</span>
        )}
      </div>

      {/* Main chart */}
      <div className="relative flex-[3] min-h-0">
        <div ref={chartContainerRef} className="absolute inset-0" />
        {loading && data.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center bg-[#0a0a0a]/80 z-10">
            <span className="text-gray-400 text-sm">Loading...</span>
          </div>
        )}
      </div>

      {/* RSI */}
      <div className="relative border-t border-gray-800">
        <span className="absolute top-1 left-2 text-[10px] text-gray-600 z-10">
          RSI(14)
        </span>
        <div ref={rsiContainerRef} className="h-24" />
      </div>

      {/* MACD */}
      <div className="relative border-t border-gray-800">
        <span className="absolute top-1 left-2 text-[10px] text-gray-600 z-10">
          MACD(12,26,9)
        </span>
        <div ref={macdContainerRef} className="h-24" />
      </div>
    </div>
  );
}
