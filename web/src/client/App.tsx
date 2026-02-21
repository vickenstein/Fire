import { useState, useCallback } from "react";
import { ChartPanel } from "./components/ChartPanel";
import { TickerSearch } from "./components/TickerSearch";

export function App() {
  const [ticker, setTicker] = useState("AAPL");
  const [activeTimeframe, setActiveTimeframe] = useState("1d");

  const handleTimeframeChange = useCallback((tf: string) => {
    setActiveTimeframe(tf);
  }, []);

  return (
    <div className="h-screen flex flex-col">
      {/* Header */}
      <header className="flex items-center gap-4 px-4 py-2 border-b border-gray-800 bg-gray-900">
        <h1 className="text-lg font-bold text-orange-500 mr-4">Fire</h1>

        <TickerSearch value={ticker} onChange={setTicker} />

        <span className="px-2 py-1 text-xs font-mono rounded bg-gray-800 text-orange-400">
          {activeTimeframe.toUpperCase()}
        </span>
      </header>

      {/* Chart area */}
      <main className="flex-1 min-h-0">
        <ChartPanel
          ticker={ticker}
          onTimeframeChange={handleTimeframeChange}
        />
      </main>
    </div>
  );
}
