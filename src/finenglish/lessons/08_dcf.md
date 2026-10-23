# Topic 8. DCF valuation step by step
short: Модель дисконтированных денежных потоков: прогноз, терминальная стоимость, от стоимости предприятия к цене акции, анализ чувствительности
level: B2
unit: 2
minutes: 10

## Theory

## The idea

Discounted cash flow, DCF (метод дисконтированных денежных потоков) values a company as the present value of the cash it will generate in the future. It is called intrinsic valuation (оценка по внутренней стоимости), because it does not depend on what the market thinks today. "Walk me through a DCF" is the most common technical interview question in investment banking, so learn the steps in order.

## Step 1: forecast free cash flow

Build a forecast (прогноз) for 5–10 years, the explicit forecast period (прогнозный период). Start with revenue (выручка) and assumptions (предпосылки, допущения) about growth, margins, capex and working capital. For each year calculate free cash flow to the firm, FCFF (свободный денежный поток для фирмы):

> **FCFF = EBIT × (1 − t) + D&A − Capex − ΔNWC.**

The assumptions are the heart of the model. Good analysts explain each one: "Revenue grows 8% because volumes grow 3% and prices 5%." Bad analysts type numbers.

## Step 2: choose the discount rate

Because FCFF belongs to all capital providers (поставщики капитала), discount it at WACC (Topic 7). If you use FCFE, cash flow to shareholders only, discount at the cost of equity. Never mix: FCFF with WACC, FCFE with Ke.

## Step 3: terminal value

The company does not stop after year 5, so we need the value of all cash flows after the forecast period: terminal value, TV (терминальная стоимость). Two methods.

**Perpetuity growth method (метод бессрочного роста, модель Гордона):**

> **TV = FCFF_(n+1) / (WACC − g)**, where g is the long-term growth rate (долгосрочный темп роста).

Take the last forecast year's cash flow, grow it one more year, divide by WACC minus g. The growth rate must be modest: usually inflation or long-run GDP growth, 2–4%. A company cannot grow faster than the economy forever.

**Exit multiple method (метод выходного мультипликатора):**

> **TV = EBITDA_n × exit multiple**, for example 6x EV/EBITDA.

Here we assume the company is sold at the end of the forecast at a multiple typical for the industry (Topic 9). Bankers often show both and check that they give similar results.

Terminal value typically makes up 60–80% of total value. That is why DCF is sensitive (чувствителен) to g and WACC.

## Step 4: discount everything to today

Discount each year's FCFF and the terminal value:

> **EV = Σ FCFF_t / (1 + WACC)^t + TV / (1 + WACC)^n.**

The result is enterprise value, EV (стоимость предприятия, стоимость бизнеса): the value of the operating business for all investors together. A detail: if cash flows arrive during the year rather than at the end, use the mid-year convention (поправка на середину года), discounting with t − 0.5.

## Step 5: from enterprise value to equity value

Shareholders do not own the whole enterprise value; lenders get their part first.

> **Equity value = EV − Net debt − Preferred shares − Minority interest + Non-operating assets.**

Net debt (чистый долг) is debt minus cash. Minority interest, also called non-controlling interest (доля меньшинства, неконтролирующая доля) is the part of subsidiaries (дочерние компании) owned by others. Non-operating assets (непрофильные активы), such as a stake in another company, are added. This bridge (мост от стоимости предприятия к стоимости капитала) is the second most common interview question.

## Step 6: price per share

Divide equity value by the number of diluted shares outstanding (разводнённое количество акций в обращении), which includes shares from options and convertibles (конвертируемые бумаги). Compare with the market price (рыночная цена). If the DCF price is above the market, the stock is undervalued (недооценена): a buy recommendation. If below, overvalued (переоценена).

## Step 7: sensitivity analysis

Because the result depends on assumptions, every DCF ends with a sensitivity table (таблица чувствительности): price per share for different combinations of WACC (rows) and g or exit multiple (columns). A good model also has scenarios (сценарии): base case (базовый), bull case (оптимистичный) and bear case (пессимистичный). Presenting a single number without a range is a sign of a beginner.

## A numerical sketch

FCFF for years 1–5: 100, 110, 120, 130, 140. WACC 15%, g 3%.

- PV of forecast flows ≈ 87 + 83 + 79 + 74 + 70 = 393.
- TV = 140 × 1.03 / (0.15 − 0.03) = 1,202. PV of TV = 1,202 / 1.15^5 = 597.
- EV = 393 + 597 = 990. TV is 60% of value.
- Net debt 200 → equity value 790. With 100 shares, price = 7.9 per share.

Raise WACC to 17% and the price falls to roughly 6.6. That is the sensitivity.

## Strengths and weaknesses

DCF is theoretically correct and forces you to think about the business. But it is only as good as its assumptions, it is very sensitive to WACC and g, and it is hard to use for companies with negative cash flows or no history. In practice, bankers triangulate (сверяют) a DCF with multiples (Topic 9) and show all methods on one chart, the football field (диаграмма «футбольное поле»).

> **Remember.** Forecast FCFF → discount at WACC → add terminal value → enterprise value → subtract net debt → equity value → divide by shares. Always show sensitivity.

## Words

| Term | Перевод | Example |
|---|---|---|
| discounted cash flow (DCF) | метод дисконтированных денежных потоков | The DCF suggests the stock is undervalued. |
| intrinsic value | внутренняя стоимость | Intrinsic value does not depend on market mood. |
| forecast period | прогнозный период | The explicit forecast period is five years. |
| assumption | предпосылка, допущение | The key assumption is 5% revenue growth. |
| terminal value (TV) | терминальная стоимость | Terminal value accounts for 70% of the valuation. |
| perpetuity growth method | метод бессрочного роста | The perpetuity growth method uses a 3% long-term rate. |
| exit multiple | выходной мультипликатор | We applied an exit multiple of 6x EBITDA. |
| long-term growth rate | долгосрочный темп роста | The long-term growth rate should not exceed GDP growth. |
| enterprise value (EV) | стоимость предприятия | Enterprise value is the value for all investors. |
| equity value | стоимость собственного капитала | Equity value equals EV minus net debt. |
| EV-to-equity bridge | мост от стоимости предприятия к капиталу | Walk me through the EV-to-equity bridge. |
| minority interest (non-controlling interest) | доля меньшинства | Minority interest is subtracted from EV. |
| non-operating assets | непрофильные активы | Non-operating assets are added to get equity value. |
| diluted shares | разводнённое количество акций | Diluted shares include in-the-money options. |
| undervalued / overvalued | недооценённый / переоценённый | The analyst believes the stock is undervalued. |
| mid-year convention | поправка на середину года | The mid-year convention assumes cash arrives mid-year. |
| sensitivity analysis | анализ чувствительности | Sensitivity analysis shows the range of outcomes. |
| base case / bull case / bear case | базовый / оптимистичный / пессимистичный сценарий | In the bear case the price falls to 5. |
| football field | диаграмма «футбольное поле» | The football field compares DCF and multiples. |
| triangulate | сверять несколькими методами | Bankers triangulate DCF with trading comps. |
