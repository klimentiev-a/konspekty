# -*- coding: utf-8 -*-
"""Справочник бумаг для раздела «Рынки».
RU: сектор и понятное имя для акций Мосбиржи (сами списки и цены — все бумаги режима TQBR, их отдаёт ISS).
WORLD: акции мира для Yahoo Finance: тикер Yahoo, имя, страна (ISO2), сектор, валюта.
Нет данных о компании здесь — страница всё равно покажет её (имя из ISS/Yahoo, сектор «Прочее»)."""

# тикер: (имя, сектор)
RU = {
 'SBER':('Сбербанк','Финансы'),'SBERP':('Сбербанк ап','Финансы'),'VTBR':('ВТБ','Финансы'),'T':('Т-Технологии','Финансы'),'MOEX':('Мосбиржа','Финансы'),
 'SVCB':('Совкомбанк','Финансы'),'BSPB':('Банк Санкт-Петербург','Финансы'),'MBNK':('МТС Банк','Финансы'),'CBOM':('МКБ','Финансы'),'SFIN':('ЭсЭфАй','Финансы'),
 'RENI':('Ренессанс Страхование','Финансы'),'LEAS':('Европлан','Финансы'),'ZAYM':('Займер','Финансы'),'CARM':('КарМани','Финансы'),'AFKS':('АФК Система','Финансы'),
 'SPBE':('СПБ Биржа','Финансы'),'DOMRF':('ДОМ.РФ','Финансы'),'RBCM':('РБК','Телеком'),
 'LKOH':('Лукойл','Нефтегаз'),'ROSN':('Роснефть','Нефтегаз'),'NVTK':('Новатэк','Нефтегаз'),'SIBN':('Газпром нефть','Нефтегаз'),'GAZP':('Газпром','Нефтегаз'),
 'TATN':('Татнефть','Нефтегаз'),'TATNP':('Татнефть ап','Нефтегаз'),'SNGS':('Сургутнефтегаз','Нефтегаз'),'SNGSP':('Сургутнефтегаз ап','Нефтегаз'),
 'TRNFP':('Транснефть ап','Нефтегаз'),'BANE':('Башнефть','Нефтегаз'),'BANEP':('Башнефть ап','Нефтегаз'),'RNFT':('РуссНефть','Нефтегаз'),'EUTR':('ЕвроТранс','Нефтегаз'),
 'GMKN':('Норникель','Металлы'),'PLZL':('Полюс','Металлы'),'CHMF':('Северсталь','Металлы'),'NLMK':('НЛМК','Металлы'),'MAGN':('ММК','Металлы'),'RUAL':('Русал','Металлы'),
 'ALRS':('Алроса','Металлы'),'MTLR':('Мечел','Металлы'),'MTLRP':('Мечел ап','Металлы'),'RASP':('Распадская','Металлы'),'UGLD':('ЮГК','Металлы'),'SELG':('Селигдар','Металлы'),
 'ENPG':('Эн+','Металлы'),'VSMO':('ВСМПО-Ависма','Металлы'),'TRMK':('ТМК','Металлы'),'ELMT':('Элемент','IT'),
 'PHOR':('ФосАгро','Химия'),'AKRN':('Акрон','Химия'),'KAZT':('КуйбышевАзот','Химия'),'NKNC':('Нижнекамскнефтехим','Химия'),'NKNCP':('Нижнекамскнефтехим ап','Химия'),
 'KZOS':('Казаньоргсинтез','Химия'),'YDEX':('Яндекс','IT'),'OZON':('Ozon','IT'),'HEAD':('Хэдхантер','IT'),'POSI':('Positive Technologies','IT'),'VKCO':('VK','IT'),
 'ASTR':('Астра','IT'),'DIAS':('Диасофт','IT'),'SOFL':('Софтлайн','IT'),'IVAT':('IVA Technologies','IT'),'DATA':('Аренадата','IT'),'CNRU':('Циан','IT'),
 'WUSH':('Whoosh','IT'),'DELI':('Делимобиль','Транспорт'),'QIWI':('QIWI','Финансы'),'VSEH':('ВИ.ру','Ритейл'),'PRMD':('Промомед','Здравоохранение'),
 'OZPH':('Озон Фармацевтика','Здравоохранение'),'LIFE':('Фармсинтез','Здравоохранение'),'GECO':('Генетико','Здравоохранение'),'MDMG':('Мать и дитя','Здравоохранение'),
 'ABIO':('Артген','Здравоохранение'),'APTK':('Аптеки 36,6','Здравоохранение'),
 'X5':('X5','Ритейл'),'MGNT':('Магнит','Ритейл'),'LENT':('Лента','Ритейл'),'FIXP':('Fix Price','Ритейл'),'OKEY':('О’Кей','Ритейл'),'BELU':('Novabev (Белуга)','Ритейл'),
 'ABRD':('Абрау-Дюрсо','Ритейл'),'HNFG':('Henderson','Ритейл'),'MVID':('М.Видео','Ритейл'),'DSKY':('Детский мир','Ритейл'),'EUTR_':('',''),
 'MTSS':('МТС','Телеком'),'RTKM':('Ростелеком','Телеком'),'RTKMP':('Ростелеком ап','Телеком'),'MGTSP':('МГТС ап','Телеком'),'TTLK':('Таттелеком','Телеком'),
 'IRAO':('Интер РАО','Энергетика'),'HYDR':('РусГидро','Энергетика'),'FEES':('Россети','Энергетика'),'UPRO':('Юнипро','Энергетика'),'MSNG':('Мосэнерго','Энергетика'),
 'OGKB':('ОГК-2','Энергетика'),'TGKA':('ТГК-1','Энергетика'),'TGKB':('ТГК-2','Энергетика'),'LSNG':('Россети Ленэнерго','Энергетика'),'LSNGP':('Россети Ленэнерго ап','Энергетика'),
 'MRKC':('Россети Центр','Энергетика'),'MRKP':('Россети Центр и Приволжье','Энергетика'),'MRKU':('Россети Урал','Энергетика'),'MRKV':('Россети Волга','Энергетика'),
 'MRKZ':('Россети Северо-Запад','Энергетика'),'MRKS':('Россети Сибирь','Энергетика'),'MRKY':('Россети Юг','Энергетика'),'MSRS':('Россети Московский регион','Энергетика'),
 'ELFV':('ЭЛ5-Энерго','Энергетика'),'DVEC':('ДЭК','Энергетика'),'KRKNP':('Саратовский НПЗ ап','Нефтегаз'),
 'AFLT':('Аэрофлот','Транспорт'),'FLOT':('Совкомфлот','Транспорт'),'NMTP':('НМТП','Транспорт'),'FESH':('ДВМП (FESCO)','Транспорт'),'GTRK':('ГТМ','Транспорт'),
 'KMAZ':('КАМАЗ','Промышленность'),'SVAV':('Соллерс','Промышленность'),'UWGN':('ОВК','Промышленность'),'UNAC':('ОАК','Промышленность'),'IRKT':('Яковлев (Иркут)','Промышленность'),
 'MSTT':('Мостотрест','Промышленность'),'SGZH':('Сегежа','Промышленность'),
 'PIKK':('ПИК','Недвижимость'),'SMLT':('Самолёт','Недвижимость'),'LSRG':('ЛСР','Недвижимость'),'ETLN':('Эталон','Недвижимость'),
 'AQUA':('Инарктика','Агро'),'RAGR':('Русагро','Агро'),'GCHE':('Черкизово','Агро'),'NKHP':('НКХП','Агро'),
 'CIAN':('Циан','IT'),'ZAYM_':('',''),'SOFL_':('',''),'PRMB':('Приморье банк','Финансы'),'ROLO':('Русолово','Металлы'),'AMEZ':('Ашинский метзавод','Металлы'),
 'LNZL':('Лензолото','Металлы'),'MGKL':('Мосгорломбард','Финансы'),'ELMT_':('',''),'NAUK':('НПО Наука','Промышленность'),'KLVZ':('Кристалл','Ритейл'),
 'VEON-RX':('VEON','Телеком'),'CHMK':('ЧМК','Металлы'),'URKZ':('Уральская кузница','Металлы'),'VRSB':('ТНС энерго Воронеж','Энергетика'),
}
RU = {k: v for k, v in RU.items() if v[0]}

