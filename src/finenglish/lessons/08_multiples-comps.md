# Topic 8. Multiples, trading comps and precedent transactions
short: Согласованность числителя и знаменателя, LTM/NTM и календаризация, выбор аналогов, нормализация, премия за контроль, football field
level: B2
unit: 2
minutes: 8

## Theory

> **In one minute.** A multiple (мультипликатор) is value divided by a metric. EV, enterprise value (стоимость бизнеса), goes with pre-interest metrics (revenue, EBITDA, EBIT); equity value (стоимость акционерного капитала) goes with post-interest metrics (net income, book equity). Trading comps (сопоставимые публичные компании) give the market's price for a minority stake; precedent transactions (прошлые сделки) include a control premium (премия за контроль). Multiples are a compressed DCF (discounted cash flow, модель дисконтированных денежных потоков): high growth and low risk mean a high multiple.

## Consistency

```f
EV / Revenue, EV / EBITDA, EV / EBIT, EV / capacity   — numerator: EV (all capital providers)
P / E, P / B, P / FCFE, dividend yield                 — numerator: equity value
Wrong: EV / Net income, Price / EBITDA
EV = Market cap (diluted) + Net debt + NCI + Preferred − Associates
```

NCI is non-controlling interest (неконтролирующая доля); associates (ассоциированные компании) are subtracted because their profit is not in EBITDA.

If EBITDA is post-IFRS 16 (МСФО 16), EV must include lease liabilities. If EBITDA excludes associates, their value is excluded from EV. Same rule for pensions and other debt-like items.

## Choosing and calendarising metrics

LTM (last twelve months, за последние 12 месяцев): last annual + current YTD (year to date, с начала года) − prior YTD. NTM / forward (прогнозные): consensus (консенсус-прогноз) for the next 12 months. Calendarisation (календаризация): align peers with different fiscal year ends (конец финансового года). Normalise (нормализовать) EBITDA and net income for one-offs; use diluted shares; convert currencies at the same date.

## Peer selection

Criteria: industry and business model, size, geography, growth, margins, capital intensity (капиталоёмкость), accounting standards. Five to ten names. Exclude peers in distress, in a takeover, or with negative metrics. Report median (медиана) and interquartile range (межквартильный размах), not the mean (среднее), to limit outliers (выбросы).

## What drives a multiple

```f
From Gordon:  P/E ≈ Payout / (Ke − g);   EV/EBITDA ≈ (1 − t)(1 − reinvestment rate) / (WACC − g) × (EBIT/EBITDA)
```

Here Ke is the cost of equity (стоимость собственного капитала), g the long-term growth rate, t the tax rate, and the reinvestment rate (доля реинвестирования) is the share of NOPAT spent on capex and working capital.

So compare multiples with growth and returns: PEG (price/earnings to growth) = P/E / growth; "EV/EBITDA versus EBITDA growth" scatter. A premium (премия) to peers needs a reason: higher growth, higher ROIC (return on invested capital, рентабельность инвестированного капитала), lower risk, better governance (корпоративное управление). A discount (дисконт) can be a sanctions, liquidity, free-float (доля акций в свободном обращении) or governance discount; Russian equities trade at a steep discount to EM (emerging markets, развивающиеся рынки) peers for all four.

## Industry-specific multiples

| Sector | Multiples |
|---|---|
| Banks, insurers | P/E, P/B, P/TBV (к материальному капиталу), ROE (return on equity, рентабельность капитала) vs P/B |
| Oil and gas, mining | EV/EBITDA, EV/reserves (к запасам), EV/production, EV/2P (proved + probable reserves, доказанные и вероятные запасы) |
| Retail | EV/EBITDA(R), EV/Sales, sales per square metre |
| Telecom, utilities | EV/EBITDA, EV/subscriber, EV/MW or EV/RAB (регулируемая база активов) |
| Tech, SaaS (software as a service, ПО по подписке) | EV/Sales, EV/ARR (annual recurring revenue, годовая повторяющаяся выручка), Rule of 40 (правило 40: рост выручки + маржа ≥ 40%) |
| Real estate | P/NAV (к чистой стоимости активов), cap rate (ставка капитализации) |

## Trading comps versus precedent transactions

| | Trading comps | Precedent transactions |
|---|---|---|
| Price reflects | Minority stake, liquid market, today | Control, synergies, deal conditions, past dates |
| Level | Lower | Higher by control premium of 20–40% |
| Data | Public, current | Deal terms often undisclosed |
| Use | Fair market value, IPO (initial public offering, первичное размещение) pricing | M&A (mergers and acquisitions, слияния и поглощения), fairness opinions (заключение о справедливости цены) |

For precedent deals, note the date (the cycle), the buyer type (strategic vs financial), the stake (control or minority), payment form (cash or stock) and whether synergies were priced.

## Pitfalls

- Peak-cycle earnings make cyclicals look cheap; use mid-cycle or EV/capacity.
- Negative or tiny earnings → P/E meaningless; move up the P&L (ОФР) to EBITDA or sales.
- Different accounting: capitalised costs, IFRS 16, revenue gross vs net.
- Stale market data; pre-announcement prices for targets (unaffected price, цена до объявления).
- Multiples of controlled companies with low free float are not clean references.

## Presentation

Football field: horizontal bars for each method — 52-week range (диапазон за 52 недели), analyst targets, trading comps (25th–75th percentile), precedents, DCF (WACC × g range), LBO value (LBO, leveraged buyout — цена, которую может заплатить фонд при покупке в долг). The overlap (пересечение) is the defensible range.

## Words

| Term | Перевод | Example |
|---|---|---|
| numerator / denominator consistency | согласованность числителя и знаменателя | Check numerator and denominator consistency before comparing. |
| LTM (last twelve months) | за последние 12 месяцев | LTM EBITDA is 120 billion roubles. |
| NTM (next twelve months) | за следующие 12 месяцев | NTM multiples use consensus forecasts. |
| calendarisation | календаризация | Calendarisation aligns fiscal years. |
| consensus estimate | консенсус-прогноз | The stock trades at 5x consensus EBITDA. |
| capital intensity | капиталоёмкость | Capital intensity differs across peers. |
| interquartile range | межквартильный размах | The interquartile range is 5–7x. |
| premium / discount to peers | премия / дисконт к аналогам | The discount to peers reflects governance risk. |
| PEG ratio | P/E к росту | A PEG below 1 suggests growth is cheap. |
| governance | корпоративное управление | Weak governance justifies a discount. |
| tangible book value (TBV) | материальный балансовый капитал | Banks trade on price to tangible book value. |
| regulated asset base (RAB) | регулируемая база активов | Utilities are valued on EV/RAB. |
| net asset value (NAV) | чистая стоимость активов | REITs trade at a discount to NAV. |
| cap rate | ставка капитализации | A 10% cap rate implies a value of 10x net operating income. |
| minority stake | миноритарный пакет | Trading comps price a minority stake. |
| control premium | премия за контроль | The control premium averaged 30%. |
| fairness opinion | заключение о справедливости цены | The board obtained a fairness opinion. |
| unaffected price | цена до объявления о сделке | The premium is measured to the unaffected price. |
| stale data | устаревшие данные | Stale data distorts the comps. |
| 52-week range | диапазон за 52 недели | The offer is above the 52-week range. |
| overlap | пересечение (диапазонов) | The overlap of methods defines the valuation range. |
