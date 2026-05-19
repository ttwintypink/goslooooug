# ============================================================================
#  database.py — Асинхронный слой работы с SQLite (aiosqlite).
#  Все обращения к БД из bot.py и FastAPI идут только через функции этого модуля.
#  Это даёт единое место для миграций, логирования и контроля целостности.
# ============================================================================

import os
import aiosqlite
from typing import Optional, List, Dict, Any

# ---------------------------------------------------------------------------
#  Путь к файлу БД берём из переменной окружения, выставленной в bot.py.
#  Если переменной нет — используем дефолтное имя в текущей директории.
# ---------------------------------------------------------------------------
DB_PATH: str = os.getenv("DB_PATH", "gosuslugi.db")


# ===========================================================================
#  ИНИЦИАЛИЗАЦИЯ СХЕМЫ
# ===========================================================================

async def init_db() -> None:
    """
    Создаёт все таблицы, если их ещё нет. Вызывается один раз при старте
    приложения (см. lifespan в bot.py). Идемпотентно — повторный вызов
    ничего не ломает.
    """
    async with aiosqlite.connect(DB_PATH) as db:
        # Включаем поддержку внешних ключей в SQLite (по умолчанию выключена).
        await db.execute("PRAGMA foreign_keys = ON;")

        # ----------------------- users -------------------------------------
        await db.execute("""
            CREATE TABLE IF NOT EXISTS users (
                id              INTEGER PRIMARY KEY AUTOINCREMENT,
                username        TEXT    UNIQUE NOT NULL,
                password        TEXT    NOT NULL DEFAULT 'admin',
                is_first_login  INTEGER NOT NULL DEFAULT 1,
                pin_code        TEXT    NOT NULL DEFAULT '0000',
                role            TEXT    NOT NULL DEFAULT 'user'
            );
        """)

        # ----------------------- passports ---------------------------------
        await db.execute("""
            CREATE TABLE IF NOT EXISTS passports (
                user_id                  INTEGER PRIMARY KEY,
                fio                      TEXT NOT NULL DEFAULT 'Не указано',
                birth_date               TEXT NOT NULL DEFAULT 'Не указано',
                birth_place              TEXT NOT NULL DEFAULT 'Не указано',
                passport_series_number   TEXT NOT NULL DEFAULT 'Не указано',
                subdivision_code         TEXT NOT NULL DEFAULT 'Не указано',
                issued_by                TEXT NOT NULL DEFAULT 'Не указано',
                issue_date               TEXT NOT NULL DEFAULT 'Не указано',
                gender                   TEXT NOT NULL DEFAULT 'Не указано',
                photo_path               TEXT NOT NULL DEFAULT '',
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            );
        """)

        # Миграция для уже существующих БД: добавляем gender, если его нет.
        try:
            await db.execute(
                "ALTER TABLE passports ADD COLUMN gender TEXT NOT NULL DEFAULT 'Не указано'"
            )
        except Exception:
            # Колонка уже есть — это нормально.
            pass

        # ----------------------- notifications -----------------------------
        await db.execute("""
            CREATE TABLE IF NOT EXISTS notifications (
                id       INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id  INTEGER NOT NULL,
                text     TEXT    NOT NULL,
                is_read  INTEGER NOT NULL DEFAULT 0,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            );
        """)

        # ----------------------- fines -------------------------------------
        await db.execute("""
            CREATE TABLE IF NOT EXISTS fines (
                id       INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id  INTEGER NOT NULL,
                title    TEXT    NOT NULL DEFAULT 'Штраф',
                amount   INTEGER NOT NULL DEFAULT 0,
                date     TEXT    NOT NULL DEFAULT '',
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            );
        """)

        await db.commit()


# ===========================================================================
#  ПОЛЬЗОВАТЕЛИ
# ===========================================================================

async def get_user_by_username(username: str) -> Optional[Dict[str, Any]]:
    """
    Возвращает строку из users в виде dict либо None.
    Имена колонок берутся прямо из cursor.description, чтобы не дублировать
    список полей в коде (меньше ошибок при изменении схемы).
    """
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT * FROM users WHERE username = ?", (username,)
        ) as cur:
            row = await cur.fetchone()
            return dict(row) if row else None