# [тикер Yahoo, имя, страна, сектор]
WORLD = [
 # США — технологии и полупроводники
 ['NVDA','Nvidia','US','Полупроводники'],['AAPL','Apple','US','Техника'],['MSFT','Microsoft','US','Софт'],['GOOGL','Alphabet','US','Интернет'],['AMZN','Amazon','US','Интернет'],
 ['META','Meta','US','Интернет'],['AVGO','Broadcom','US','Полупроводники'],['TSLA','Tesla','US','Авто'],['ORCL','Oracle','US','Софт'],['AMD','AMD','US','Полупроводники'],
 ['NFLX','Netflix','US','Медиа'],['CRM','Salesforce','US','Софт'],['ADBE','Adobe','US','Софт'],['CSCO','Cisco','US','Телеком-оборудование'],['INTC','Intel','US','Полупроводники'],
 ['QCOM','Qualcomm','US','Полупроводники'],['TXN','Texas Instruments','US','Полупроводники'],['MU','Micron','US','Полупроводники'],['AMAT','Applied Materials','US','Полупроводники'],
 ['LRCX','Lam Research','US','Полупроводники'],['KLAC','KLA','US','Полупроводники'],['ARM','Arm','GB','Полупроводники'],['NOW','ServiceNow','US','Софт'],['INTU','Intuit','US','Софт'],
 ['IBM','IBM','US','IT-услуги'],['ACN','Accenture','IE','IT-услуги'],['PLTR','Palantir','US','Софт'],['UBER','Uber','US','Интернет'],['ABNB','Airbnb','US','Интернет'],
 ['SHOP','Shopify','CA','Интернет'],['SNOW','Snowflake','US','Софт'],['PANW','Palo Alto Networks','US','Кибербезопасность'],['CRWD','CrowdStrike','US','Кибербезопасность'],
 ['ANET','Arista Networks','US','Телеком-оборудование'],['DELL','Dell','US','Техника'],['SMCI','Super Micro','US','Техника'],['MRVL','Marvell','US','Полупроводники'],
 ['ADI','Analog Devices','US','Полупроводники'],['COIN','Coinbase','US','Крипто'],['MSTR','Strategy (MicroStrategy)','US','Крипто'],['SPOT','Spotify','SE','Медиа'],
 ['DIS','Disney','US','Медиа'],['CMCSA','Comcast','US','Медиа'],['T','AT&T','US','Телеком'],['VZ','Verizon','US','Телеком'],['TMUS','T-Mobile US','US','Телеком'],
 # США — финансы
 ['BRK-B','Berkshire Hathaway','US','Финансы'],['JPM','JPMorgan Chase','US','Банки'],['V','Visa','US','Платежи'],['MA','Mastercard','US','Платежи'],['BAC','Bank of America','US','Банки'],
 ['WFC','Wells Fargo','US','Банки'],['GS','Goldman Sachs','US','Инвестбанки'],['MS','Morgan Stanley','US','Инвестбанки'],['C','Citigroup','US','Банки'],['AXP','American Express','US','Платежи'],
 ['BLK','BlackRock','US','Управление активами'],['SCHW','Charles Schwab','US','Брокеры'],['PYPL','PayPal','US','Платежи'],['SPGI','S&P Global','US','Финансовые данные'],
 ['MCO','Moody’s','US','Финансовые данные'],['ICE','Intercontinental Exchange','US','Биржи'],['CME','CME Group','US','Биржи'],['BX','Blackstone','US','Private equity'],
 ['KKR','KKR','US','Private equity'],['APO','Apollo','US','Private equity'],['PGR','Progressive','US','Страхование'],['CB','Chubb','US','Страхование'],['MET','MetLife','US','Страхование'],
 # США — здравоохранение
 ['LLY','Eli Lilly','US','Фарма'],['JNJ','Johnson & Johnson','US','Фарма'],['UNH','UnitedHealth','US','Медстрахование'],['ABBV','AbbVie','US','Фарма'],['MRK','Merck','US','Фарма'],
 ['PFE','Pfizer','US','Фарма'],['TMO','Thermo Fisher','US','Медоборудование'],['ABT','Abbott','US','Медоборудование'],['AMGN','Amgen','US','Биотех'],['ISRG','Intuitive Surgical','US','Медоборудование'],
 ['DHR','Danaher','US','Медоборудование'],['GILD','Gilead','US','Биотех'],['VRTX','Vertex','US','Биотех'],['BMY','Bristol-Myers Squibb','US','Фарма'],['CVS','CVS Health','US','Аптеки'],
 ['MDT','Medtronic','IE','Медоборудование'],['REGN','Regeneron','US','Биотех'],['BSX','Boston Scientific','US','Медоборудование'],['CI','Cigna','US','Медстрахование'],
 # США — потребительский сектор
 ['WMT','Walmart','US','Ритейл'],['COST','Costco','US','Ритейл'],['PG','Procter & Gamble','US','Потребтовары'],['KO','Coca-Cola','US','Напитки'],['PEP','PepsiCo','US','Напитки'],
 ['MCD','McDonald’s','US','Рестораны'],['SBUX','Starbucks','US','Рестораны'],['NKE','Nike','US','Одежда'],['HD','Home Depot','US','Ритейл'],['LOW','Lowe’s','US','Ритейл'],
 ['TGT','Target','US','Ритейл'],['PM','Philip Morris','US','Табак'],['MO','Altria','US','Табак'],['CL','Colgate-Palmolive','US','Потребтовары'],['MDLZ','Mondelez','US','Еда'],
 ['BKNG','Booking','US','Туризм'],['MAR','Marriott','US','Отели'],['CMG','Chipotle','US','Рестораны'],['LULU','Lululemon','US','Одежда'],['EL','Estée Lauder','US','Косметика'],
 ['F','Ford','US','Авто'],['GM','General Motors','US','Авто'],['RIVN','Rivian','US','Авто'],
 # США — промышленность, энергетика, сырьё
 ['XOM','Exxon Mobil','US','Нефтегаз'],['CVX','Chevron','US','Нефтегаз'],['COP','ConocoPhillips','US','Нефтегаз'],['SLB','Schlumberger','US','Нефтесервис'],['EOG','EOG Resources','US','Нефтегаз'],
 ['OXY','Occidental','US','Нефтегаз'],['GE','GE Aerospace','US','Авиапром'],['CAT','Caterpillar','US','Машиностроение'],['RTX','RTX','US','Оборонка'],['LMT','Lockheed Martin','US','Оборонка'],
 ['BA','Boeing','US','Авиапром'],['HON','Honeywell','US','Промышленность'],['DE','Deere','US','Машиностроение'],['UNP','Union Pacific','US','Ж/д'],['UPS','UPS','US','Логистика'],
 ['FDX','FedEx','US','Логистика'],['NOC','Northrop Grumman','US','Оборонка'],['GD','General Dynamics','US','Оборонка'],['ETN','Eaton','IE','Электрооборудование'],['DAL','Delta Air Lines','US','Авиакомпании'],
 ['LIN','Linde','IE','Химия'],['FCX','Freeport-McMoRan','US','Металлы'],['NEM','Newmont','US','Золото'],['NUE','Nucor','US','Металлы'],['DOW','Dow','US','Химия'],
 ['NEE','NextEra Energy','US','Электроэнергетика'],['DUK','Duke Energy','US','Электроэнергетика'],['SO','Southern Company','US','Электроэнергетика'],['CEG','Constellation Energy','US','Электроэнергетика'],
 ['VST','Vistra','US','Электроэнергетика'],['AMT','American Tower','US','Недвижимость'],['PLD','Prologis','US','Недвижимость'],['EQIX','Equinix','US','Дата-центры'],
 # Европа
 ['ASML.AS','ASML','NL','Полупроводники'],['MC.PA','LVMH','FR','Люкс'],['RMS.PA','Hermès','FR','Люкс'],['OR.PA','L’Oréal','FR','Косметика'],['TTE.PA','TotalEnergies','FR','Нефтегаз'],
 ['SAN.PA','Sanofi','FR','Фарма'],['AIR.PA','Airbus','FR','Авиапром'],['BNP.PA','BNP Paribas','FR','Банки'],['SU.PA','Schneider Electric','FR','Электрооборудование'],['AI.PA','Air Liquide','FR','Химия'],
 ['SAP.DE','SAP','DE','Софт'],['SIE.DE','Siemens','DE','Промышленность'],['ALV.DE','Allianz','DE','Страхование'],['DTE.DE','Deutsche Telekom','DE','Телеком'],['MBG.DE','Mercedes-Benz','DE','Авто'],
 ['BMW.DE','BMW','DE','Авто'],['VOW3.DE','Volkswagen','DE','Авто'],['BAS.DE','BASF','DE','Химия'],['DBK.DE','Deutsche Bank','DE','Банки'],['RHM.DE','Rheinmetall','DE','Оборонка'],
 ['ADS.DE','Adidas','DE','Одежда'],['MUV2.DE','Munich Re','DE','Страхование'],['IFX.DE','Infineon','DE','Полупроводники'],['BAYN.DE','Bayer','DE','Фарма'],
 ['NESN.SW','Nestlé','CH','Еда'],['NOVN.SW','Novartis','CH','Фарма'],['ROG.SW','Roche','CH','Фарма'],['UBSG.SW','UBS','CH','Банки'],['ZURN.SW','Zurich Insurance','CH','Страхование'],
 ['ABBN.SW','ABB','CH','Электрооборудование'],['CFR.SW','Richemont','CH','Люкс'],['GLEN.L','Glencore','CH','Сырьё'],
 ['SHEL.L','Shell','GB','Нефтегаз'],['BP.L','BP','GB','Нефтегаз'],['AZN.L','AstraZeneca','GB','Фарма'],['HSBA.L','HSBC','GB','Банки'],['ULVR.L','Unilever','GB','Потребтовары'],
 ['RIO.L','Rio Tinto','GB','Металлы'],['BATS.L','British American Tobacco','GB','Табак'],['DGE.L','Diageo','GB','Напитки'],['GSK.L','GSK','GB','Фарма'],['LSEG.L','London Stock Exchange Group','GB','Биржи'],
 ['BARC.L','Barclays','GB','Банки'],['LLOY.L','Lloyds','GB','Банки'],['REL.L','RELX','GB','Данные'],['BA.L','BAE Systems','GB','Оборонка'],['RR.L','Rolls-Royce','GB','Авиапром'],['VOD.L','Vodafone','GB','Телеком'],
 ['NOVO-B.CO','Novo Nordisk','DK','Фарма'],['MAERSK-B.CO','Maersk','DK','Логистика'],['DSV.CO','DSV','DK','Логистика'],['ORSTED.CO','Ørsted','DK','Электроэнергетика'],
 ['EQNR.OL','Equinor','NO','Нефтегаз'],['VOLV-B.ST','Volvo','SE','Машиностроение'],['ERIC-B.ST','Ericsson','SE','Телеком-оборудование'],['INVE-B.ST','Investor AB','SE','Холдинг'],['NOKIA.HE','Nokia','FI','Телеком-оборудование'],
 ['ITX.MC','Inditex','ES','Одежда'],['SAN.MC','Santander','ES','Банки'],['IBE.MC','Iberdrola','ES','Электроэнергетика'],['BBVA.MC','BBVA','ES','Банки'],['TEF.MC','Telefónica','ES','Телеком'],
 ['ENI.MI','Eni','IT','Нефтегаз'],['ISP.MI','Intesa Sanpaolo','IT','Банки'],['UCG.MI','UniCredit','IT','Банки'],['ENEL.MI','Enel','IT','Электроэнергетика'],['RACE.MI','Ferrari','IT','Авто'],['STLAM.MI','Stellantis','NL','Авто'],
 ['PRX.AS','Prosus','NL','Интернет'],['ADYEN.AS','Adyen','NL','Платежи'],['INGA.AS','ING','NL','Банки'],['HEIA.AS','Heineken','NL','Напитки'],['PHIA.AS','Philips','NL','Медоборудование'],['AD.AS','Ahold Delhaize','NL','Ритейл'],
 ['ABI.BR','AB InBev','BE','Напитки'],['KBC.BR','KBC','BE','Банки'],['OMV.VI','OMV','AT','Нефтегаз'],['PKN.WA','Orlen','PL','Нефтегаз'],['PKO.WA','PKO BP','PL','Банки'],['KGH.WA','KGHM','PL','Металлы'],
 ['THYAO.IS','Türk Hava Yolları','TR','Авиакомпании'],['BIMAS.IS','BİM','TR','Ритейл'],['KCHOL.IS','Koç Holding','TR','Холдинг'],
 # Азия
 ['TSM','TSMC','TW','Полупроводники'],['2330.TW','TSMC (Тайвань)','TW','Полупроводники'],['2317.TW','Hon Hai (Foxconn)','TW','Электроника'],['005930.KS','Samsung Electronics','KR','Электроника'],
 ['000660.KS','SK Hynix','KR','Полупроводники'],['005380.KS','Hyundai Motor','KR','Авто'],['373220.KS','LG Energy Solution','KR','Аккумуляторы'],['035420.KS','Naver','KR','Интернет'],
 ['7203.T','Toyota','JP','Авто'],['6758.T','Sony','JP','Электроника'],['9984.T','SoftBank Group','JP','Холдинг'],['8306.T','MUFG','JP','Банки'],['6861.T','Keyence','JP','Электроника'],
 ['9983.T','Fast Retailing (Uniqlo)','JP','Одежда'],['8035.T','Tokyo Electron','JP','Полупроводники'],['7974.T','Nintendo','JP','Игры'],['6501.T','Hitachi','JP','Промышленность'],['4063.T','Shin-Etsu','JP','Химия'],
 ['7267.T','Honda','JP','Авто'],['8058.T','Mitsubishi Corp','JP','Торговые дома'],['6098.T','Recruit','JP','Интернет'],['4519.T','Chugai','JP','Фарма'],['8316.T','SMFG','JP','Банки'],
 ['0700.HK','Tencent','CN','Интернет'],['9988.HK','Alibaba (HK)','CN','Интернет'],['BABA','Alibaba','CN','Интернет'],['PDD','PDD (Temu)','CN','Интернет'],['JD','JD.com','CN','Интернет'],
 ['BIDU','Baidu','CN','Интернет'],['3690.HK','Meituan','CN','Интернет'],['1810.HK','Xiaomi','CN','Электроника'],['1211.HK','BYD','CN','Авто'],['NIO','NIO','CN','Авто'],['LI','Li Auto','CN','Авто'],
 ['XPEV','XPeng','CN','Авто'],['0939.HK','China Construction Bank','CN','Банки'],['1398.HK','ICBC','CN','Банки'],['0941.HK','China Mobile','CN','Телеком'],['0883.HK','CNOOC','CN','Нефтегаз'],
 ['0857.HK','PetroChina','CN','Нефтегаз'],['2318.HK','Ping An','CN','Страхование'],['0005.HK','HSBC (HK)','GB','Банки'],['NTES','NetEase','CN','Игры'],['TCOM','Trip.com','CN','Туризм'],
 ['600519.SS','Kweichow Moutai','CN','Напитки'],['300750.SZ','CATL','CN','Аккумуляторы'],['601318.SS','Ping An (Шанхай)','CN','Страхование'],['600036.SS','China Merchants Bank','CN','Банки'],
 ['RELIANCE.NS','Reliance Industries','IN','Конгломерат'],['TCS.NS','Tata Consultancy','IN','IT-услуги'],['HDFCBANK.NS','HDFC Bank','IN','Банки'],['INFY','Infosys','IN','IT-услуги'],
 ['ICICIBANK.NS','ICICI Bank','IN','Банки'],['BHARTIARTL.NS','Bharti Airtel','IN','Телеком'],['SBIN.NS','State Bank of India','IN','Банки'],['ITC.NS','ITC','IN','Потребтовары'],
 ['HINDUNILVR.NS','Hindustan Unilever','IN','Потребтовары'],['LT.NS','Larsen & Toubro','IN','Строительство'],['TATAMOTORS.NS','Tata Motors','IN','Авто'],['ADANIENT.NS','Adani Enterprises','IN','Конгломерат'],
 ['SE','Sea Ltd','SG','Интернет'],['GRAB','Grab','SG','Интернет'],['D05.SI','DBS','SG','Банки'],['BBCA.JK','Bank Central Asia','ID','Банки'],['2222.SR','Saudi Aramco','SA','Нефтегаз'],
 ['1120.SR','Al Rajhi Bank','SA','Банки'],['2010.SR','SABIC','SA','Химия'],['QNBK.QA','QNB','QA','Банки'],['FAB.AE','First Abu Dhabi Bank','AE','Банки'],['IHC.AE','IHC','AE','Холдинг'],
 ['EMAAR.AE','Emaar','AE','Недвижимость'],['TEVA','Teva','IL','Фарма'],['CHKP','Check Point','IL','Кибербезопасность'],['NICE','NICE','IL','Софт'],
 # Америки (кроме США), Австралия, Африка
 ['RY','Royal Bank of Canada','CA','Банки'],['TD','TD Bank','CA','Банки'],['CNQ','Canadian Natural','CA','Нефтегаз'],['ENB','Enbridge','CA','Нефтегаз'],['CP','CPKC','CA','Ж/д'],['BN','Brookfield','CA','Управление активами'],
 ['CNR','Canadian National Railway','CA','Ж/д'],['SU','Suncor','CA','Нефтегаз'],['NTR','Nutrien','CA','Химия'],['CCO.TO','Cameco','CA','Уран'],['BMO','Bank of Montreal','CA','Банки'],
 ['VALE','Vale','BR','Металлы'],['PBR','Petrobras','BR','Нефтегаз'],['ITUB','Itaú Unibanco','BR','Банки'],['NU','Nu Holdings','BR','Финтех'],['MELI','MercadoLibre','AR','Интернет'],['ABEV','Ambev','BR','Напитки'],
 ['AMX','América Movil','MX','Телеком'],['WALMEX.MX','Walmart de México','MX','Ритейл'],['FMX','FEMSA','MX','Ритейл'],['GGB','Gerdau','BR','Металлы'],['BBD','Bradesco','BR','Банки'],
 ['BHP','BHP','AU','Металлы'],['RIO','Rio Tinto (ADR)','GB','Металлы'],['CBA.AX','Commonwealth Bank','AU','Банки'],['CSL.AX','CSL','AU','Биотех'],['WDS.AX','Woodside','AU','Нефтегаз'],
 ['FMG.AX','Fortescue','AU','Металлы'],['WES.AX','Wesfarmers','AU','Ритейл'],['NAB.AX','NAB','AU','Банки'],['NPN.JO','Naspers','ZA','Интернет'],['FSR.JO','FirstRand','ZA','Банки'],['AGL.JO','Anglo American','GB','Металлы'],
]
WORLD = [w for w in WORLD]
REGION = {'US':'США','CA':'Америки','BR':'Америки','MX':'Америки','AR':'Америки','GB':'Европа','DE':'Европа','FR':'Европа','NL':'Европа','CH':'Европа','IE':'Европа','SE':'Европа','DK':'Европа','NO':'Европа','FI':'Европа','ES':'Европа','IT':'Европа','BE':'Европа','AT':'Европа','PL':'Европа','TR':'Европа',
          'CN':'Азия','TW':'Азия','KR':'Азия','JP':'Азия','IN':'Азия','SG':'Азия','ID':'Азия','SA':'Ближний Восток','QA':'Ближний Восток','AE':'Ближний Восток','IL':'Ближний Восток','AU':'Австралия','ZA':'Африка'}
