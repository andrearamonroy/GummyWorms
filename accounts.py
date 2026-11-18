"""Google sign-in and saved flashcard sets.

Plug it into app.py with two lines:

    from accounts import init_accounts
    init_accounts(app)
"""
import os
import re
import secrets
from datetime import datetime, timedelta, timezone
from functools import wraps

from authlib.integrations.base_client import OAuthError
from authlib.integrations.flask_client import OAuth
from flask import Blueprint, current_app, jsonify, redirect, request, session, url_for
from flask_sqlalchemy import SQLAlchemy
from werkzeug.middleware.proxy_fix import ProxyFix

db = SQLAlchemy()
oauth = OAuth()
bp = Blueprint("accounts", __name__)

MAX_SETS = 100
MAX_CARDS = 2000
ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,40}$")


def utcnow():
    return datetime.now(timezone.utc)


# ---------------------------------------------------------------- database

class User(db.Model):
    __tablename__ = "users"
    id = db.Column(db.Integer, primary_key=True)
    google_sub = db.Column(db.String(64), unique=True, nullable=False)   # Google's permanent id for the person
    email = db.Column(db.String(255))
    name = db.Column(db.String(255))
    created_at = db.Column(db.DateTime, default=utcnow)
    sets = db.relationship("CardSet", backref="owner", cascade="all, delete-orphan")
    progress = db.relationship("LessonProgress", cascade="all, delete-orphan")


class CardSet(db.Model):
    __tablename__ = "card_sets"
    pk = db.Column(db.Integer, primary_key=True)
    cid = db.Column(db.String(40), nullable=False)       # the id the browser uses
    user_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False, index=True)
    name = db.Column(db.String(40), nullable=False)
    created_at = db.Column(db.DateTime, default=utcnow)
    cards = db.relationship("Card", backref="set", cascade="all, delete-orphan", order_by="Card.position")
    __table_args__ = (db.UniqueConstraint("user_id", "cid"),)


class Card(db.Model):
    __tablename__ = "cards"
    pk = db.Column(db.Integer, primary_key=True)
    cid = db.Column(db.String(40), nullable=False)
    set_pk = db.Column(db.Integer, db.ForeignKey("card_sets.pk"), nullable=False, index=True)
    key = db.Column(db.String(400), nullable=False)      # used to skip duplicates inside a set
    position = db.Column(db.Integer, nullable=False, default=0)
    data = db.Column(db.JSON, nullable=False)            # {"kind": "word", "fr": ..., "en": ...} or a rule
    __table_args__ = (db.UniqueConstraint("set_pk", "cid"), db.UniqueConstraint("set_pk", "key"))


class LessonProgress(db.Model):
    __tablename__ = "lesson_progress"
    pk = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False, index=True)
    lesson_id = db.Column(db.String(60), nullable=False)
    stars = db.Column(db.Integer, nullable=False, default=0)     # best result: 1, 2 or 3 stars
    best = db.Column(db.Integer, nullable=False, default=0)      # most answers right
    total = db.Column(db.Integer, nullable=False, default=0)     # out of this many
    at = db.Column(db.BigInteger, nullable=False, default=0)     # when (milliseconds since 1970)
    __table_args__ = (db.UniqueConstraint("user_id", "lesson_id"),)


# ---------------------------------------------------------------- helpers

def clean(value, limit):
    return str(value or "").strip()[:limit]


def valid_id(value):
    return value if isinstance(value, str) and ID_RE.match(value) else None


def new_id():
    return secrets.token_urlsafe(8)


def normalize_card(raw):
    """Returns (data, key) for a good card, or None. Mirrors normalize() in sets.js."""
    if not isinstance(raw, dict):
        return None
    if raw.get("kind") == "rule":
        title, text = clean(raw.get("title"), 120), clean(raw.get("text"), 600)
        if not title or not text:
            return None
        examples = []
        for e in (raw.get("examples") or [])[:12]:
            if isinstance(e, dict) and clean(e.get("fr"), 120):
                examples.append({"fr": clean(e.get("fr"), 120), "en": clean(e.get("en"), 120),
                                 "formula": clean(e.get("formula"), 200)})
        return ({"kind": "rule", "title": title, "text": text, "examples": examples},
                ("rule|" + title.lower())[:400])
    fr, en = clean(raw.get("fr"), 120), clean(raw.get("en"), 120)
    if not fr or not en:
        return None
    return ({"kind": "word", "fr": fr, "en": en, "note": clean(raw.get("note"), 200)},
            ("word|%s|%s" % (fr.lower(), en.lower()))[:400])


