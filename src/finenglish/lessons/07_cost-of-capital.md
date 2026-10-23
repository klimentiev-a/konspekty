# Topic 7. Cost of capital: CAPM and WACC
short: Сколько стоят деньги компании: стоимость собственного капитала через CAPM, стоимость долга, веса и формула WACC
level: B2
unit: 2
minutes: 9

## Theory

## What the cost of capital means

Every company uses other people's money, and other people want a return. The cost of capital (стоимость капитала) is the return the company must earn on its investments to satisfy both lenders (кредиторы) and shareholders (акционеры). If a project earns less than the cost of capital, it destroys value (разрушает стоимость), even if it is profitable on paper.

The cost of capital is also the discount rate (ставка дисконтирования) in a DCF (Topic 8). A small change in it moves the valuation a lot, so bankers argue about every input.

## Two sources, two costs

A company is financed by debt (долг) and equity (собственный капитал). Each has its own cost.

**Cost of debt (стоимость долга)** is easy to see: it is the interest rate (процентная ставка) the company pays on new borrowing, for example the yield (доходность) on its bonds. Because interest is tax-deductible (вычитается из налогооблагаемой прибыли), the after-tax cost of debt (стоимость долга после налогов) is lower:

> **After-tax cost of debt = Kd × (1 − t)**, where t is the tax rate.

If a company borrows at 16% and the tax rate is 25%, debt really costs 12%.

**Cost of equity (стоимость собственного капитала)** is harder, because shareholders do not sign a contract with a fixed rate. It is the return they expect for holding the shares. We estimate it with the CAPM.

## CAPM: capital asset pricing model

The capital asset pricing model, CAPM (модель оценки капитальных активов) says the expected return on a stock depends on one thing: how much market risk (рыночный риск) it carries.

> **Ke = Rf + β × (Rm − Rf).**

- **Rf** is the risk-free rate (безрисковая ставка), usually the yield on long-term government bonds (государственные облигации): US Treasuries for dollar valuations, OFZ for rouble ones.
- **(Rm − Rf)** is the equity risk premium, ERP (премия за риск инвестирования в акции): how much more the stock market (фондовый рынок) returns than risk-free bonds over the long run. In developed markets about 5–6%; for Russia analysts add a country risk premium (страновая премия за риск).
- **β (beta, бета)** measures how much the stock moves with the market. Beta of 1 means the stock moves like the market. Beta of 1.5 means it moves 50% more: higher risk, higher required return. Utilities (коммунальные компании) have betas around 0.5; technology and metals, often above 1.2.

Example: Rf = 14%, ERP = 7%, beta = 1.2. Ke = 14% + 1.2 × 7% = 22.4%.

## Levered and unlevered beta

Beta from the stock market includes the effect of the company's debt: more debt makes shares riskier. This is levered beta (бета с учётом долга). To compare companies with different capital structures, analysts "unlever" beta (убирают эффект долга) and then "relever" it (пересчитывают) for the target company:

> **β unlevered = β levered / [1 + (1 − t) × D/E].**

This is the Hamada formula, and it is used when a company is not listed (не торгуется на бирже) and we must borrow a beta from comparable companies (сопоставимые компании).

## WACC: the weighted average

The weighted average cost of capital, WACC (средневзвешенная стоимость капитала) blends the two costs according to the share of debt and equity in the capital structure (структура капитала):

> **WACC = E/(D+E) × Ke + D/(D+E) × Kd × (1 − t).**

E is the market value of equity (market capitalization, рыночная капитализация), D is the market value of debt (in practice, book value of debt). Weights should be based on market values and on the target capital structure (целевая структура капитала), not on today's accident.

Example: E = 70, D = 30, Ke = 22.4%, Kd = 16%, t = 25%. WACC = 0.7 × 22.4% + 0.3 × 16% × 0.75 = 15.7% + 3.6% = 19.3%.

## Why debt lowers WACC, up to a point

Debt is cheaper than equity for two reasons: lenders are paid first, so they take less risk, and interest is tax-deductible. So adding debt lowers WACC at first. But as leverage (долговая нагрузка) grows, both Kd and Ke rise, because default risk (риск дефолта) grows. At some point WACC starts to rise again. The capital structure with the lowest WACC is the optimal capital structure (оптимальная структура капитала). This is the trade-off theory (теория компромисса): tax benefits of debt against costs of financial distress (издержки финансовых затруднений).

Modigliani and Miller (Модильяни и Миллер) showed that in a perfect world without taxes, capital structure does not matter at all. Taxes and bankruptcy costs are what make it matter in practice.

## Typical mistakes

- Using the coupon on old bonds instead of the current market yield for Kd.
- Mixing nominal cash flows with a real discount rate, or rouble cash flows with a dollar WACC.
- Using book values for weights.
- Forgetting to add the country risk premium for emerging markets (развивающиеся рынки).
- Taking beta from a short, noisy period.

## Hurdle rates in practice

Companies often set a hurdle rate (пороговая ставка) above WACC to leave a margin for error, for example WACC plus 2–3 points. Private equity funds think in IRR targets (целевая IRR), typically 20–25%, rather than WACC.

> **Remember.** Ke = Rf + β × ERP. WACC = weighted Ke and after-tax Kd. Debt is cheaper, but too much debt raises everybody's risk. WACC is the discount rate for FCFF.

## Words

| Term | Перевод | Example |
|---|---|---|
| cost of capital | стоимость капитала | Projects must earn more than the cost of capital. |
| cost of equity (Ke) | стоимость собственного капитала | The cost of equity is estimated with the CAPM. |
| cost of debt (Kd) | стоимость долга | The cost of debt equals the yield on the company's bonds. |
| after-tax | после налогов | The after-tax cost of debt is lower because interest is deductible. |
| tax-deductible | вычитаемый из налоговой базы | Interest is tax-deductible, dividends are not. |
| CAPM | модель оценки капитальных активов | CAPM links expected return to beta. |
| beta | бета | A beta above 1 means the stock is more volatile than the market. |
| equity risk premium (ERP) | премия за риск инвестирования в акции | Analysts assume an equity risk premium of 6%. |
| country risk premium | страновая премия за риск | Emerging markets require a country risk premium. |
| levered / unlevered beta | бета с учётом / без учёта долга | We unlever the peer betas and relever them for the target. |
| WACC | средневзвешенная стоимость капитала | WACC is used to discount free cash flow to the firm. |
| weighted average | средневзвешенное | WACC is a weighted average of the costs of debt and equity. |
| market value | рыночная стоимость | Weights should use market values of debt and equity. |
| target capital structure | целевая структура капитала | The target capital structure is 30% debt. |
| leverage | долговая нагрузка, финансовый рычаг | Higher leverage raises the cost of equity. |
| optimal capital structure | оптимальная структура капитала | The optimal capital structure minimises WACC. |
| trade-off theory | теория компромисса | The trade-off theory balances tax savings against distress costs. |
| financial distress | финансовые затруднения | Costs of financial distress rise with debt. |
| comparable companies (peers) | сопоставимые компании | Beta was taken from a set of listed peers. |
| hurdle rate | пороговая ставка | The hurdle rate for new projects is 20%. |
