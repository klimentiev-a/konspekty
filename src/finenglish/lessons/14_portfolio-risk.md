# Topic 14. Portfolio theory and risk
short: Доходность и риск, диверсификация, корреляция, граница эффективности, бета и альфа, коэффициент Шарпа, VaR и как измеряют риск
level: C1
unit: 3
minutes: 9

## Theory

## Risk is measurable

In everyday speech risk means danger. In finance, risk (риск) is the uncertainty of returns, and it is measured. The standard measure is volatility (волатильность): the standard deviation (стандартное отклонение) of returns, usually annualised (в годовом выражении). A stock with 30% volatility typically moves within plus or minus 30% of its expected return in two years out of three. Government bonds have volatility of a few percent; bitcoin, 60–80%.

Expected return (ожидаемая доходность) is the average return you expect over time. The whole of portfolio theory is about getting the most expected return for a given level of risk.

## Diversification: the only free lunch

Diversification (диверсификация) means holding many different assets so that their individual risks partly cancel out. If one stock falls because of a factory fire, another is unaffected. The key is correlation (корреляция): how much two assets move together, from +1 (always together) to −1 (always opposite). Combining assets with low or negative correlation lowers portfolio volatility without lowering expected return. Harry Markowitz called this the only free lunch in finance (единственный бесплатный обед в финансах), and his modern portfolio theory, MPT (современная портфельная теория) won a Nobel Prize.

Risk has two parts. Unsystematic risk, also called specific or idiosyncratic risk (несистематический, специфический риск) belongs to one company and can be diversified away with 20–30 stocks. Systematic risk, market risk (систематический, рыночный риск) affects everything, such as a recession or a rate hike, and cannot be diversified away. Because investors can remove specific risk for free, the market rewards only systematic risk. That is the logic behind beta and the CAPM (Topic 7).

## The efficient frontier

For every level of risk there is a portfolio with the highest possible expected return. Plotted on a chart with risk on the horizontal axis and return on the vertical, these portfolios form a curve: the efficient frontier (граница эффективности). Any portfolio below the curve is inefficient: you could get more return for the same risk. Adding a risk-free asset (безрисковый актив) such as short government bonds turns the curve into a straight line, the capital market line (линия рынка капитала). The best risky portfolio for everyone is the market portfolio (рыночный портфель); investors choose how much of it to hold versus cash.

## Beta and alpha

Beta (бета) measures an asset's systematic risk: how much it moves with the market. The market has a beta of 1. A portfolio of beta 1.3 is expected to rise 13% when the market rises 10% and fall 13% when it falls 10%.

Alpha (альфа) is the return above what beta explains: the manager's skill, or luck. If the market returns 10%, the portfolio has beta 1.3, and the risk-free rate is 5%, CAPM expects 5% + 1.3 × 5% = 11.5%. If the portfolio actually returns 14%, alpha is 2.5%. Active managers (активные управляющие) are paid to produce alpha; most do not, after fees (после вычета комиссий), which is why passive index funds (пассивные индексные фонды) have grown.

## Risk-adjusted return

Comparing returns alone is unfair: a fund with 20% return and 40% volatility may be worse than one with 12% and 10%. Risk-adjusted measures (показатели доходности с учётом риска) fix this.

- **Sharpe ratio (коэффициент Шарпа)** = (Return − Risk-free rate) / Volatility. Excess return per unit of total risk. Above 1 is good, above 2 is excellent.
- **Sortino ratio (коэффициент Сортино)** uses only downside volatility (волатильность вниз), because investors do not mind upward surprises.
- **Treynor ratio (коэффициент Трейнора)** = Excess return / Beta.
- **Information ratio (информационный коэффициент)** = Alpha / Tracking error (ошибка слежения), the volatility of the difference from the benchmark (бенчмарк, эталонный индекс).
- **Maximum drawdown (максимальная просадка)**: the largest fall from a peak to the next low. Investors feel drawdowns, not standard deviations.

## Value at risk

Value at risk, VaR (стоимостная мера риска) answers: "How much can I lose over a given period with a given confidence (доверительный уровень)?" A one-day 99% VaR of 10 million roubles means that on 99 days out of 100 the loss will not exceed 10 million. Banks use VaR for regulatory capital (регуляторный капитал). Its weakness: it says nothing about the worst 1%. Expected shortfall, also called conditional VaR (ожидаемые потери при превышении VaR) measures the average loss in those bad cases. Stress tests (стресс-тесты) simulate specific disasters: oil at 30 dollars, the rouble at 150.

## Asset allocation and rebalancing

Asset allocation (распределение активов) is the split between asset classes (классы активов): equities (акции), bonds, cash, real estate (недвижимость), gold, alternatives (альтернативные инвестиции). Studies show it explains most of a portfolio's long-run result, more than picking individual stocks. A classic rule is 60/40: 60% equities, 40% bonds. Rebalancing (ребалансировка) means periodically selling what grew and buying what fell to return to the target weights; it forces you to sell high and buy low.

The time horizon (горизонт инвестирования) and risk tolerance (терпимость к риску) of the investor decide the allocation: a 25-year-old saving for retirement can hold mostly equities; a pension fund paying benefits next year cannot.

## Behavioural traps

Behavioural finance (поведенческие финансы) shows that people are not rational. Loss aversion (неприятие потерь): a loss hurts about twice as much as an equal gain pleases, so investors hold losers too long. Herding (стадное поведение): buying because everyone buys. Overconfidence (самоуверенность): trading too much. Anchoring (якорение): fixating on the price you paid. Knowing the names helps a little; rules and rebalancing help more.

> **Remember.** Risk = volatility. Diversification removes specific risk, not market risk. Beta = market risk, alpha = skill. Sharpe = return per unit of risk. VaR = loss at a confidence level.

## Words

| Term | Перевод | Example |
|---|---|---|
| volatility | волатильность | Volatility rose sharply during the sell-off. |
| standard deviation | стандартное отклонение | Standard deviation of returns measures risk. |
| expected return | ожидаемая доходность | The expected return on equities is about 10%. |
| diversification | диверсификация | Diversification reduces specific risk. |
| correlation | корреляция | Gold has low correlation with equities. |
| systematic (market) risk | систематический (рыночный) риск | Systematic risk cannot be diversified away. |
| unsystematic (specific) risk | несистематический (специфический) риск | Specific risk disappears in a large portfolio. |
| efficient frontier | граница эффективности | Portfolios on the efficient frontier maximise return for a given risk. |
| market portfolio | рыночный портфель | The index fund approximates the market portfolio. |
| alpha | альфа | The manager delivered 3% of alpha last year. |
| risk-adjusted return | доходность с учётом риска | Compare funds by risk-adjusted return. |
| Sharpe ratio | коэффициент Шарпа | A Sharpe ratio above 1 is considered good. |
| drawdown | просадка | The maximum drawdown was 35% in 2022. |
| benchmark | бенчмарк, эталонный индекс | The fund beat its benchmark by two points. |
| tracking error | ошибка слежения | Index funds aim for minimal tracking error. |
| value at risk (VaR) | стоимостная мера риска | One-day VaR is 2% of the portfolio. |
| stress test | стресс-тест | The stress test assumed oil at 30 dollars. |
| asset allocation | распределение активов | Asset allocation drives long-term results. |
| rebalancing | ребалансировка | Annual rebalancing restores the 60/40 split. |
| risk tolerance | терпимость к риску | Her risk tolerance is low, so she holds bonds. |
| loss aversion | неприятие потерь | Loss aversion makes investors keep losing stocks. |
