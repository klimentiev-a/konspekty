# Topic 6. Time value of money: discounting, NPV and IRR
short: Приведённая и будущая стоимость, ставка дисконтирования, аннуитет, перпетуитет, NPV и IRR на простых числах
level: B2
unit: 2
minutes: 9

## Theory

## Why a rouble today beats a rouble tomorrow

The time value of money (временная стоимость денег) is the idea that money available now is worth more than the same amount in the future. Three reasons: you can invest it and earn interest (проценты), inflation (инфляция) reduces what money buys, and the future is uncertain (неопределённое). Everything in valuation is built on this idea.

## Future value: compounding

If you put 100 in a deposit at 10% per year, after one year you have 110. After two years you have 121, not 120, because in the second year you earn interest on the interest. This is compounding (сложные проценты, капитализация). The formula for future value (будущая стоимость):

> **FV = PV × (1 + r)^n**, where PV is the present value (приведённая, текущая стоимость), r is the interest rate (процентная ставка) per period and n is the number of periods.

Compounding is powerful over long horizons: 100 at 10% becomes 259 after ten years and 1,745 after thirty.

## Present value: discounting

Discounting (дисконтирование) is compounding in reverse. If you will receive 121 in two years and rates are 10%, that promise is worth 100 today:

> **PV = FV / (1 + r)^n.**

The rate used is called the discount rate (ставка дисконтирования). The factor 1 / (1 + r)^n is the discount factor (коэффициент дисконтирования). The higher the rate or the longer the wait, the smaller the present value. That is why a high key rate (ключевая ставка) hurts growth stocks: their profits are far in the future, and a high discount rate makes them worth less today.

## Which rate to use

The discount rate should reflect the risk of the cash flow. A government bond (государственная облигация) coupon is nearly certain, so it is discounted at the risk-free rate (безрисковая ставка). A start-up's forecast is very uncertain, so investors may use 30–40%. For a company's cash flows we use the cost of capital (стоимость капитала), which is Topic 7. The general rule: the discount rate = risk-free rate + risk premium (премия за риск).

## Annuity and perpetuity

An annuity (аннуитет) is a series of equal payments for a fixed number of periods, such as a mortgage (ипотека) or a bond coupon (купон). Its present value:

> **PV of annuity = C × [1 − (1 + r)^−n] / r**, where C is the payment per period.

A perpetuity (перпетуитет, бессрочная рента) is a payment that continues forever. The formula is beautifully simple:

> **PV of perpetuity = C / r.**

A growing perpetuity (растущий перпетуитет), where the payment grows at rate g each year, is worth C / (r − g). This formula is the Gordon growth model (модель Гордона) when applied to dividends, and the basis of the terminal value (терминальная стоимость) in a DCF (Topic 8). It only works when g is smaller than r.

Example: a share pays a dividend of 10 next year, dividends grow 3% a year, and investors want 13%. Price = 10 / (0.13 − 0.03) = 100.

## Net present value (NPV)

Net present value (чистая приведённая стоимость) is the sum of all discounted cash flows of a project, including the initial investment (первоначальные инвестиции), which is negative:

> **NPV = Σ CF_t / (1 + r)^t − Initial investment.**

Decision rule: if NPV > 0, the project creates value (создаёт стоимость), accept it. If NPV < 0, reject. Example: invest 1,000 today, receive 600 at the end of year 1 and 600 at the end of year 2, discount rate 10%. PV = 600/1.1 + 600/1.21 = 545 + 496 = 1,041. NPV = 41 > 0: accept. In Excel: =NPV(rate; flows) + initial investment (the Russian version is ЧПС).

## Internal rate of return (IRR)

The internal rate of return (внутренняя норма доходности) is the discount rate at which NPV equals zero. It is the project's own return. Decision rule: accept if IRR is higher than the required rate, often called the hurdle rate (пороговая ставка). In the example above, IRR is about 13%: higher than 10%, so accept. In Excel: =IRR(flows) (ВСД).

IRR is popular because it is a single percentage that is easy to compare. Private equity funds (фонды прямых инвестиций) report their results as IRR. But it has problems: it assumes reinvestment at the IRR itself, and a project with alternating positive and negative flows can have several IRRs. When NPV and IRR disagree, trust NPV.

## Payback period

The payback period (срок окупаемости) is how long it takes to get the investment back. It is simple and used in practice, but ignores the time value of money and everything after the payback date. The discounted payback period (дисконтированный срок окупаемости) fixes the first problem.

## Effective and nominal rates

A 12% annual rate compounded monthly is actually 12.68% per year, because interest is added twelve times. The quoted rate is the nominal rate, APR (номинальная ставка); the real cost is the effective annual rate, EAR (эффективная годовая ставка): (1 + 0.12/12)^12 − 1. Banks quote the nominal rate for loans and the effective rate for deposits, for obvious reasons.

## Continuous compounding and the rule of 72

A quick trick: the rule of 72 (правило 72) says money doubles in roughly 72 / r years. At 8%, in 9 years; at 14%, in about 5 years. For derivatives pricing, continuous compounding (непрерывное начисление) is used: FV = PV × e^(rt). You will meet it in the Black-Scholes model (Topic 13).

> **Remember.** PV = FV / (1 + r)^n. Perpetuity = C / r, growing perpetuity = C / (r − g). NPV > 0 means accept. IRR is the rate where NPV = 0. When they disagree, NPV wins.

## Words

| Term | Перевод | Example |
|---|---|---|
| present value (PV) | приведённая стоимость | The present value of 121 in two years at 10% is 100. |
| future value (FV) | будущая стоимость | Future value grows with compounding. |
| compounding | сложные проценты, капитализация | Monthly compounding gives a higher effective rate. |
| discounting | дисконтирование | Discounting converts future cash into today's money. |
| discount rate | ставка дисконтирования | A higher discount rate lowers valuations. |
| discount factor | коэффициент дисконтирования | The discount factor for year 3 at 10% is 0.751. |
| risk-free rate | безрисковая ставка | OFZ yields are used as the risk-free rate in Russia. |
| annuity | аннуитет | A mortgage is an annuity with equal monthly payments. |
| perpetuity | перпетуитет, бессрочная рента | A perpetuity is worth the payment divided by the rate. |
| growing perpetuity | растущий перпетуитет | Terminal value uses a growing perpetuity formula. |
| Gordon growth model | модель Гордона | The Gordon growth model prices a stock from its dividends. |
| net present value (NPV) | чистая приведённая стоимость | Accept the project if NPV is positive. |
| internal rate of return (IRR) | внутренняя норма доходности | The fund targets an IRR of 25%. |
| hurdle rate | пороговая ставка | Projects below the hurdle rate are rejected. |
| initial investment | первоначальные инвестиции | The initial investment is 1 billion roubles. |
| payback period | срок окупаемости | The payback period is four years. |
| nominal rate (APR) | номинальная ставка | The loan has a nominal rate of 12%. |
| effective annual rate (EAR) | эффективная годовая ставка | The effective annual rate is 12.68%. |
| rule of 72 | правило 72 | By the rule of 72, money doubles in nine years at 8%. |
| terminal value | терминальная стоимость | Terminal value often makes up most of a DCF. |
