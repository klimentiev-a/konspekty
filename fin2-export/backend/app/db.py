"""SQLAlchemy models and session. Multi-client model: client -> portfolios -> positions."""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import (
    Boolean, Column, DateTime, Float, ForeignKey, Integer, String, Text, create_engine,
)
from sqlalchemy.orm import declarative_base, relationship, sessionmaker

from .config import DB_URL

connect_args = {"check_same_thread": False, "timeout": 30} if DB_URL.startswith("sqlite") else {}
engine = create_engine(DB_URL, connect_args=connect_args, future=True)

if DB_URL.startswith("sqlite"):
    from sqlalchemy import event

    @event.listens_for(engine, "connect")
    def _sqlite_pragmas(dbapi_conn, _rec):  # noqa: ANN001
        # WAL: чтение не блокируется записью (обновление рынка идёт параллельно с запросами
        # пользователей); busy_timeout — ждать блокировку, а не падать «database is locked»
        cur = dbapi_conn.cursor()
        cur.execute("PRAGMA journal_mode=WAL")
        cur.execute("PRAGMA busy_timeout=30000")
        cur.execute("PRAGMA synchronous=NORMAL")
        cur.close()
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False, future=True)
Base = declarative_base()


# --------------------------------------------------------------------------- #
# Client model (MVP shows one portfolio, but the schema is multi-client ready)
# --------------------------------------------------------------------------- #
class Client(Base):
    __tablename__ = "clients"
    id = Column(Integer, primary_key=True)
    name = Column(String, nullable=False)
    role = Column(String, default="client")  # client | analyst
    is_active = Column(Boolean, default=False)   # the client currently selected in the UI
    portfolios = relationship("Portfolio", back_populates="client", cascade="all, delete-orphan")


class Portfolio(Base):
    __tablename__ = "portfolios"
    id = Column(Integer, primary_key=True)
    client_id = Column(Integer, ForeignKey("clients.id"))
    name = Column(String, nullable=False)
    currency = Column(String, default="RUB")
    source_file = Column(String)
    deposited_cash = Column(Float)          # средства, внесённые инвестором
    created_at = Column(DateTime, default=datetime.utcnow)
    client = relationship("Client", back_populates="portfolios")
    positions = relationship("Position", back_populates="portfolio", cascade="all, delete-orphan")


class Position(Base):
    __tablename__ = "positions"
    id = Column(Integer, primary_key=True)
    portfolio_id = Column(Integer, ForeignKey("portfolios.id"))
    isin = Column(String, index=True)
    name = Column(String)
    quantity = Column(Float)              # number of bonds
    buy_price = Column(Float)             # % of face, from Excel
    buy_accint = Column(Float)            # НКД at purchase, if present
    buy_date = Column(String)
    sell_date = Column(String)             # if (partly) sold — realized P&L
    sell_price = Column(Float)             # clean sale price, % of face
    sell_quantity = Column(Float)          # bonds sold (rest stays open)
    sector = Column(String)
    rating = Column(String)
    currency = Column(String, default="RUB")
    excel_price = Column(Float)           # current price as stated in Excel (for compare)
    resolved = Column(Boolean, default=False)  # matched to a MOEX security?
    note = Column(Text)
    portfolio = relationship("Portfolio", back_populates="positions")


# --------------------------------------------------------------------------- #
# MOEX cache tables
# --------------------------------------------------------------------------- #
class MoexSecurity(Base):
    __tablename__ = "moex_securities"
    isin = Column(String, primary_key=True)
    secid = Column(String)
    board = Column(String)
    shortname = Column(String)
    name = Column(String)
    type = Column(String)
    currency = Column(String)
    facevalue = Column(Float)
    faceunit = Column(String)
    matdate = Column(String)
    couponvalue = Column(Float)
    couponpercent = Column(Float)
    couponperiod = Column(Float)
    nextcoupon = Column(String)
    is_traded = Column(Boolean, default=True)
    updated_at = Column(DateTime, default=datetime.utcnow)


class MoexQuote(Base):
    __tablename__ = "moex_quotes_current"
    isin = Column(String, primary_key=True)
    secid = Column(String)
    board = Column(String)
    last = Column(Float)
    marketprice = Column(Float)
    lcloseprice = Column(Float)
    waprice = Column(Float)
    accint = Column(Float)
    bid = Column(Float)
    offer = Column(Float)
    ytm = Column(Float)
    duration = Column(Float)             # days, as MOEX returns
    volume = Column(Float)
    numtrades = Column(Float)
    updatetime = Column(String)
    updated_at = Column(DateTime, default=datetime.utcnow)


