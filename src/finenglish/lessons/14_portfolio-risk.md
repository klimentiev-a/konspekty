# Topic 14. Portfolio theory and risk measurement
short: Доходность и волатильность портфеля, корреляция и диверсификация, CAPM и бета, альфа, Шарп/Сортино/IR, VaR и expected shortfall, стресс-тесты, поведенческие ошибки
level: C1
unit: 3
minutes: 7

## Theory

> **In one minute.** Risk is the standard deviation (стандартное отклонение) of returns; diversification (диверсификация) removes idiosyncratic risk (специфический риск), not systematic risk (систематический). CAPM prices only beta. Judge managers on risk-adjusted return (доходность с учётом риска): Sharpe, Sortino, information ratio. Banks and funds measure tail risk (хвостовой риск) with VaR and expected shortfall and stress tests.

## Portfolio math

```f
E(R_p) = Σ w_i × E(R_i)
σ_p² = Σ w_i² σ_i² + Σ Σ w_i w_j σ_i σ_j ρ_ij        (two assets: w₁²σ₁² + w₂²σ₂² + 2w₁w₂σ₁σ₂ρ)
Annualised σ = σ_daily × √252;  σ_monthly × √12
β_i = Cov(R_i, R_m) / σ_m² = ρ_im × σ_i / σ_m
CAPM: E(R_i) = R_f + β_i × (E(R_m) − R_f)
Alpha (Jensen) = R_p − [R_f + β_p × (R_m − R_f)]
```

Correlation (корреляция) below 1 lowers portfolio variance; the benefit is largest when ρ is low or negative. In crises correlations go to 1 (корреляции стремятся к единице): diversification fails when needed most.

## Efficient frontier and CAPM

Markowitz: for each risk level there is a maximum-return portfolio; the set is the efficient frontier (граница эффективности). With a risk-free asset the best combination is the tangency portfolio (касательный портфель) on the capital market line (линия рынка капитала); in equilibrium it is the market portfolio. The security market line (линия рынка ценных бумаг) plots expected return against beta; assets above it have positive alpha. Multi-factor models (многофакторные модели: Fama-French size, value, momentum; APT) explain returns that CAPM cannot.

## Risk-adjusted measures

```f
Sharpe = (R_p − R_f) / σ_p
Sortino = (R_p − R_f) / σ_downside
Treynor = (R_p − R_f) / β_p
Information ratio = (R_p − R_benchmark) / Tracking error
Max drawdown = largest peak-to-trough decline (максимальная просадка)
Calmar = Annual return / Max drawdown
```

Sharpe above 1 is good for a diversified fund; hedge funds quote Sortino because upside volatility is not a cost. Tracking error (ошибка слежения) is the volatility of active returns (активная доходность); active share (доля активных позиций) measures how different the portfolio is from the index.

## VaR, expected shortfall, stress

```f
VaR_α,h: loss not exceeded with probability α over horizon h
Parametric VaR (normal): VaR = z_α × σ × √h × Position     (z_99% = 2.33, z_95% = 1.65)
Expected shortfall (ES, CVaR) = average loss beyond VaR
```

Methods: parametric (параметрический), historical simulation (историческое моделирование), Monte Carlo. VaR ignores the tail beyond α; ES fixes that and is the Basel III standard (FRTB). Backtesting (бэктестинг) counts exceptions (превышения): more than expected means the model is wrong. Stress tests (стресс-тесты) and scenario analysis (сценарный анализ) use named shocks: oil −40%, rouble +30%, key rate +500 bp, 2008, 2014, 2022.

## Asset allocation

Strategic asset allocation (стратегическое распределение активов) sets long-run weights by asset class (класс активов): equities, bonds, cash, real estate, commodities, alternatives (private equity, hedge funds, infrastructure). Tactical (тактическое) tilts around them. Rebalancing (ребалансировка) to target weights is a disciplined "sell high, buy low". Risk parity (паритет риска) weights by risk contribution, not by capital. Liability-driven investing, LDI (инвестирование под обязательства) matches pension liabilities with duration.

## Behavioural finance in one table

| Bias | Russian | Effect |
|---|---|---|
| Loss aversion | неприятие потерь | Hold losers, sell winners (disposition effect, эффект диспозиции) |
| Overconfidence | самоуверенность | Overtrading, under-diversification |
| Anchoring | якорение | Fixation on purchase price or round numbers |
| Herding | стадное поведение | Bubbles, panics |
| Recency bias | эффект недавнего | Extrapolating the last year |
| Confirmation bias | склонность к подтверждению | Ignoring contrary evidence |

Rules beat willpower: written policy, rebalancing, position limits (лимиты на позиции).

## Words

| Term | Перевод | Example |
|---|---|---|
| standard deviation | стандартное отклонение | Annualised standard deviation is 25%. |
| idiosyncratic (specific) risk | специфический риск | Idiosyncratic risk is diversified away in 30 stocks. |
| systematic risk | систематический риск | Only systematic risk earns a premium under CAPM. |
| correlation | корреляция | Correlations converge to one in a crisis. |
| covariance | ковариация | Beta is covariance over market variance. |
| efficient frontier | граница эффективности | The portfolio lies on the efficient frontier. |
| tangency portfolio | касательный портфель | The tangency portfolio has the highest Sharpe ratio. |
| security market line | линия рынка ценных бумаг | Assets above the security market line have positive alpha. |
| multi-factor model | многофакторная модель | Fama-French is a three-factor model. |
| Sharpe ratio | коэффициент Шарпа | A Sharpe ratio above 1 is strong. |
| Sortino ratio | коэффициент Сортино | Sortino penalises only downside volatility. |
| information ratio | информационный коэффициент | The manager's information ratio is 0.6. |
| tracking error | ошибка слежения | Tracking error is 3% against the index. |
| active share | доля активных позиций | High active share means real stock picking. |
| maximum drawdown | максимальная просадка | Maximum drawdown reached 40% in 2022. |
| value at risk (VaR) | стоимостная мера риска | One-day 99% VaR is 50 million roubles. |
| expected shortfall (ES) | ожидаемые потери за порогом VaR | Expected shortfall captures the tail. |
| backtesting | бэктестинг | Backtesting showed too many exceptions. |
| strategic / tactical allocation | стратегическое / тактическое распределение | Tactical allocation overweights bonds this quarter. |
| risk parity | паритет риска | Risk parity leverages bonds to match equity risk. |
| disposition effect | эффект диспозиции | The disposition effect makes investors sell winners early. |
| position limit | лимит на позицию | Position limits cap single-name exposure at 5%. |