def card_json(card):
    return {"id": card.cid, **card.data}


def set_json(card_set):
    return {"id": card_set.cid, "name": card_set.name, "cards": [card_json(c) for c in card_set.cards]}


def user_sets(user):
    return CardSet.query.filter_by(user_id=user.id).order_by(CardSet.pk).all()


def find_set(user, cid):
    return CardSet.query.filter_by(user_id=user.id, cid=cid).first()


def find_set_by_name(user, name):
    return CardSet.query.filter(CardSet.user_id == user.id,
                                db.func.lower(CardSet.name) == name.lower()).first()


def add_cards(card_set, raw_cards):
    """Adds new cards, skipping duplicates. Returns how many were added."""
    have_keys = {c.key for c in card_set.cards}
    have_ids = {c.cid for c in card_set.cards}
    position = max([c.position for c in card_set.cards], default=-1) + 1
    added = 0
    for raw in raw_cards:
        parsed = normalize_card(raw)
        if not parsed:
            continue
        data, key = parsed
        if key in have_keys:
            continue
        if len(card_set.cards) >= MAX_CARDS:
            break
        cid = valid_id(raw.get("id"))
        if not cid or cid in have_ids:
            cid = new_id()
        card_set.cards.append(Card(cid=cid, key=key, position=position, data=data))
        have_keys.add(key)
        have_ids.add(cid)
        position += 1
        added += 1
    return added


def merge_sets(user, incoming):
    """Adds everything in `incoming` to the user's sets. Never deletes anything."""
    existing = {s.cid: s for s in user_sets(user)}
    by_name = {s.name.lower(): s for s in existing.values()}
    for raw in incoming[:MAX_SETS]:
        if not isinstance(raw, dict):
            continue
        name = clean(raw.get("name"), 40)
        if not name:
            continue
        cid = valid_id(raw.get("id"))
        target = existing.get(cid) if cid else None
        if target is None:
            target = by_name.get(name.lower())
        if target is None:
            if len(existing) >= MAX_SETS:
                continue
            target = CardSet(user_id=user.id, cid=cid or new_id(), name=name)
            db.session.add(target)
            existing[target.cid] = target
            by_name[name.lower()] = target
        cards = raw.get("cards")
        add_cards(target, cards if isinstance(cards, list) else [])
    db.session.commit()


LESSON_ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,60}$")
MAX_LESSONS = 300


def clean_progress(raw):
    """Returns (stars, best, total, at) for a sane result, or None."""
    if not isinstance(raw, dict):
        return None
    try:
        stars, best, total = int(raw.get("stars")), int(raw.get("best")), int(raw.get("total"))
        at = int(raw.get("at") or 0)
    except (TypeError, ValueError):
        return None
    if not (1 <= stars <= 3 and 1 <= total <= 1000 and 0 <= best <= total and 0 <= at < 10 ** 14):
        return None
    return stars, best, total, at


def progress_map(user):
    rows = LessonProgress.query.filter_by(user_id=user.id).all()
    return {p.lesson_id: {"stars": p.stars, "best": p.best, "total": p.total, "at": p.at} for p in rows}


# ---------------------------------------------------------------- who is signed in

def current_user():
    uid = session.get("uid")
    return db.session.get(User, uid) if uid else None


def api_login_required(view):
    @wraps(view)
    def wrapper(*args, **kwargs):
        user = current_user()
        if user is None:
            return jsonify(error="Please sign in."), 401
        return view(user, *args, **kwargs)
    return wrapper


def safe_next(path):
    return isinstance(path, str) and path.startswith("/") and not path.startswith("//") and "\\" not in path