class BondCashflow(Base):
    """Separate source of truth for coupons / amortizations / puts.

    MOEX does NOT reliably cover the full forward schedule, so this table is fed
    by manual import / NRD / Cbonds later. The analytics engine uses it for the
    cashflow calendar and as an input to accurate YTM when available.
    """
    __tablename__ = "bond_cashflows"
    id = Column(Integer, primary_key=True)
    isin = Column(String, index=True)
    payment_date = Column(String)
    payment_type = Column(String)        # coupon | amortization | maturity | put
    coupon_value = Column(Float)
    amortization_value = Column(Float)
    nominal_after = Column(Float)
    currency = Column(String, default="RUB")
    source = Column(String, default="manual")


# --------------------------------------------------------------------------- #
# Market universe cache — the screener/market-map read from HERE, not from ISS.
# Refreshed in bulk (one board request covers the whole board), so a screen over
# hundreds of bonds costs ~2 HTTP calls, not N×3.
# --------------------------------------------------------------------------- #
class BondSnapshot(Base):
    __tablename__ = "bond_snapshot"
    isin = Column(String, primary_key=True)
    secid = Column(String, index=True)
    board = Column(String, index=True)
    shortname = Column(String)
    issuer_full = Column(String)               # MOEX emitent_title / full name (for rating match)
    kind = Column(String, index=True)          # fixed | floater | discount | linker | unknown
    type_label = Column(String)
    matdate = Column(String)
    years_to_maturity = Column(Float)
    facevalue = Column(Float)
    settledate = Column(String)                 # quote's official settlement date, not wall-clock T+1
    faceunit = Column(String)
    couponpercent = Column(Float)              # current coupon rate, %
    couponvalue = Column(Float)
    couponfrequency = Column(Float)
    price = Column(Float)                       # clean, % of face — chosen by hierarchy
    price_type = Column(String)                 # LAST | MID | BID | WAPRICE — provenance of `price`
    price_stale = Column(Boolean)               # True if no trade today (LAST not fresh)
    bid = Column(Float)
    offer = Column(Float)
    accint = Column(Float)
    ytm = Column(Float)
    duration_days = Column(Float)
    duration_years = Column(Float)
    g_spread_bp = Column(Float)                 # to КБД at duration
    spread_ofz_bp = Column(Float)              # to nearest OFZ-PD by duration
    simple_margin_bp = Column(Float)           # floaters: Fabozzi simple margin
    gspread_pctl = Column(Float)               # перцентиль текущего G-спреда по своей истории (0..100)
    sm_pctl = Column(Float)                     # перцентиль текущего simple margin по своей истории
    spread_pctl_at = Column(DateTime)          # когда посчитан перцентиль
    base_rate = Column(Float)                   # floaters: reference rate used
    float_qm = Column(Float)                    # floaters: quoted margin (MOEX benchmark spread, cached)
    current_yield = Column(Float)
    volume = Column(Float)                      # today's turnover, RUB
    avg_volume = Column(Float)                  # средний дневной оборот за ~21 торг. сессию, RUB
    vol_hist = Column(Text)                     # JSON {"YYYY-MM-DD": оборот}, последние ~40 сессий
    numtrades = Column(Float)
    change_day_pct = Column(Float)              # today's price move vs prev, %
    issuesize = Column(Float)                   # total issue size (bonds)
    issuesize_placed = Column(Float)            # amount actually placed → primary-market progress
    emitent_id = Column(String, index=True)     # MOEX stable issuer id — canonical key to group all of an issuer's issues
    emitent_inn = Column(String, index=True)    # ИНН эмитента (MOEX ISS emitent_inn) — ключ сопоставления рейтингов
    emitent_title = Column(String)              # полное юр. название эмитента (MOEX emitent_title)
    buyback_date = Column(String)               # дата ближайшей оферты/выкупа (put/call) из MOEX BUYBACKDATE
    dm_ofz_bp = Column(Float)                    # флоатеры: DM к ОФЗ = SM − (КБД(T) − база) на сроке до оферты/погашения
    updated_at = Column(DateTime, default=datetime.utcnow, index=True)


class BondRating(Base):
    """Справочник выпуска: эмитент, отрасль, признак и параметры флоатера, оферта, дата
    размещения. Собирается moex_ref.rebuild() только из данных Мосбиржи и ФНС (ОКВЭД)."""
    __tablename__ = "bond_ratings"
    isin = Column(String, primary_key=True)
    issuer = Column(String, index=True)
    sector = Column(String, index=True)
    rating = Column(String)                     # raw rating string, e.g. "A+(RU)"
    rating_bucket = Column(String, index=True)  # normalized: AAA/AA/A/BBB/BB/B/CCC/D/NR
    rating_score = Column(Float)                # numeric for sorting (higher = safer)
    agency = Column(String)
    is_floater = Column(Boolean, default=False) # биржа: индекс купона (COUPON_BENCHMARK) или вид облигации
    float_index = Column(String)                # the reference index, if a floater
    float_add = Column(Float)                   # quoted margin over the index (frnIndexAdd), %
    current_coupon = Column(Float)              # текущий купон, % (снимок биржи)
    effective_date = Column(String)             # put/call (offer) date if < maturity
    event_flag = Column(String)                 # PUT — оферта из графика биржи
    issue_date = Column(String)                 # placement date (for the primary-market tab)
    source = Column(String, default="moex")
    updated_at = Column(DateTime, default=datetime.utcnow)


