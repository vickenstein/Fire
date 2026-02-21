# Fire

### Financial Independence & Retire Early

> *The edge is not in knowing what will happen. It is in learning faster than everyone else what is happening.*

---

## The Thesis

Markets are not efficient at every timescale and every volume level. There are structural, recurring inefficiencies — particularly in low-attention, low-volume windows — that a disciplined system can exploit. These inefficiencies are not hidden. They are ignored, because they exist in a gap between what institutions care about and what retail traders can systematically capture.

Fire is a full-stack quantitative system: from data ingestion to regime detection to entry and exit signals to automated risk management. But its real product is not trades. It is **compressed learning cycles**. Every position is a hypothesis. Every exit is a measurement. Every cycle sharpens the system's understanding of what the market is doing and why.

Most quantitative systems optimize for profit and loss after the fact. Fire optimizes for **prediction accuracy** in real time. The belief is direct: if the system correctly predicts behavior and trends more often, the returns follow — and more importantly, the system *knows why* they follow. Luck is identified and discarded. Edge is identified and reinforced.

---

## The Edge: Low-Volume Bottom Scraping

### The Observation

Stocks frequently dip to intraday lows during the low-volume midday window — roughly 11:30 AM to 1:30 PM ET. These dips are often not driven by fundamental news. They are liquidity artifacts. Volume thins, spreads widen, and small sell pressure creates disproportionate price impact. The result is a temporary dislocation: price moves away from fair value not because fair value changed, but because no one is paying attention.

### The Pattern

These midday lows tend to revert toward VWAP (Volume Weighted Average Price) as afternoon volume returns. The same pattern appears at the weekly scale: midweek lows in low-attention periods that revert as weekly flows normalize. The signal is mean-reversion from a liquidity-driven dislocation, not a fundamental one.

### The Holding Period

Single day to approximately one week. This is not day-trading — too short, too noisy, too dependent on execution speed. This is not investing — too long, too much regime risk, too much exposure to macro events. It is **tactical harvesting** in a sweet spot where the mean-reversion signal is strongest and the carry cost is negligible.

### Why This Edge Persists

This edge lives in a gap between market participants. It is too small in capacity for institutional capital. It is too systematic for retail intuition. It is too short-duration for traditional quant funds, where transaction costs eat alpha at their scale. No single participant class is well-positioned to arbitrage it away.

### Frequent Harvesting, Faster Learning

A one-week holding period means roughly 50 trade cycles per year per position. Each cycle is a learning iteration. More iterations means faster convergence on what works and faster pruning of what does not. A system that executes 50 cycles per year will converge on truth faster than one that executes 12.

The edge is not just the trade. It is the learning rate.

---

## The Learning Philosophy

### Prediction Accuracy Over Profit

A correct read that loses money teaches more than a lucky win. A trade can be profitable by chance and unprofitable despite a correct thesis. Optimizing for prediction accuracy is optimizing for **repeatable edge** — for understanding that compounds, not variance that flatters.

The system scores every prediction: was the behavior correctly anticipated? Did the stock do what the model expected it to do, regardless of whether the trade made money? This is the feedback signal that drives model improvement.

### Sector-Relative Evaluation

A stock that rose 2% when its sector rose 5% is a failed prediction, even though it was profitable. Fire measures **alpha, not beta**. The question is never "did this go up?" — it is "did this outperform its context?" Rising with the tide is not edge. Swimming faster than the tide is.

### Continuous Tuning

Models retrain based on prediction accuracy signals, not backtest curves. The system improves its *understanding* of market behavior, not just its fit to historical price paths. Retraining is triggered by accuracy degradation, not by calendar. The system maintains a record of why each prediction was made, enabling post-hoc analysis of model reasoning.

---

## System Architecture

### Data Infrastructure

A backtest that diverges from live behavior is worse than no backtest at all. The data layer serves both research and live operation from the same pipeline: market data ingested with intraday granularity, queryable in real time, structured for time-series analysis and aggregation. The same data, the same queries, the same logic — in research and in production.

### Regime Detection & Market Trend Analysis

Markets behave differently in different regimes — trending, mean-reverting, volatile, calm. A strategy that works in one regime can destroy capital in another. The regime detector sits upstream of everything: entry signals, exit signals, position sizing, and model selection all condition on the current regime.

This is the system's circuit breaker. If the regime is hostile to the core strategy, the system stands down. Discipline is not optional — it is structural.

### Stock Analysis & Pick Prediction

Not attempting to predict absolute price. The goal is to predict **relative behavior**: will this stock exhibit the bottom-scraping pattern in this regime? The analysis combines fundamental and technical signals to narrow the universe to stocks where the edge thesis applies. Only stocks that pass this filter enter the active universe.

### Entry Strategy / Screener

Regime-differentiated. The screener applies different filters depending on the current market regime. It watches for the specific low-volume-bottom setup: declining volume, price approaching support levels, deviation from VWAP. The output is ranked entry candidates — not binary buy/sell signals, but a prioritized list of opportunities scored by conviction.

