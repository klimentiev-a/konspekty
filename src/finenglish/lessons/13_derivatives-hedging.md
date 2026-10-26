# Topic 13. Derivatives and hedging
short: Форвардная цена через cost of carry, фьючерсы и маржа, выплаты по опционам, паритет пут-колл, входы Блэка-Шоулза и греки, свопы, хеджирование экспортёра
level: C1
unit: 3
minutes: 8

## Theory

> **In one minute.** Forwards and futures fix a price; options buy a right for a premium; swaps exchange cash flows. The forward price is spot plus cost of carry (стоимость удержания); an option's value is intrinsic (внутренняя) plus time value (временная), driven by volatility (волатильность). Companies hedge (хеджируют) inputs, outputs, FX (валютный курс) and rates; analysts check hedge accounting (учёт хеджирования) and derivative exposure in the notes.

## Forwards and futures

```f
Forward price:  F = S × (1 + r)^T  (financial asset)
                F = S × e^((r − q)T)  with yield q;  F = S × (1 + r − y + storage) for commodities
FX forward:     F = S × (1 + r_RUB)/(1 + r_USD)   — covered interest parity (покрытый паритет ставок)
Contango: F > S;  Backwardation: F < S
```

S is the spot price (спотовая цена), r the interest rate, T the time to maturity, q the income yield of the asset (e.g. dividend yield), y the convenience yield (выгода от владения товаром).

Futures: exchange-traded, standardised, cleared through a CCP, central counterparty (центральный контрагент), daily mark-to-market (переоценка), initial and variation margin (начальная и вариационная маржа). MOEX (Мосбиржа) futures: Si (USD/RUB), CNY/RUB, RTS index (индекс РТС), Brent, gold, single stocks. Basis (базис) = futures − spot; basis risk (базисный риск) is what remains after a hedge.

## Options

```f
Call payoff = max(S − K, 0);  Put payoff = max(K − S, 0)   (K = strike)
Put-call parity: C − P = S − K × e^(−rT)
Premium = Intrinsic value + Time value
Black-Scholes inputs: S, K, T, r, σ (volatility), q
```

Moneyness: in / at / out of the money (в деньгах / около денег / вне денег). European (исполнение только в дату) vs American (в любой день). Greeks: delta (Δ, sensitivity to S; also hedge ratio), gamma (Γ, change of delta), theta (Θ, time decay, временной распад), vega (ν, sensitivity to σ), rho (ρ, to rates). Implied volatility (подразумеваемая волатильность) is backed out of market prices; the volatility smile/skew (улыбка / перекос волатильности) shows puts priced richer than calls. RVI (Russian Volatility Index) is the MOEX volatility index.

Strategies in a sentence: covered call (покрытый колл: long stock + short call for income), protective put (защитный пут), collar (коллар: put financed by selling a call), straddle (стрэддл: bet on volatility), spread (спред: limit cost and payoff).

## Swaps

Interest rate swap, IRS (процентный своп): pay fixed, receive floating (RUONIA / key rate) or the reverse; converts a floating loan into fixed. Cross-currency swap (валютно-процентный своп): exchange principal and interest in two currencies; used to turn yuan or dollar funding into roubles. CDS (кредитный дефолтный своп): protection buyer pays a spread, receives par minus recovery (стоимость возмещения) on default; the CDS spread is a market view on PD, the probability of default (вероятность дефолта). Total return swap (своп на совокупный доход) replicates ownership without holding the asset.

## Corporate hedging

| Exposure | Instrument | Example |
|---|---|---|
| Export revenue in USD | Sell USD forward / buy USD put | Oil company fixes rouble revenue |
| Input cost | Buy futures / call | Airline locks jet fuel |
| Floating-rate debt | Pay-fixed IRS / cap (кэп, потолок ставки) | Developer fixes cost of debt |
| Output price | Sell forward / put, collar | Gold miner sets a floor |
| Translation of foreign subsidiary | Net investment hedge | Holding with foreign assets |

Natural hedge (естественный хедж): match the currency of debt with the currency of revenue. Hedge ratio (коэффициент хеджирования) is usually 30–70% of expected volumes 12–24 months out. Hedge accounting (учёт хеджирования, IFRS 9) lets gains and losses on the hedge sit in OCI, other comprehensive income (прочий совокупный доход), until the hedged item hits the P&L (ОФР); without it, derivatives create P&L volatility (волатильность прибыли). Mark-to-market of hedges can produce large "paper" losses when prices rally: read the notes before judging a quarter.

## Risks the reader should flag

Leverage (плечо) in derivatives; margin calls (требования о довнесении маржи) draining liquidity; counterparty risk (риск контрагента) on OTC, over-the-counter (внебиржевых), contracts with sanctioned or foreign banks; embedded derivatives (встроенные деривативы) in contracts (price formulas with caps and floors); speculative positions disguised as hedges (Barings, Metallgesellschaft, the CDOs of 2008 — collateralised debt obligations, обеспеченные долговые обязательства).

## Words

| Term | Перевод | Example |
|---|---|---|
| cost of carry | стоимость удержания позиции | The forward price equals spot plus cost of carry. |
| covered interest parity | покрытый паритет процентных ставок | FX forwards follow covered interest parity. |
| mark-to-market | переоценка по рынку | Futures are marked to market daily. |
| initial / variation margin | начальная / вариационная маржа | Variation margin was called after the move. |
| basis risk | базисный риск | Basis risk remains after a futures hedge. |
| strike | цена исполнения | The strike is 90 roubles per dollar. |
| payoff | выплата (по опциону) | The call payoff is zero below the strike. |
| put-call parity | паритет пут-колл | Put-call parity links call and put prices. |
| intrinsic / time value | внутренняя / временная стоимость | Time value decays as expiry nears. |
| implied volatility | подразумеваемая волатильность | Implied volatility spiked before the decision. |
| volatility skew | перекос волатильности | The skew shows demand for downside protection. |
| delta hedge | дельта-хеджирование | The desk delta-hedges its option book. |
| covered call / protective put | покрытый колл / защитный пут | A protective put caps the loss. |
| collar | коллар | The miner used a zero-cost collar. |
| interest rate swap (IRS) | процентный своп | The IRS converts floating debt to fixed. |
| cross-currency swap | валютно-процентный своп | A cross-currency swap turned yuan funding into roubles. |
| recovery rate | уровень возмещения при дефолте | CDS pays par minus the recovery rate. |
| cap / floor | потолок / пол (ставки или цены) | The cap limits interest at 18%. |
| natural hedge | естественный хедж | Dollar debt against dollar revenue is a natural hedge. |
| hedge ratio | коэффициент хеджирования | The hedge ratio is 50% of next year's output. |
| hedge accounting | учёт хеджирования | Hedge accounting keeps the swap's fair value in OCI. |
| embedded derivative | встроенный дериватив | The contract contains an embedded derivative. |
