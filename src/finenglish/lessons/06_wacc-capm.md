# Topic 6. Cost of capital: CAPM and WACC
short: Полная формула WACC, CAPM с страновой премией, unlever/relever беты по Хамаде, стоимость долга, веса по рынку, типичные ошибки и российская специфика
level: C1
unit: 2
minutes: 8

## Theory

> **In one minute.** WACC (средневзвешенная стоимость капитала) is the blended required return (требуемая доходность) of lenders and shareholders, weighted by market values of debt and equity. Ke comes from the CAPM with a beta relevered to the target capital structure; Kd is the current marginal borrowing cost (предельная стоимость заимствования) after tax. Small changes in WACC move a DCF a lot, so every input must be defensible (обоснованным).

## Formulas

```f
WACC = E/(D+E) × Ke + D/(D+E) × Kd × (1 − t)   (+ P/(D+E+P) × Kp if preferred shares)

CAPM: Ke = Rf + β_L × ERP (+ CRP + size premium + specific risk premium)

Hamada:  β_U = β_L / [1 + (1 − t) × D/E]        (unlever peer betas)
         β_L = β_U × [1 + (1 − t) × D/E_target]  (relever to target)
```

## Inputs: cost of equity

- **Risk-free rate (безрисковая ставка):** yield of long government bonds in the currency of the cash flows. Rouble DCF: 10-year OFZ; dollar DCF: 10-year US Treasury. Match currency and horizon.
- **Equity risk premium, ERP (премия за риск акций):** long-run excess return of stocks over bonds; practitioners use 5–6% for developed markets (Damodaran, Kroll surveys).
- **Country risk premium, CRP (страновая премия):** added for emerging markets; estimated from sovereign CDS spreads or sovereign bond spreads scaled by equity volatility. For a rouble DCF with OFZ as Rf part of the country risk is already in Rf; do not double count (не учитывать дважды).
- **Beta (бета):** regression of stock returns on the index, 2–5 years, weekly or monthly. Illiquid stocks give unreliable betas, so use a peer set (аналоги): unlever each peer's beta, take the median, relever to the target's D/E. Adjusted beta (Bloomberg) = 0.67 × raw + 0.33 × 1.
- **Size premium (премия за размер)** and company-specific premium (специфическая премия) are used for small or private companies; justify them, do not plug.

## Inputs: cost of debt

Kd is the yield to maturity on the company's traded bonds or the rate on new loans, not the coupon on old debt. For unrated companies: risk-free + spread implied by a synthetic rating (синтетический рейтинг) from interest coverage. After tax: Kd × (1 − t), valid only while the company has taxable profit to shield (есть прибыль, которую можно защитить).

## Weights

Market value of equity = market capitalization (diluted). Market value of debt ≈ book value unless bonds trade far from par. Use the target capital structure (целевая структура капитала): the industry median or management's stated leverage, not the distressed structure of today. WACC assumes the structure is constant; if leverage changes a lot (LBO), use APV (adjusted present value, скорректированная приведённая стоимость): unlevered value + PV of tax shields − PV of distress costs.

## Why debt is cheaper, up to a point

Lenders are senior and interest is deductible, so Kd(1 − t) < Ke. Adding debt lowers WACC until expected costs of financial distress (ожидаемые издержки финансовых затруднений) and rising Ke and Kd outweigh the tax shield: trade-off theory (теория компромисса). Modigliani-Miller: without taxes and distress, capital structure is irrelevant; with taxes, V_L = V_U + t × D. Pecking order (теория иерархии): firms prefer internal funds, then debt, then equity, because equity issuance signals overvaluation.

## Worked example (rouble)

```f
Rf = 14.5% (10y OFZ), ERP = 6%, β_U(peers) = 0.9, target D/E = 0.5, t = 25%
β_L = 0.9 × [1 + 0.75 × 0.5] = 1.24
Ke = 14.5% + 1.24 × 6% = 21.9%
Kd = 17% → after tax 12.75%
Weights: E = 1/1.5 = 66.7%, D = 33.3%
WACC = 0.667 × 21.9% + 0.333 × 12.75% = 14.6% + 4.25% = 18.9%
```

## Typical mistakes

- Book weights instead of market weights.
- Coupon of old bonds instead of current yield.
- Dollar ERP with rouble Rf, or real flows with nominal WACC.
- Double counting country risk (in Rf and in CRP).
- Using WACC for FCFE or Ke for FCFF.
- A constant WACC for a company that deleverages (снижает долг) over the forecast; use APV or year-by-year WACC.

## Words

| Term | Перевод | Example |
|---|---|---|
| required return | требуемая доходность | Investors' required return rises with risk. |
| marginal cost of borrowing | предельная стоимость заимствования | Kd is the marginal cost of borrowing, not the historical coupon. |
| defensible | обоснованный, защищаемый | Every WACC input must be defensible in front of a client. |
| risk-free rate | безрисковая ставка | We take the 10-year OFZ yield as the risk-free rate. |
| equity risk premium (ERP) | премия за риск инвестирования в акции | An ERP of 6% is standard. |
| country risk premium (CRP) | страновая премия за риск | The CRP is derived from sovereign CDS. |
| double count | учитывать дважды | Do not double count country risk. |
| raw / adjusted beta | сырая / скорректированная бета | Adjusted beta pulls raw beta towards one. |
| unlever / relever | убрать / вернуть эффект долга (бета) | Relever the beta to the target D/E. |
| size premium | премия за размер | A size premium applies to small caps. |
| synthetic rating | синтетический рейтинг | A synthetic rating is inferred from interest coverage. |
| target capital structure | целевая структура капитала | Weights reflect the target capital structure. |
| adjusted present value (APV) | скорректированная приведённая стоимость | APV suits deals with changing leverage. |
| tax shield | налоговый щит | The PV of tax shields is added in APV. |
| financial distress costs | издержки финансовых затруднений | Distress costs offset the tax shield at high leverage. |
| trade-off theory | теория компромисса | The trade-off theory explains optimal leverage. |
| pecking order | теория иерархии финансирования | Under the pecking order, firms issue equity last. |
| signal | сигнал (рынку) | An equity issue signals that shares are overvalued. |
| deleverage | снижать долговую нагрузку | The company plans to deleverage to 1x. |
| practitioner | практик | Practitioners use 5–6% for the ERP. |