async def create_user(username: str, role: str = "user") -> int:
    """
    Создаёт пустую запись в users + дочерние записи в passports и notifications.
    Все поля паспорта заполняются дефолтами 'Не указано', чтобы фронтенд
    мог сразу отрисовать карточку без пустых полей.

    Возвращает id созданного пользователя.
    Если пользователь уже существует — возвращает его id и НИЧЕГО не пересоздаёт.
    """
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("PRAGMA foreign_keys = ON;")

        # Если уже есть — отдаём существующий id.
        async with db.execute(
            "SELECT id FROM users WHERE username = ?", (username,)
        ) as cur:
            existing = await cur.fetchone()
            if existing:
                return int(existing[0])

        # Создаём users.
        cur = await db.execute(
            "INSERT INTO users (username, role) VALUES (?, ?);",
            (username, role),
        )
        user_id = cur.lastrowid

        # Создаём паспорт-заглушку.
        await db.execute(
            "INSERT INTO passports (user_id) VALUES (?);", (user_id,)
        )

        # Стартовое уведомление, чтобы у пользователя был непрочитанный
        # колокольчик при первом входе.
        await db.execute(
            "INSERT INTO notifications (user_id, text) VALUES (?, ?);",
            (
                user_id,
                "Добро пожаловать на портал Госуслуги. "
                "При первом входе используйте пароль admin, после смените его.",
            ),
        )

        await db.commit()
        return int(user_id)


async def verify_password(username: str, password: str) -> bool:
    """
    Проверяет связку username+password. При успехе сбрасывает is_first_login=0
    (даже если он уже был 0 — это безопасно).
    """
    async with aiosqlite.connect(DB_PATH) as db:
        async with db.execute(
            "SELECT password FROM users WHERE username = ?", (username,)
        ) as cur:
            row = await cur.fetchone()
            if not row:
                return False
            if row[0] != password:
                return False

        await db.execute(
            "UPDATE users SET is_first_login = 0 WHERE username = ?",
            (username,),
        )
        await db.commit()
        return True


async def set_password(username: str, new_password: str) -> bool:
    async with aiosqlite.connect(DB_PATH) as db:
        cur = await db.execute(
            "UPDATE users SET password = ? WHERE username = ?",
            (new_password, username),
        )
        await db.commit()
        return cur.rowcount > 0


async def verify_pin(username: str, pin: str) -> bool:
    async with aiosqlite.connect(DB_PATH) as db:
        async with db.execute(
            "SELECT pin_code FROM users WHERE username = ?", (username,)
        ) as cur:
            row = await cur.fetchone()
            return bool(row and row[0] == pin)


async def set_pin(username: str, new_pin: str) -> bool:
    async with aiosqlite.connect(DB_PATH) as db:
        cur = await db.execute(
            "UPDATE users SET pin_code = ? WHERE username = ?",
            (new_pin, username),
        )
        await db.commit()
        return cur.rowcount > 0


async def is_admin(username: str) -> bool:
    user = await get_user_by_username(username)
    return bool(user and user["role"] == "admin")


async def set_admin(username: str) -> bool:
    async with aiosqlite.connect(DB_PATH) as db:
        cur = await db.execute(
            "UPDATE users SET role = 'admin' WHERE username = ?", (username,)
        )
        await db.commit()
        return cur.rowcount > 0


# ===========================================================================
#  ПАСПОРТ
# ===========================================================================

# Белый список колонок passports, которые можно править через /api/update_field.
# Не вынести этот список в схему отдельно — значит открыть SQL-инъекцию,
# поэтому жёстко перечисляем тут.
PASSPORT_EDITABLE_FIELDS = {
    "fio",
    "birth_date",
    "birth_place",
    "passport_series_number",
    "subdivision_code",
    "issued_by",
    "issue_date",
    "gender",
}


async def get_passport(user_id: int) -> Optional[Dict[str, Any]]:
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT * FROM passports WHERE user_id = ?", (user_id,)
        ) as cur:
            row = await cur.fetchone()
            return dict(row) if row else None


async def update_passport_field(
    username: str, field: str, value: str
) -> bool:
    """
    Обновляет ОДНО поле паспорта. Имя поля валидируется по белому списку,
    значение биндится через параметр запроса — инъекция невозможна.
    """
    if field not in PASSPORT_EDITABLE_FIELDS:
        return False

    user = await get_user_by_username(username)
    if not user:
        return False

    async with aiosqlite.connect(DB_PATH) as db:
        # Имя колонки берём из проверенного множества, поэтому f-string безопасен.
        cur = await db.execute(
            f"UPDATE passports SET {field} = ? WHERE user_id = ?",
            (value, user["id"]),
        )
        await db.commit()
        return cur.rowcount > 0


async def update_passport_photo(username: str, photo_path: str) -> bool:
    user = await get_user_by_username(username)
    if not user:
        return False
    async with aiosqlite.connect(DB_PATH) as db:
        cur = await db.execute(
            "UPDATE passports SET photo_path = ? WHERE user_id = ?",
            (photo_path, user["id"]),
        )
        await db.commit()
        return cur.rowcount > 0