# ---------------------------------------------------------------- routes

@bp.before_request
def block_cross_site_writes():
    # Browsers won't let another website add this header to a request, so this blocks forged writes.
    if request.method in ("POST", "PUT", "PATCH", "DELETE") and request.headers.get("X-Requested-With") != "fetch":
        return jsonify(error="Missing header."), 403


@bp.after_request
def no_store(response):
    if request.path.startswith("/api/"):
        response.headers["Cache-Control"] = "no-store"
    return response


@bp.get("/login")
def login():
    if not (current_app.config.get("GOOGLE_CLIENT_ID") and current_app.config.get("GOOGLE_CLIENT_SECRET")):
        return ("Google sign-in isn't set up yet. Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to your .env file.", 503)
    nxt = request.args.get("next", "/")
    session["next"] = nxt if safe_next(nxt) else "/"
    return oauth.google.authorize_redirect(url_for("accounts.callback", _external=True))


@bp.get("/auth/callback")
def callback():
    nxt = session.get("next", "/")
    nxt = nxt if safe_next(nxt) else "/"
    try:
        token = oauth.google.authorize_access_token()
        info = token.get("userinfo") or {}
        sub = info.get("sub")
        if not sub:
            raise OAuthError(error="no_sub")
    except OAuthError:
        session.pop("next", None)
        return redirect(nxt + ("&" if "?" in nxt else "?") + "signin=failed")

    user = User.query.filter_by(google_sub=sub).first()
    if user is None:
        user = User(google_sub=sub)
        db.session.add(user)
    user.email = clean(info.get("email"), 255) or None
    user.name = clean(info.get("name"), 255) or (user.email or "").split("@")[0] or "Learner"
    db.session.commit()

    session.clear()                 # start a fresh session for the signed-in person
    session["uid"] = user.id
    session.permanent = True
    return redirect(nxt)


@bp.post("/logout")
def logout():
    session.clear()
    return jsonify(ok=True)


@bp.get("/api/me")
def api_me():
    user = current_user()
    if user is None:
        return jsonify(signedIn=False)
    return jsonify(signedIn=True, id=user.id, name=user.name, email=user.email)


@bp.delete("/api/me")
@api_login_required
def api_delete_me(user):
    db.session.delete(user)         # also deletes their sets and cards
    db.session.commit()
    session.clear()
    return jsonify(ok=True)


@bp.get("/api/sets")
@api_login_required
def api_get_sets(user):
    return jsonify(sets=[set_json(s) for s in user_sets(user)])


@bp.post("/api/sets/merge")
@api_login_required
def api_merge(user):
    body = request.get_json(silent=True)
    incoming = body.get("sets") if isinstance(body, dict) else None
    if not isinstance(incoming, list):
        return jsonify(error="Expected a list of sets."), 400
    merge_sets(user, incoming)
    return jsonify(sets=[set_json(s) for s in user_sets(user)])


@bp.post("/api/sets")
@api_login_required
def api_create_set(user):
    body = request.get_json(silent=True)
    name = clean(body.get("name"), 40) if isinstance(body, dict) else ""
    if not name:
        return jsonify(error="A set needs a name."), 400
    card_set = find_set_by_name(user, name)
    if card_set is None:
        if CardSet.query.filter_by(user_id=user.id).count() >= MAX_SETS:
            return jsonify(error="Too many sets."), 400
        cid = valid_id(body.get("id"))
        if not cid or find_set(user, cid):
            cid = new_id()
        card_set = CardSet(user_id=user.id, cid=cid, name=name)
        db.session.add(card_set)
        db.session.commit()
    return jsonify(set=set_json(card_set))


@bp.delete("/api/sets/<cid>")
@api_login_required
def api_delete_set(user, cid):
    card_set = find_set(user, cid)
    if card_set:
        db.session.delete(card_set)
        db.session.commit()
    return jsonify(ok=True)