### Exit Strategy / Watchlist / Alarms

Also regime-differentiated. Exit thresholds adjust based on the current regime and volatility environment. The watchlist tracks both active positions and upcoming candidates. The alarm system fires on approaching exit signals, regime changes, and anomalous behavior — anything that changes the thesis for an open position.

### Exit Risk Calculator & Lite Automation

Tools for designing stop-loss levels that account for regime and volatility, not just arbitrary percentages. Position sizing calculations that bound risk per trade and per portfolio. Lightweight automation: automated stop placement, alert triggers, and sizing calculations.

The "lite" qualifier is intentional. Full automation removes the human from the learning loop. The system enforces discipline; the human provides thesis and oversight. This boundary is deliberate.

### Real-time Learning & Tuning

The feedback loop that makes everything else improve. After each trade cycle, the system evaluates: was the prediction correct? Did the stock behave as expected? Did it outperform its sector? These accuracy signals feed back into the regime detector, the screener, and the stock analysis models. The system does not just execute — it learns.

---

## System Flow

The architecture forms a closed loop:

1. **Ingest** — Market data flows in at intraday granularity
2. **Assess** — The regime detector reads current market state
3. **Filter** — Stock analysis narrows the universe, conditioned on regime
4. **Screen** — The screener watches for the low-volume-bottom setup
5. **Enter** — Positions are opened on qualified candidates
6. **Manage** — Exit strategy, watchlist, and alarms monitor open positions
7. **Bound** — Risk calculator enforces stops and sizing
8. **Evaluate** — Prediction accuracy is scored against outcomes
9. **Learn** — Models retrain on accuracy signals
10. **Repeat** — Each iteration makes the system sharper

The output of step 9 improves steps 2 through 7 on the next cycle. This is not a pipeline — it is a **flywheel**. Every trade that completes makes the next trade better informed.

---

## Principles

1. **Prediction accuracy over profit.** A correct read that loses money teaches more than a lucky win.

2. **Regime awareness always.** No strategy is unconditional. Every signal is conditioned on the environment.

3. **Harvest frequently.** More iterations means faster learning. Short holding periods are a feature, not a limitation.

4. **Measure alpha, not beta.** Outperforming the sector is the goal. Rising with the tide is not edge.

5. **Automate discipline, not judgment.** The system enforces stops and sizing. The human provides thesis and oversight.

6. **No backtest/live divergence.** The same data, same pipeline, same logic in research and production.

7. **Honest accounting.** Every prediction is recorded, scored, and reviewed. No hiding from bad calls.

8. **Simplicity until proven insufficient.** Complexity is earned by demonstrated need, not anticipated cleverness.

---

## Roadmap

### Phase 1 — Data Foundation

Stand up the data pipeline. Ingest market data with intraday granularity. Store it in a queryable format optimized for time-series analysis. Establish the single pipeline that serves both research and live operation. Validate that historical and real-time data can be queried with the same interface.

*Capability delivered: reliable, queryable market data at intraday resolution.*

### Phase 2 — Regime Detection & Market Context

Build the regime detector. Classify current market conditions across multiple dimensions — trend, volatility, momentum, breadth. Validate regime classifications against historical periods with known characteristics. This component must be operational before any strategy logic is activated.

*Capability delivered: real-time regime classification that gates all downstream decisions.*

### Phase 3 — Stock Analysis & Screening

Develop the stock analysis layer and screener. Filter the market universe to stocks that exhibit the target pattern. Score candidates by conviction. Validate against historical instances of the low-volume-bottom setup.

*Capability delivered: a ranked watchlist of entry candidates, updated intraday.*

### Phase 4 — Entry & Exit Signal Engine

Build the regime-differentiated entry and exit logic. Entry signals fire on the low-volume-bottom setup, conditioned on regime. Exit signals adjust thresholds based on regime and volatility. Watchlist and alarm system operational.

*Capability delivered: actionable entry/exit signals with regime-aware thresholds.*

### Phase 5 — Risk Tooling & Lite Automation

Deploy the exit risk calculator. Stop-loss design tools, position sizing calculations, and lightweight automation for stop placement and alerts. Validate that risk bounds are enforced consistently.

*Capability delivered: disciplined risk management with automated enforcement.*

### Phase 6 — Learning Loop & Continuous Tuning

Close the loop. Implement prediction scoring, accuracy tracking, and model retraining triggered by accuracy degradation. Build the feedback pipeline from trade outcomes back into regime detection, screening, and analysis models.

*Capability delivered: a self-improving system that learns from every trade cycle.*

---

## Disclaimer

Fire is a personal research and trading system. Nothing in this document constitutes financial advice. Trading involves risk, including the risk of total loss of capital. Past performance — whether backtested or live — does not guarantee future results. All strategies described here are hypotheses under continuous evaluation, not proven formulas.