# ===========================================================================
#  ШТРАФЫ
# ===========================================================================

FINE_EDITABLE_FIELDS = {"title", "amount", "date"}


async def get_fines(user_id: int) -> List[Dict[str, Any]]:
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT * FROM fines WHERE user_id = ? ORDER BY id DESC",
            (user_id,),
        ) as cur:
            rows = await cur.fetchall()
            return [dict(r) for r in rows]


async def add_fine(
    username: str, title: str, amount: int, date: str
) -> Optional[int]:
    user = await get_user_by_username(username)
    if not user:
        return None
    async with aiosqlite.connect(DB_PATH) as db:
        cur = await db.execute(
            "INSERT INTO fines (user_id, title, amount, date) "
            "VALUES (?, ?, ?, ?)",
            (user["id"], title, amount, date),
        )
        await db.commit()
        return cur.lastrowid


async def update_fine_field(fine_id: int, field: str, value: Any) -> bool:
    if field not in FINE_EDITABLE_FIELDS:
        return False
    async with aiosqlite.connect(DB_PATH) as db:
        cur = await db.execute(
            f"UPDATE fines SET {field} = ? WHERE id = ?", (value, fine_id)
        )
        await db.commit()
        return cur.rowcount > 0


async def delete_fine(fine_id: int) -> bool:
    async with aiosqlite.connect(DB_PATH) as db:
        cur = await db.execute("DELETE FROM fines WHERE id = ?", (fine_id,))
        await db.commit()
        return cur.rowcount > 0


async def pay_all_fines(username: str) -> int:
    """
    Удаляет все штрафы пользователя (имитация оплаты).
    Возвращает количество удалённых штрафов.
    """
    user = await get_user_by_username(username)
    if not user:
        return 0
    async with aiosqlite.connect(DB_PATH) as db:
        cur = await db.execute(
            "DELETE FROM fines WHERE user_id = ?", (user["id"],)
        )
        await db.commit()
        # Бонусом — уведомление об оплате.
        await db.execute(
            "INSERT INTO notifications (user_id, text) VALUES (?, ?)",
            (user["id"], "Все начисления успешно оплачены."),
        )
        await db.commit()
        return cur.rowcount


# ===========================================================================
#  УВЕДОМЛЕНИЯ
# ===========================================================================

async def get_notifications(user_id: int) -> List[Dict[str, Any]]:
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT * FROM notifications WHERE user_id = ? ORDER BY id DESC",
            (user_id,),
        ) as cur:
            rows = await cur.fetchall()
            return [dict(r) for r in rows]


async def mark_notifications_read(user_id: int) -> int:
    async with aiosqlite.connect(DB_PATH) as db:
        cur = await db.execute(
            "UPDATE notifications SET is_read = 1 "
            "WHERE user_id = ? AND is_read = 0",
            (user_id,),
        )
        await db.commit()
        return cur.rowcount


async def add_notification(username: str, text: str) -> Optional[int]:
    user = await get_user_by_username(username)
    if not user:
        return None
    async with aiosqlite.connect(DB_PATH) as db:
        cur = await db.execute(
            "INSERT INTO notifications (user_id, text) VALUES (?, ?)",
            (user["id"], text),
        )
        await db.commit()
        return cur.lastrowid


# ===========================================================================
#  АГРЕГАТНЫЙ ЗАПРОС ДЛЯ /api/get_data
# ===========================================================================

async def get_full_user_data(username: str) -> Optional[Dict[str, Any]]:
    """
    Один-в-один объект, который ждёт фронтенд: профиль + паспорт + штрафы
    + уведомления. Возвращает None, если пользователя нет.
    """
    user = await get_user_by_username(username)
    if not user:
        return None

    passport = await get_passport(user["id"])
    fines = await get_fines(user["id"])
    notifications = await get_notifications(user["id"])

    return {
        "user": {
            "id": user["id"],
            "username": user["username"],
            "role": user["role"],
            "is_first_login": bool(user["is_first_login"]),
        },
        "passport": passport or {},
        "fines": fines,
        "notifications": notifications,
    }


async def list_all_users() -> List[Dict[str, Any]]:
    """
    Список всех пользователей с краткой инфой для админ-панели.
    Возвращает [{username, role, fio, photo_path}].
    """
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT u.username, u.role, "
            "       COALESCE(p.fio, 'Не указано') AS fio, "
            "       COALESCE(p.photo_path, '') AS photo_path "
            "FROM users u "
            "LEFT JOIN passports p ON p.user_id = u.id "
            "ORDER BY u.username"
        ) as cur:
            rows = await cur.fetchall()
            return [dict(r) for r in rows]