class AgencyRating(Base):
    """Agency-specific credit ratings (АКРА / Эксперт РА / НКР), scraped from the
    agencies' own sites and matched to bond issuers by normalized name. Multiple
    agencies per issuer, so keyed by (issuer_norm, agency)."""
    __tablename__ = "agency_ratings"
    id = Column(Integer, primary_key=True)
    issuer_norm = Column(String, index=True)    # normalized issuer name (match key)
    issuer_raw = Column(String)                 # as published by the agency
    agency = Column(String, index=True)         # ACRA | EXPERT_RA | NKR
    rating = Column(String)                     # e.g. "A(RU)", "ruA+"
    rating_bucket = Column(String, index=True)
    rating_score = Column(Float)
    forecast = Column(String)                   # Стабильный / Позитивный / Негативный
    scale = Column(String)
    action = Column(String)                     # latest rating action (e.g. подтверждён)
    action_date = Column(String)                # date of the action / last update (ISO, если удалось разобрать)
    updated_at = Column(DateTime, default=datetime.utcnow)
    # идентификация без названий: id эмитента в агентстве, ISIN выпуска (для рейтингов выпусков),
    # тип рейтинга (issuer | issue | sf), ожидаемый (EXP), и привязка к эмитенту MOEX / ИНН
    agency_issuer_id = Column(String, index=True)
    isin = Column(String, index=True)
    rating_type = Column(String, default="issuer")
    expected = Column(Boolean, default=False)
    eid = Column(String, index=True)            # MOEX emitent_id (через пробел, если рейтинг покрывает нескольких: SPV + гарант)
    inn = Column(String, index=True)
    seniority = Column(String)                  # для выпусков: «Старший необеспеченный долг» / «Субординированный» …
    trend = Column(String)                      # up | down | None — направление последнего изменения рейтинга
    prev_rating = Column(String)                # предыдущий рейтинг (до последнего изменения)


class AgencyRatingHistory(Base):
    """История рейтинговых действий: строка добавляется, когда у (агентство, субъект) меняется
    рейтинг / прогноз или рейтинг отзывается — старое значение не перетирается."""
    __tablename__ = "agency_rating_history"
    id = Column(Integer, primary_key=True)
    agency = Column(String, index=True)
    subject = Column(String, index=True)        # eid:N | isin:XXX | name:норм.имя
    issuer_raw = Column(String)
    isin = Column(String, index=True)
    rating = Column(String)
    rating_score = Column(Float)
    forecast = Column(String)
    action = Column(String)                     # Присвоен / Подтверждён / Повышен / Понижен / Отозван
    action_date = Column(String)
    seen_at = Column(DateTime, default=datetime.utcnow, index=True)


class PageVisit(Base):
    __tablename__ = "page_visit"
    id = Column(Integer, primary_key=True)
    ts = Column(DateTime, default=datetime.utcnow, index=True)
    ip = Column(String)


def init_db() -> None:
    Base.metadata.create_all(engine)
    _ensure_columns()


def _ensure_columns() -> None:
    """Лёгкая миграция: добавить недостающие колонки в существующую SQLite-БД."""
    from sqlalchemy import text
    wanted = {
        BondSnapshot.__tablename__: [
            ("gspread_pctl", "FLOAT"), ("sm_pctl", "FLOAT"), ("spread_pctl_at", "DATETIME"),
            ("emitent_id", "VARCHAR"), ("buyback_date", "VARCHAR"), ("dm_ofz_bp", "FLOAT"),
            ("avg_volume", "FLOAT"), ("vol_hist", "TEXT"), ("emitent_inn", "VARCHAR"),
            ("emitent_title", "VARCHAR"), ("settledate", "VARCHAR"),
        ],
        "agency_ratings": [
            ("agency_issuer_id", "VARCHAR"), ("isin", "VARCHAR"), ("rating_type", "VARCHAR"),
            ("expected", "BOOLEAN"), ("eid", "VARCHAR"), ("inn", "VARCHAR"),
            ("seniority", "VARCHAR"), ("trend", "VARCHAR"), ("prev_rating", "VARCHAR"),
        ],
    }
    with engine.begin() as conn:
        for tbl, cols in wanted.items():
            try:
                have = {r[1] for r in conn.execute(text(f"PRAGMA table_info({tbl})"))}
            except Exception:
                continue
            for name, typ in cols:
                if name not in have:
                    try:
                        conn.execute(text(f"ALTER TABLE {tbl} ADD COLUMN {name} {typ}"))
                    except Exception:
                        pass