COUNTRY = {'US':'США','CA':'Канада','BR':'Бразилия','MX':'Мексика','AR':'Аргентина','GB':'Великобритания','DE':'Германия','FR':'Франция','NL':'Нидерланды','CH':'Швейцария','IE':'Ирландия','SE':'Швеция','DK':'Дания','NO':'Норвегия','FI':'Финляндия','ES':'Испания','IT':'Италия','BE':'Бельгия','AT':'Австрия','PL':'Польша','TR':'Турция',
           'CN':'Китай','TW':'Тайвань','KR':'Южная Корея','JP':'Япония','IN':'Индия','SG':'Сингапур','ID':'Индонезия','SA':'Саудовская Аравия','QA':'Катар','AE':'ОАЭ','IL':'Израиль','AU':'Австралия','ZA':'ЮАР'}
# валюта торгов по суффиксу Yahoo
def currency(t):
    s = t.rsplit('.', 1)[1] if '.' in t else ''
    return {'AS':'€','PA':'€','DE':'€','MC':'€','MI':'€','BR':'€','VI':'€','HE':'€','SW':'CHF','L':'£','CO':'DKK','OL':'NOK','ST':'SEK','WA':'zł','IS':'₺','TW':'TWD','KS':'₩','T':'¥','HK':'HK$','SS':'CN¥','SZ':'CN¥','NS':'₹','SI':'S$','JK':'Rp','SR':'SAR','QA':'QAR','AE':'AED','TO':'C$','MX':'MX$','AX':'A$','JO':'ZAR'}.get(s, '$')
# акции Лондона котируются в пенсах
PENCE = {'L'}

def world_json():
    return [[t, n, c, s, currency(t)] for t, n, c, s in WORLD]
