# Полные английские расшифровки сокращений: подставляются в заголовки подсказок (terms.build).
import re

EXP = {
'ABB':'Accelerated Bookbuilding','ABS':'Asset-Backed Security','ADR':'American Depositary Receipt','AFFO':'Adjusted Funds From Operations',
'AISC':'All-In Sustaining Cost','AML':'Anti-Money Laundering','APA':'Asset Purchase Agreement','APR':'Annual Percentage Rate',
'APT':'Arbitrage Pricing Theory','APV':'Adjusted Present Value','ARPU':'Average Revenue Per User','ARR':'Annual Recurring Revenue',
'AUM':'Assets Under Management','BNPL':'Buy Now, Pay Later','BO':'Binding Offer','CAC':'Customer Acquisition Cost',
'CAGR':'Compound Annual Growth Rate','CAPEX':'Capital Expenditures','CAPM':'Capital Asset Pricing Model','CASK':'Cost per Available Seat Kilometre',
'CBDC':'Central Bank Digital Currency','CDO':'Collateralized Debt Obligation','CDS':'Credit Default Swap','CET1':'Common Equity Tier 1',
'CEX':'Centralized Exchange','CFADS':'Cash Flow Available for Debt Service','CFF':'Cash Flow from Financing','CFI':'Cash Flow from Investing',
'CFO':'Cash Flow from Operations','CIM':'Confidential Information Memorandum','CIR':'Cost-to-Income Ratio','CLO':'Collateralized Loan Obligation',
'COGS':'Cost of Goods Sold','CP':'Conditions Precedent','CPI':'Consumer Price Index','CRP':'Country Risk Premium','CVaR':'Conditional Value at Risk',
'CoR':'Cost of Risk','D&A':'Depreciation & Amortization','DAU':'Daily Active Users','DCF':'Discounted Cash Flow','DCM':'Debt Capital Markets',
'DD':'Due Diligence','DDM':'Dividend Discount Model','DEX':'Decentralized Exchange','DIO':'Days Inventory Outstanding','DIP':'Debtor-in-Possession',
'DLOM':'Discount for Lack of Marketability','DPI':'Distributions to Paid-In Capital','DPO':'Days Payable Outstanding','DPS':'Dividends Per Share',
'DSCR':'Debt Service Coverage Ratio','DSO':'Days Sales Outstanding','DSRA':'Debt Service Reserve Account','DTA':'Deferred Tax Asset',
'DTL':'Deferred Tax Liability','DV01':'Dollar Value of a Basis Point','DeFi':'Decentralized Finance','EAD':'Exposure at Default',
'EAR':'Effective Annual Rate','EBIT':'Earnings Before Interest and Taxes','EBITDA':'Earnings Before Interest, Taxes, Depreciation and Amortization',
'EBITDAR':'Earnings Before Interest, Taxes, Depreciation, Amortization and Rent','ECL':'Expected Credit Loss','ECM':'Equity Capital Markets',
'EPC':'Engineering, Procurement, Construction','EPS':'Earnings Per Share','ERM':'Enterprise Risk Management','ERP':'Equity Risk Premium',
'ESG':'Environmental, Social, Governance','ESOP':'Employee Stock Ownership Plan','ETF':'Exchange-Traded Fund','EV':'Enterprise Value',
'EVA':'Economic Value Added','FCF':'Free Cash Flow','FCFE':'Free Cash Flow to Equity','FCFF':'Free Cash Flow to the Firm',
'FDV':'Fully Diluted Valuation','FFO':'Funds From Operations','FIFO':'First In, First Out','FINRA':'Financial Industry Regulatory Authority',
'FRN':'Floating Rate Note','FV':'Future Value','FX':'Foreign Exchange','GDP':'Gross Domestic Product','GDR':'Global Depositary Receipt',
'GLA':'Gross Leasable Area','GMV':'Gross Merchandise Value','GP':'General Partner','HFT':'High-Frequency Trading',
'HKEX':'Hong Kong Exchanges and Clearing','IC':'Investment Committee','ICR':'Interest Coverage Ratio','IFRS':'International Financial Reporting Standards',
'IMOEX':'Moscow Exchange Index','IPO':'Initial Public Offering','IRR':'Internal Rate of Return','IRS':'Interest Rate Swap','KYC':'Know Your Customer',
'LBO':'Leveraged Buyout','LCOE':'Levelized Cost of Energy','LCR':'Liquidity Coverage Ratio','LFL':'Like-for-Like','LGD':'Loss Given Default',
'LIFO':'Last In, First Out','LLCR':'Loan Life Coverage Ratio','LOI':'Letter of Intent','LP':'Limited Partner','LSE':'London Stock Exchange',
'LSEG':'London Stock Exchange Group','LTM':'Last Twelve Months','M&A':'Mergers & Acquisitions','MAC':'Material Adverse Change',
'MACD':'Moving Average Convergence Divergence','MAE':'Material Adverse Effect','MAU':'Monthly Active Users','MBO':'Management Buyout',
'MBS':'Mortgage-Backed Security','MD':'Managing Director','MIRR':'Modified Internal Rate of Return','MOIC':'Multiple on Invested Capital',
'MRR':'Monthly Recurring Revenue','MVA':'Market Value Added','MoM':'Month-over-Month','MoU':'Memorandum of Understanding',
'NASDAQ':'National Association of Securities Dealers Automated Quotations','NAV':'Net Asset Value','NBO':'Non-Binding Offer','NCI':'Non-Controlling Interest',
'NDA':'Non-Disclosure Agreement','NDF':'Non-Deliverable Forward','NFT':'Non-Fungible Token','NIM':'Net Interest Margin','NOI':'Net Operating Income',
'NOPAT':'Net Operating Profit After Tax','NPL':'Non-Performing Loan','NPV':'Net Present Value','NSFR':'Net Stable Funding Ratio','NTM':'Next Twelve Months',
'NWC':'Net Working Capital','NYSE':'New York Stock Exchange','OAS':'Option-Adjusted Spread','OID':'Original Issue Discount','OPEX':'Operating Expenses',
'OTC':'Over-the-Counter','P&L':'Profit & Loss','P2P':'Peer-to-Peer','P':'Price','PD':'Probability of Default','PE':'Private Equity','PEG':'Price/Earnings to Growth',
'PI':'Profitability Index','PIK':'Payment-in-Kind','PMI':"Purchasing Managers' Index",'PP&E':'Property, Plant & Equipment','PPA':'Purchase Price Allocation',
'PV':'Present Value','QE':'Quantitative Easing','QT':'Quantitative Tightening','QoQ':'Quarter-over-Quarter','R&D':'Research & Development',
'RAB':'Regulatory Asset Base','RAROC':'Risk-Adjusted Return on Capital','RASK':'Revenue per Available Seat Kilometre','REIT':'Real Estate Investment Trust',
'RI':'Residual Income','ROA':'Return on Assets','ROCE':'Return on Capital Employed','ROE':'Return on Equity','ROFO':'Right of First Offer',
'ROFR':'Right of First Refusal','ROIC':'Return on Invested Capital','ROTE':'Return on Tangible Equity','RSI':'Relative Strength Index',
'RUONIA':'Ruble Overnight Index Average','RVPI':'Residual Value to Paid-In Capital','RWA':'Risk-Weighted Assets','S&P':"Standard & Poor's",
'SAFE':'Simple Agreement for Future Equity','SAM':'Serviceable Available Market','SEC':'Securities and Exchange Commission',
'SG&A':'Selling, General & Administrative','SGX':'Singapore Exchange','SOFR':'Secured Overnight Financing Rate','SOM':'Serviceable Obtainable Market',
'SOTP':'Sum of the Parts','SOX':'Sarbanes-Oxley Act','SPA':'Share Purchase Agreement','SPAC':'Special Purpose Acquisition Company',
'SPO':'Secondary Public Offering','SPV':'Special Purpose Vehicle','TAM':'Total Addressable Market','TLA':'Term Loan A','TLB':'Term Loan B',
'TSR':'Total Shareholder Return','TTM':'Trailing Twelve Months','TV':'Terminal Value','TVL':'Total Value Locked','TVPI':'Total Value to Paid-In Capital',
'VDR':'Virtual Data Room','VIX':'CBOE Volatility Index','VP':'Vice President','VaR':'Value at Risk','WACC':'Weighted Average Cost of Capital',
'WC':'Working Capital','WTI':'West Texas Intermediate','XIRR':'Extended Internal Rate of Return',
'XNPV':'Extended Net Present Value','YTM':'Yield to Maturity','YoY':'Year-over-Year','Sales':'Sales',
}