@bp.post("/api/sets/<cid>/cards")
@api_login_required
def api_add_cards(user, cid):
    card_set = find_set(user, cid)
    if card_set is None:
        return jsonify(error="No such set."), 404
    body = request.get_json(silent=True)
    cards = body.get("cards") if isinstance(body, dict) else None
    if not isinstance(cards, list) or len(cards) > 500:
        return jsonify(error="Expected a list of cards."), 400
    added = add_cards(card_set, cards)
    db.session.commit()
    return jsonify(added=added)


@bp.delete("/api/sets/<cid>/cards/<card_cid>")
@api_login_required
def api_delete_card(user, cid, card_cid):
    card_set = find_set(user, cid)
    if card_set:
        Card.query.filter_by(set_pk=card_set.pk, cid=card_cid).delete()
        db.session.commit()
    return jsonify(ok=True)


@bp.get("/api/progress")
@api_login_required
def api_get_progress(user):
    return jsonify(lessons=progress_map(user))


@bp.post("/api/progress/merge")
@api_login_required
def api_merge_progress(user):
    """Adds results; for each lesson the better one wins, so a worse attempt never lowers your stars."""
    body = request.get_json(silent=True)
    incoming = body.get("lessons") if isinstance(body, dict) else None
    if not isinstance(incoming, dict) or len(incoming) > MAX_LESSONS:
        return jsonify(error="Expected a list of lessons."), 400
    rows = {p.lesson_id: p for p in LessonProgress.query.filter_by(user_id=user.id)}
    for lesson_id, raw in incoming.items():
        if not isinstance(lesson_id, str) or not LESSON_ID_RE.match(lesson_id):
            continue
        clean = clean_progress(raw)
        if clean is None:
            continue
        stars, best, total, at = clean
        row = rows.get(lesson_id)
        if row is None:
            if len(rows) >= MAX_LESSONS:
                continue
            row = LessonProgress(user_id=user.id, lesson_id=lesson_id, stars=stars, best=best, total=total, at=at)
            db.session.add(row)
            rows[lesson_id] = row
        else:
            if (stars, best / total) > (row.stars, row.best / max(row.total, 1)):
                row.stars, row.best, row.total = stars, best, total
            row.at = max(row.at, at)
    db.session.commit()
    return jsonify(lessons=progress_map(user))


# ---------------------------------------------------------------- setup

def init_accounts(app):
    try:
        from dotenv import load_dotenv
        load_dotenv()
    except ImportError:
        pass

    secret = os.environ.get("SECRET_KEY")
    if not secret:
        secret = secrets.token_hex(32)
        print("WARNING: SECRET_KEY is not set. Using a temporary one, so everyone is signed out on every restart.")

    db_url = os.environ.get("DATABASE_URL", "sqlite:///app.db")
    if db_url.startswith("postgres://"):            # some hosts still hand out the old spelling
        db_url = db_url.replace("postgres://", "postgresql://", 1)

    app.config.update(
        SECRET_KEY=secret,
        SQLALCHEMY_DATABASE_URI=db_url,
        SESSION_COOKIE_HTTPONLY=True,
        SESSION_COOKIE_SAMESITE="Lax",
        SESSION_COOKIE_SECURE=os.environ.get("COOKIE_SECURE") == "1",
        PERMANENT_SESSION_LIFETIME=timedelta(days=30),
        MAX_CONTENT_LENGTH=2 * 1024 * 1024,
        GOOGLE_CLIENT_ID=os.environ.get("GOOGLE_CLIENT_ID"),
        GOOGLE_CLIENT_SECRET=os.environ.get("GOOGLE_CLIENT_SECRET"),
    )
    if os.environ.get("BEHIND_PROXY") == "1":       # hosts like Render or Railway sit behind a proxy
        app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1)

    db.init_app(app)
    oauth.init_app(app)
    oauth.register(
        name="google",
        client_id=app.config["GOOGLE_CLIENT_ID"],
        client_secret=app.config["GOOGLE_CLIENT_SECRET"],
        server_metadata_url="https://accounts.google.com/.well-known/openid-configuration",
        client_kwargs={"scope": "openid email profile"},
    )
    app.register_blueprint(bp)
    with app.app_context():
        db.create_all()