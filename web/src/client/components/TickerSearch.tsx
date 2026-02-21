import { useState, useEffect, useRef } from "react";

interface Props {
  value: string;
  onChange: (ticker: string) => void;
}

export function TickerSearch({ value, onChange }: Props) {
  const [input, setInput] = useState(value);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [allTickers, setAllTickers] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch("/api/tickers")
      .then((r) => r.json())
      .then((tickers: string[]) => setAllTickers(tickers))
      .catch(() => {});
  }, []);

  useEffect(() => {
    setInput(value);
  }, [value]);

  const handleInput = (val: string) => {
    const upper = val.toUpperCase();
    setInput(upper);

    if (upper.length > 0) {
      const filtered = allTickers
        .filter((t) => t.startsWith(upper))
        .slice(0, 10);
      setSuggestions(filtered);
      setShowSuggestions(filtered.length > 0);
    } else {
      setShowSuggestions(false);
    }
  };

  const selectTicker = (ticker: string) => {
    setInput(ticker);
    setShowSuggestions(false);
    onChange(ticker);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      const upper = input.toUpperCase();
      setShowSuggestions(false);
      onChange(upper);
    } else if (e.key === "Escape") {
      setShowSuggestions(false);
    }
  };

  return (
    <div className="relative">
      <input
        ref={inputRef}
        type="text"
        value={input}
        onChange={(e) => handleInput(e.target.value)}
        onKeyDown={handleKeyDown}
        onFocus={() => input.length > 0 && suggestions.length > 0 && setShowSuggestions(true)}
        onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
        placeholder="Ticker..."
        className="bg-gray-800 border border-gray-700 rounded px-3 py-1 text-sm text-gray-200 w-28 font-mono"
      />
      {showSuggestions && (
        <div className="absolute top-full left-0 mt-1 bg-gray-800 border border-gray-700 rounded shadow-lg z-50 max-h-60 overflow-y-auto">
          {suggestions.map((t) => (
            <button
              key={t}
              onMouseDown={() => selectTicker(t)}
              className="block w-full text-left px-3 py-1.5 text-sm font-mono hover:bg-gray-700 text-gray-200"
            >
              {t}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
