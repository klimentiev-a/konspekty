# Topic 16. LBO modelling and private equity returns
short: Sources & uses, структура долга по траншам, cash sweep, три источника доходности, IRR и MOIC, быстрый расчёт в уме, выходы, что проверяет кредитор
level: C1
unit: 4
minutes: 8

## Theory

> **In one minute.** An LBO (выкуп с долговым финансированием) buys a company with 50–70% debt secured on its own cash flows and sells it in 3–7 years. Returns come from debt paydown (погашение долга), EBITDA growth and multiple expansion (рост мультипликатора). The model answers two questions: what IRR does the sponsor (фонд) get at a given price, and what price can it pay for a target IRR (20–25%).

## Sources and uses

```f
Uses:    Equity purchase price + Refinanced net debt + Fees (M&A, financing, legal) + Minimum cash
Sources: Senior debt (term loan A/B, revolver) + Second lien / mezzanine / HY bonds + Sponsor equity (+ rollover equity)
Entry EV = EBITDA × entry multiple;  total leverage = Debt / EBITDA (4–6x US/EU; 2–3x Russia at current rates)
```

Rollover equity (переходящая доля): management or seller reinvests part of proceeds. Management incentive plan, MIP (опционная программа менеджмента): 5–10% of equity upside.

## Debt structure

| Tranche | Pricing | Repayment | Notes |
|---|---|---|---|
| Revolver | Base + 2–3% | Drawn / repaid as needed | Liquidity, commitment fee (комиссия за резервирование) |
| Term loan A | Base + 3–4% | Amortising (амортизируемый) | Bank debt, maintenance covenants |
| Term loan B | Base + 4–5% | 1% a year, bullet (единовременно в конце) | Institutional, cov-lite |
| Second lien / mezzanine | 10–14%, PIK option | Bullet | Subordinated, warrants |
| High-yield bonds | Fixed 7–10% | Bullet | Incurrence covenants, call protection (защита от досрочного погашения) |

PIK (payment-in-kind, проценты капитализируются) interest accrues to principal instead of being paid in cash. Cash sweep (досрочное погашение из избыточных денег): 50–100% of excess cash flow repays senior debt first.

## The model in steps

```f
1. Entry: price, S&U, opening balance sheet with goodwill from PPA
2. Operating forecast: revenue, EBITDA, capex, NWC → FCF before debt service
3. Debt schedule: interest by tranche (average balance, circularity), mandatory amortisation, cash sweep
4. Exit in year N: EV = EBITDA_N × exit multiple; Equity = EV − Net debt_N − MIP
5. Returns: MOIC = Exit equity / Entry equity;  IRR from dated flows (XIRR)
6. Sensitivities: entry/exit multiple, leverage, EBITDA growth; ability-to-pay analysis (максимальная цена под целевую IRR)
```

## Return attribution

```f
Equity_exit − Equity_entry = ΔEBITDA × multiple_entry   (EBITDA growth)
                           + EBITDA_exit × Δmultiple     (multiple expansion)
                           + Debt paydown                (deleveraging)
```

A disciplined model assumes exit multiple = entry multiple; returns must come from operations and deleveraging. Dividend recap (дивидендная рекапитализация): re-lever mid-life to return cash early, lifting IRR.

## Quick math

Entry EBITDA 100, 8x → EV 800, debt 500, equity 300. Exit year 5: EBITDA 130, 8x → EV 1,040, net debt 250 → equity 790. MOIC 2.6x, IRR ≈ 21%. Rule: IRR ≈ MOIC^(1/n) − 1; 2x in 5 years ≈ 15%, 3x in 5 ≈ 25%.

## What makes a target LBO-able

Stable cash flows and margins, low capex intensity, low cyclicality, hard assets as collateral (обеспечение), fragmented market for bolt-ons (дополняющие покупки), weak existing balance sheet (room to lever), clear exit (strategic buyer, IPO, secondary buyout, продажа другому фонду). Not LBO-able: loss-making growth, heavy capex, regulated prices with political risk.

## Lender's view and covenants

Maintenance covenants (поддерживаемые ковенанты) tested quarterly: Net debt/EBITDA ≤ x, interest coverage ≥ y, capex cap. Incurrence covenants (ковенанты на действия) only when the company acts: new debt, dividends, asset sales. Headroom (запас по ковенанту) of 25–30% against the sponsor case. Equity cure (докапитализация для исправления нарушения): sponsor injects equity to fix a breach. Security package (пакет обеспечения): share pledge (залог акций), asset pledge, guarantees from opcos (операционные компании).

## PE fund mechanics

LPs commit capital (обязательства инвесторов); GP calls it (capital call) as deals close; 2% management fee, 20% carry over an 8% hurdle with catch-up (догоняющая выплата); clawback (возврат переплаченного вознаграждения) if later deals lose. Fund life 10 years: investment period (инвестиционный период) 5, harvesting (выход из инвестиций) 5. DPI (распределения к вложенному капиталу) and TVPI (общая стоимость к вложенному) complement IRR.

## Words

| Term | Перевод | Example |
|---|---|---|
| sponsor | спонсор сделки (фонд прямых инвестиций) | The sponsor contributed 40% equity. |
| sources and uses | источники и использование средств | Sources and uses must balance to the rouble. |
| rollover equity | переходящая доля (реинвестирование продавца) | Management rolled over 10% of proceeds. |
| management incentive plan (MIP) | программа мотивации менеджмента | The MIP gives managers 8% of exit equity. |
| term loan A / B | срочный кредит А / Б | Term loan B is bullet with 1% amortisation. |
| bullet repayment | единовременное погашение в конце срока | Bonds have bullet repayment at maturity. |
| second lien | долг второй очереди залога | Second lien sits behind the senior loans. |
| PIK (payment-in-kind) | капитализируемые проценты | PIK interest accrues to principal. |
| commitment fee | комиссия за резервирование лимита | The revolver carries a 0.5% commitment fee. |
| call protection | защита от досрочного погашения | Call protection lasts three years. |
| cash sweep | досрочное погашение из избыточного денежного потока | A 75% cash sweep deleverages quickly. |
| ability-to-pay analysis | анализ максимальной цены под целевую доходность | Ability-to-pay shows 8.5x at a 20% IRR. |
| return attribution | разложение доходности по источникам | Return attribution shows most value from deleveraging. |
| dividend recapitalisation | дивидендная рекапитализация | A dividend recap returned 0.5x early. |
| bolt-on acquisition | дополняющее поглощение | Bolt-ons double the platform's EBITDA. |
| secondary buyout | продажа другому фонду | Exit via secondary buyout to another sponsor. |
| maintenance / incurrence covenants | поддерживаемые / ограничительные ковенанты | Term loan B has only incurrence covenants. |
| headroom | запас по ковенанту | Covenant headroom is 30% to EBITDA. |
| equity cure | исправление нарушения ковенанта взносом в капитал | An equity cure right allows two cures over the life. |
| share pledge | залог акций | Lenders hold a share pledge over the target. |
| catch-up / clawback | догоняющая выплата / возврат вознаграждения | Carry has a full catch-up after the hurdle. |
| DPI / TVPI | распределения / общая стоимость к вложенному капиталу | DPI of 1.2x means investors got their money back. |