_W = re.compile(r'[A-Za-zА-Яа-я]{4,}')
def _present(exp, title):
    words = [w.lower() for w in _W.findall(exp)]
    tl = title.lower()
    return bool(words) and all(w[:5] in tl for w in words)

_CH = re.compile(r"(?<![A-Za-z0-9&])[A-Za-z][A-Za-z0-9&]*(?:/[A-Za-z][A-Za-z0-9&]*)*(?![A-Za-z0-9&])")

def enrich(title, overrides={}):
    if title in overrides: return overrides[title]
    done = set(); out = []; pos = 0
    for m in _CH.finditer(title):
        s = m.group(0); parts = s.split('/')
        if not all(p in EXP for p in parts) or any(p in done for p in parts):
            continue
        exps = [EXP[p] for p in parts]
        if all(_present(e, title) for e in exps):
            done.update(parts); continue
        e = ' / '.join(exps) if len(parts) > 1 else exps[0]
        before = title[:m.start()]; after = title[m.end():]
        if before.endswith('(') and after.startswith(')'):
            rep = s + ' — ' + e
        else:
            rep = s + ' (' + e + ')'
        out.append((m.start(), m.end(), rep)); done.update(parts)
    res = title
    for a, b, rep in reversed(out):
        res = res[:a] + rep + res[b:]
    return res
