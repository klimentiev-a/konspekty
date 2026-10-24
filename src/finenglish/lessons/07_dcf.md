# Topic 7. DCF: forecast, terminal value and the EV bridge
short: Шаги DCF, два метода терминальной стоимости и подразумеваемый g, полный мост EV → Equity с долгоподобными статьями, чувствительность и проверки
level: C1
unit: 2
minutes: 8

## Theory

> **In one minute.** Forecast FCFF for 5–10 years, discount at WACC, add the present value of terminal value (терминальная стоимость), get enterprise value (стоимость предприятия). Subtract net debt and debt-like items, add non-operating assets, divide by diluted shares. Show a sensitivity grid (таблица чувствительности), never a single number. Terminal value is 60–80% of EV, so the cross-check of g against the exit multiple is the most important step.

## Steps

```f
1. Drivers: revenue (volume × price), margins, capex, NWC days, tax
2. FCFF_t = EBIT_t × (1 − t) + D&A_t − Capex_t − ΔNWC_t
3. WACC (Topic 6)
4. TV_n = FCFF_n × (1 + g) / (WACC − g)      — perpetuity growth
   TV_n = EBITDA_n × exit EV/EBITDA           — exit multiple
5. EV = Σ FCFF_t × DF_t + TV_n × DF_n          (mid-year convention for flows)
6. Equity value = EV − net debt − debt-like + non-operating assets
7. Price = Equity value / diluted shares; sensitivity WACC × g
```

## Terminal value: two methods and the cross-check

Perpetuity growth (бессрочный рост): g ≤ long-run nominal GDP growth; for rouble models 3–4%, for dollar 2–3%. The terminal year must be normalised (нормализован): capex ≈ D&A × (1 + g), NWC growing with revenue, margins at mid-cycle (среднециклические).

Exit multiple (выходной мультипликатор): current peer EV/EBITDA, often haircut (с дисконтом) because multiples at the end of a forecast are unknown. Always compute the implied values (подразумеваемые значения):

```f
Implied g from a multiple:  g = (TV × WACC − FCFF_n) / (TV + FCFF_n)
Implied multiple from g:    TV / EBITDA_n
```

If the exit multiple implies g = 8%, the multiple is too high. If the Gordon TV implies 12x EBITDA for a 6x sector, g or margins are too high.

Finite-life assets (конечные активы): mines, oil fields, concessions (концессии) get no TV; model to the end of reserves (life of mine, срок отработки запасов) plus closure and reclamation costs (затраты на закрытие и рекультивацию).

## The EV → Equity bridge

```f
Equity value = EV
  − Gross debt (loans, bonds)
  + Cash and equivalents (less restricted / trapped cash)
  − Lease liabilities (if EBITDA is post-IFRS 16)
  − Preferred shares
  − Minority interest (NCI) at market or book value
  − Pension deficit, decommissioning provisions, litigation provisions
  − Earn-outs and deferred consideration
  + Associates and JVs (equity-accounted, not in EBITDA)
  + Non-core assets, financial investments
```

Consistency rule: whatever is excluded from FCFF must be added or subtracted in the bridge, and vice versa. Price per share uses diluted shares via the treasury stock method (Topic 2).

## Sensitivity and scenarios

Two-way table (двумерная таблица): WACC ± 1pp in rows, g or exit multiple in columns. Then operating sensitivities: commodity price, FX, margin, capex. Scenarios (сценарии): base, bull, bear, each with its own driver set. The output is a range (диапазон) on the football field (диаграмма «футбольное поле») next to trading comps and precedent transactions.

## Sanity checks

- TV share of EV above 85% → forecast too short or g too high.
- Implied EV/EBITDA and P/E versus peers.
- ROIC in the terminal year versus WACC: a perpetual ROIC far above WACC is a strong claim.
- FCFF margin trend: should converge (сходиться) to history or peers.
- Revenue CAGR (среднегодовой темп роста) versus market growth: market share (доля рынка) implied.
- Currency: rouble flows, rouble WACC, rouble net debt; dollar debt converted at the spot rate (спотовый курс).

## DCF variants

FCFE / DDM for banks and insurers (debt is raw material, not financing, so no EV). APV when leverage changes (LBO). Sum-of-the-parts, SOTP (оценка по частям) for conglomerates: value each segment (сегмент) by its own method, subtract corporate costs (корпоративные расходы) and apply a conglomerate discount (дисконт конгломерата) if the market does.

## Words

| Term | Перевод | Example |
|---|---|---|
| driver | драйвер (ключевая переменная) | Volume and price are the revenue drivers. |
| explicit forecast period | прогнозный период | The explicit forecast period is seven years. |
| terminal value (TV) | терминальная стоимость | TV is 70% of enterprise value. |
| perpetuity growth method | метод бессрочного роста | The perpetuity growth method assumes g of 3%. |
| exit multiple method | метод выходного мультипликатора | The exit multiple method uses 6x EBITDA. |
| implied growth / implied multiple | подразумеваемый рост / мультипликатор | The implied growth rate of 8% is unrealistic. |
| normalised terminal year | нормализованный терминальный год | Capex equals D&A in the normalised terminal year. |
| mid-cycle margin | среднециклическая маржа | Use mid-cycle margins for a steelmaker. |
| finite-life asset | актив с конечным сроком жизни | A mine is a finite-life asset with no terminal value. |
| life of mine | срок отработки запасов | The model runs to the end of the life of mine. |
| reclamation costs | затраты на рекультивацию | Reclamation costs are deducted at closure. |
| EV-to-equity bridge | мост от EV к стоимости акций | Lease liabilities sit in the EV-to-equity bridge. |
| deferred consideration | отложенный платёж (за покупку) | Deferred consideration is a debt-like item. |
| equity-accounted | учитываемый по методу долевого участия | Associates are equity-accounted and added separately. |
| two-way sensitivity table | двумерная таблица чувствительности | The two-way table shows WACC against g. |
| range | диапазон, «вилка» | Present a range, not a point estimate. |
| sanity check | проверка на здравый смысл | The implied multiple is a sanity check. |
| converge | сходиться | Margins converge to peer levels by year five. |
| CAGR | среднегодовой темп роста | Revenue CAGR of 12% implies share gains. |
| sum-of-the-parts (SOTP) | оценка по частям | The holding is valued on a sum-of-the-parts basis. |
| conglomerate discount | дисконт конгломерата | A 20% conglomerate discount is applied to SOTP. |
