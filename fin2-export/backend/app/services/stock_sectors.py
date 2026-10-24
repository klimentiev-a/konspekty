"""StockAI business-sector overrides, independent of index eligibility.

Reviewed against the 260 TQBR issue identities on 2026-10-20. These are our
classifications, not a claim that the securities belong to a MOEX sector index.
Both share classes are listed explicitly; no unsafe ticker-suffix guessing.
Unreviewed future listings remain unclassified until reviewed.
"""
REVIEWED_AT = '2026-10-20'
GROUPS = {
    'Нефть и газ': 'SIBN BANE BANEP VJGZ VJGZP MFGS MFGSP YAKG RNFT JNOS JNOSP KRKN KRKNP CHGZ RTGZ EUTR',
    'Металлы и добыча': 'EVRZ UKUZ AMEZ URKZ ROLO CHMK BLNG BRZL KOGK IGST IGSTP MGNZ UNKL',
    'Финансы': 'RGSS LEAS AVAN USBN ZAYM RUSI PRMB RDRB MGKL CARM ARSA KUZB BSPB BSPBP',
    'Холдинги': 'GAZT GAZS GAZC AFKS',
    'Строительство и недвижимость': 'PIKK KFBA APRI WTCM WTCMP ZILL MSTT LSRG ETLN SMLT GLRX',
    'Транспорт': 'UTAR DELI GTRK WUSH',
    'Информационные технологии': 'ELMT IVAT',
    'Телекоммуникации': 'VEON-RX MGTS MGTSP TTLK NSVZ RBCM CNTL CNTLP BISVP',
    'Химия и нефтехимия': 'KZOS KZOSP NKNC NKNCP KAZT KAZTP HIMCP NKSH VLHZ',
    'Потребительский сектор': 'GCHE ABRD KROT KROTP HNFG MVID KLVZ ROST SVET SVETP',
    'Медицина и фармацевтика': 'MDMG GEMC PRMD OZPH APTK ABIO GEMA GECO DIOD LIFE',
    'Лес и упаковка': 'SGZH LMBZ',
    'Промышленность': 'UNAC IRKT UWGN KMAZ VSYD VSYDP OMZZP RKKE PAZA SVAV CHKZ GAZA GAZAP INCB NAUK EELT KMEZ ZVEZ PRFN NFAZ LVHK KRKOP TUZA DZRD DZRDP',
    'Электроэнергетика': 'LSNG LSNGP MRKY MRKS TNSE MRKK DVEC KCHE KCHEP RTSB RTSBP PMSB PMSBP KBSB VRSB VRSBP KRSB KRSBP YRSB YRSBP NNSB NNSBP SAGO SAGOP SLEN LPSB RZSB TGKB TGKBP MISB MISBP TGKN VGSB VGSBP KGKC KGKCP SARE SAREP YKEN YKENP STSB STSBP TORS TORSP TASB TASBP ASSB KLSB MRSB MAGE MAGEP',
}

# Evidence for non-obvious business identities and material corrections. Other
# identities are retained from the dated MOEX issuer/security record, with our
# business classification labelled explicitly in the API and UI.
SOURCES = {
    'SIBN': ('https://www.gazprom.ru/about/strategy/oil-business/', 'Газпром нефть — нефтяной бизнес группы Газпром'),
    'GAZT': ('https://www.gaz-tek.ru/fin/AZ_GT_2022g.pdf', 'Капиталовложения в ценные бумаги, не нефтедобыча'),
    'GAZS': ('https://gaz-services.ru/fin/2023/MSFO_GS2022.pdf', 'Инвестиционная компания; не путать с одноимёнными газовыми операторами'),
    'GAZC': ('https://www.gazcon.ru/fin.html', 'Инвестиционные активы; финансовая отчётность эмитента'),
    'PRFN': ('https://teplant.ru/about/', 'ТЕПЛАНТ восток, бывший ЧЗПСН-Профнастил: строительные материалы'),
    'CARM': ('https://smarttechgroup.pro/about', 'СТГ — материнская компания финтех-сервиса CarMoney'),
    'NAUK': ('https://npo-nauka.ru/press-centre/news/2893/', 'Разработчик авиационной техники'),
    'LMBZ': ('https://investors.lambumiz.ru/', 'Производство упаковки'),
    'ZILL': ('https://amo-zil.ru/history', 'Реструктуризация промплощадки, недвижимость; не действующий массовый автопроизводитель'),
}

OVERRIDES = {}
for sector, tickers in GROUPS.items():
    for ticker in tickers.split():
        if ticker in OVERRIDES:
            raise ValueError('Duplicate equity sector: ' + ticker)
        OVERRIDES[ticker] = sector


def classify(ticker, membership):
    if ticker in OVERRIDES:
        source, note = SOURCES.get(ticker, (
            f'https://www.moex.com/ru/stocks/{ticker.lower()}',
            'StockAI: классификация по профилю бизнеса; идентичность выпуска — MOEX',
        ))
        return {
            'sector': OVERRIDES[ticker], 'sector_method': 'StockAI',
            'sector_source_url': source, 'sector_note': note, 'sector_reviewed_at': REVIEWED_AT,
        }
    if membership:
        return {'sector': membership['sector'], 'sector_method': 'MOEX index',
                'sector_source_url': f"https://www.moex.com/ru/index/{membership['sector_index']}",
                'sector_note': 'По составу отраслевого индекса MOEX', 'sector_reviewed_at': REVIEWED_AT}
    return {'sector': 'Без классификации', 'sector_method': 'unreviewed',
            'sector_source_url': None, 'sector_note': 'Нужна проверка профиля бизнеса',
            'sector_reviewed_at': None}
