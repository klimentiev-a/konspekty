# Topic 13. Derivatives: futures, options and swaps
short: Форварды и фьючерсы, колл и пут, внутренняя и временная стоимость, греки и Блэк-Шоулз простыми словами, процентные свопы и хеджирование
level: C1
unit: 3
minutes: 10

## Theory

## What a derivative is

A derivative (дериватив, производный финансовый инструмент) is a contract whose value depends on the price of something else, the underlying asset (базовый актив): a share, an index, oil, a currency, an interest rate. Derivatives are used for two opposite purposes: hedging (хеджирование), reducing a risk you already have, and speculation (спекуляция), taking a risk to earn a profit. A third use is arbitrage (арбитраж), earning a riskless profit from price differences.

## Forwards and futures

A forward contract (форвард) is an agreement to buy or sell an asset at a fixed price on a future date. An exporter who will receive dollars in three months can sell them forward today at a known rate and remove currency risk (валютный риск). Forwards are over-the-counter, OTC (внебиржевые): private contracts between two parties, with counterparty risk (риск контрагента) that the other side will not pay.

A futures contract (фьючерс) is a standardised forward traded on an exchange (биржа). The exchange's clearing house (клиринговый центр) stands between buyer and seller, so there is no counterparty risk. Instead, both sides post margin (гарантийное обеспечение, маржа) and gains and losses are settled daily: mark-to-market (переоценка по рынку). On the Moscow Exchange the most traded futures are on the dollar-rouble and yuan-rouble rates, the MOEX index, Brent oil and gold. Futures let you control a large position with a small deposit: this is leverage (плечо, рычаг).

The forward price (форвардная цена) of a financial asset is roughly the spot price (спотовая цена, текущая) plus the cost of carry (стоимость удержания позиции): interest minus any income the asset pays. When futures are above spot the market is in contango (контанго); below spot, in backwardation (бэквордация).

## Options: the right, not the obligation

An option (опцион) gives the buyer the right, but not the obligation, to buy or sell the underlying at a fixed price, the strike price (цена исполнения, страйк), before or on the expiry date (дата экспирации). The buyer pays a premium (премия) for this right; the seller, called the writer (продавец опциона), receives the premium and takes on the obligation.

- A **call option (колл-опцион)** is the right to buy. You buy calls if you expect the price to rise.
- A **put option (пут-опцион)** is the right to sell. You buy puts if you expect a fall, or to insure a portfolio.

Example: Sber trades at 300. You buy a call with strike 320 for a premium of 10. If Sber rises to 350, you exercise (исполняете): buy at 320, worth 350, gain 30 minus the 10 premium = 20. If Sber stays below 320, you let the option expire (истечь) and lose only the premium. The buyer's loss is limited to the premium; the seller's loss can be unlimited for a call.

An option is in the money (в деньгах) when exercising it would be profitable, at the money (около денег) when strike equals the price, out of the money (вне денег) otherwise. American options (американские опционы) can be exercised any time before expiry; European options (европейские опционы) only on the expiry date.

## What an option is worth

The premium has two parts. Intrinsic value (внутренняя стоимость) is what you would get by exercising now: for a call, price minus strike if positive. Time value (временная стоимость) is the extra paid for the chance that the price moves further before expiry. Time value melts as expiry approaches: this is time decay (временной распад).

The Black-Scholes model (модель Блэка-Шоулза) prices European options from five inputs: the underlying price, the strike, time to expiry, the risk-free rate, and volatility (волатильность), the expected size of price swings. Volatility is the key: the more the price can move, the more the right to buy or sell is worth. Implied volatility (подразумеваемая волатильность) is the volatility that the market price of the option implies; the VIX index (индекс VIX, «индекс страха») is implied volatility of S&P 500 options.

The Greeks (греки) describe sensitivity: delta (дельта), how much the option price moves per 1 unit of the underlying; gamma (гамма), how fast delta changes; theta (тета), the daily time decay; vega (вега), sensitivity to volatility. Traders hedge their delta (делают дельта-хеджирование) to stay neutral to small price moves.

## Swaps

A swap (своп) is an exchange of cash flows. In an interest rate swap, IRS (процентный своп) one party pays a fixed rate and receives a floating rate (плавающая ставка), the other does the opposite. A company with a floating-rate loan that fears rising rates can swap into fixed. In a currency swap (валютный своп) the parties exchange principal and interest in two currencies. A credit default swap, CDS (кредитный дефолтный своп) is insurance against a borrower's default: the buyer pays an annual spread, the seller pays the loss if default happens. CDS spreads on a country are a quick measure of its perceived risk.

## Hedging in practice

- An airline buys oil futures to fix fuel costs (hedges its input price).
- A gold miner sells gold forward to lock in revenue.
- An exporter sells dollars forward to protect rouble income.
- A fund buys index puts as portfolio insurance (страховка портфеля) before an event.

Hedging costs money or gives up upside (отказ от потенциальной прибыли); the point is certainty, not profit. Companies disclose hedges in their reports, and analysts check whether a "profit" came from the business or from derivatives.

## Risks and famous disasters

Derivatives are dangerous because of leverage: a small move in the underlying is a large move in the position. Losses on derivatives sank Barings Bank in 1995 and contributed to the 2008 crisis through mortgage derivatives and CDS. The lesson for a reader of reports: a company with large derivative positions may have risks that do not appear in revenue or EBITDA.

> **Remember.** Forward/futures = obligation to trade at a fixed price. Option = right, not obligation; the buyer risks only the premium. Call = right to buy, put = right to sell. Swap = exchange of cash flows. Volatility is the price of an option.

## Words

| Term | Перевод | Example |
|---|---|---|
| derivative | дериватив, производный инструмент | Derivatives derive their value from an underlying asset. |
| underlying asset | базовый актив | The underlying asset is Brent crude. |
| hedging | хеджирование | The exporter uses forwards for hedging. |
| forward contract | форвард | They sold dollars three months forward. |
| futures contract | фьючерс | Futures are traded on the exchange with daily settlement. |
| over-the-counter (OTC) | внебиржевой | Forwards are OTC contracts. |
| counterparty risk | риск контрагента | The clearing house removes counterparty risk. |
| margin | гарантийное обеспечение | The broker asked for additional margin. |
| mark-to-market | переоценка по рыночной цене | Futures are marked to market every day. |
| contango / backwardation | контанго / бэквордация | The oil curve moved into backwardation. |
| option | опцион | An option gives a right, not an obligation. |
| call / put | колл / пут | She bought puts to protect her portfolio. |
| strike price | цена исполнения, страйк | The strike price is 320 roubles. |
| expiry (expiration) | экспирация, истечение | The option expires on the third Friday. |
| premium | премия (по опциону) | The option premium is 10 roubles. |
| in / at / out of the money | в деньгах / около денег / вне денег | The call is out of the money. |
| volatility | волатильность | Implied volatility jumped before the earnings release. |
| time decay | временной распад | Time decay works against the option buyer. |
| interest rate swap | процентный своп | The company entered an interest rate swap to fix its cost of debt. |
| credit default swap (CDS) | кредитный дефолтный своп | CDS spreads widened as the crisis deepened. |
