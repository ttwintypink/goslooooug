# ============================================================================
#  bot.py — Главная точка входа проекта "ГосУслуги RP".
#
#  В одном процессе одновременно крутятся:
#    1) Telegram-бот (aiogram 3.x) — обрабатывает /start и админ-команду /add.
#    2) FastAPI на Uvicorn — отдаёт статику Web App и обрабатывает API.
#
#  Запуск: python bot.py
#  Деплой на BotHost (Linux): просто `python3 bot.py` под systemd/screen/pm2.
# ============================================================================

import os
import sys
import asyncio
import logging
import secrets
import mimetypes
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Optional

from dotenv import load_dotenv

# --- Подгружаем .env ДО импорта database, чтобы DB_PATH успел подцепиться. ---
load_dotenv()

# aiogram 3.x
from aiogram import Bot, Dispatcher, F
from aiogram.client.default import DefaultBotProperties
from aiogram.enums import ParseMode
from aiogram.filters import Command, CommandStart
from aiogram.types import (
    Message,
    InlineKeyboardButton,
    InlineKeyboardMarkup,
    WebAppInfo,
)

# FastAPI
from fastapi import FastAPI, Request, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, FileResponse
from fastapi.staticfiles import StaticFiles
import uvicorn

# Локальные модули
import database as db


# ===========================================================================
#  КОНФИГУРАЦИЯ
# ===========================================================================

BOT_TOKEN: str = os.getenv("BOT_TOKEN", "").strip()
API_HOST: str = os.getenv("API_HOST", "0.0.0.0").strip()
# BotHost.ru пробрасывает порт через PORT — он имеет приоритет.
# Затем смотрим API_PORT, и только потом дефолт 3000.
API_PORT: int = int(os.getenv("PORT", os.getenv("API_PORT", "3000")))
WEBAPP_URL: str = os.getenv("WEBAPP_URL", "").strip()
ROOT_ADMIN_USERNAME: str = (
    os.getenv("ROOT_ADMIN_USERNAME", "").strip().lstrip("@")
)
UPLOADS_DIR: str = os.getenv("UPLOADS_DIR", "uploads").strip()

# Путь до webapp-папки, чтобы FastAPI смог отдать статику.
PROJECT_ROOT = Path(__file__).resolve().parent
WEBAPP_DIR = PROJECT_ROOT / "webapp"
UPLOADS_PATH = PROJECT_ROOT / UPLOADS_DIR
UPLOADS_PATH.mkdir(parents=True, exist_ok=True)


# Минимальная валидация конфига — без неё ловить ошибки в рантайме хуже.
if not BOT_TOKEN or BOT_TOKEN == "PUT_YOUR_BOT_TOKEN_HERE":
    print(
        "[FATAL] BOT_TOKEN не задан в .env — бот не сможет авторизоваться "
        "в Telegram. Заполни .env и перезапусти.",
        file=sys.stderr,
    )
    sys.exit(1)


# ===========================================================================
#  ЛОГИРОВАНИЕ
# ===========================================================================

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
log = logging.getLogger("gosuslugi")


# ===========================================================================
#  AIOGRAM: БОТ И ДИСПЕТЧЕР
# ===========================================================================

bot = Bot(
    token=BOT_TOKEN,
    default=DefaultBotProperties(parse_mode=ParseMode.HTML),
)
dp = Dispatcher()


# ---------------------------- /start ---------------------------------------

@dp.message(CommandStart())
async def cmd_start(message: Message) -> None:
    """
    /start — выдаёт кнопку с Web App. Кнопка ВСЕГДА синяя, как принято в TG.
    Если у пользователя нет username, Web App не сможет его опознать —
    предупреждаем заранее.
    """
    user = message.from_user
    if not user or not user.username:
        await message.answer(
            "У вашего Telegram-аккаунта не задан username.\n"
            "Откройте настройки Telegram → «Имя пользователя» и задайте его, "
            "иначе Web App не сможет вас авторизовать."
        )
        return

    if not WEBAPP_URL:
        await message.answer(
            "WEBAPP_URL не настроен на сервере. Сообщите администратору."
        )
        return

    kb = InlineKeyboardMarkup(
        inline_keyboard=[
            [
                InlineKeyboardButton(
                    text="Открыть Госуслуги",
                    web_app=WebAppInfo(url=WEBAPP_URL),
                )
            ]
        ]
    )

    await message.answer(
        f"Здравствуйте, <b>{user.full_name}</b>.\n"
        f"Нажмите кнопку ниже, чтобы войти на портал «Госуслуги».",
        reply_markup=kb,
    )


# ---------------------------- /add @username -------------------------------

@dp.message(Command("add"))
async def cmd_add(message: Message) -> None:
    """
    /add @username — создаёт пустой аккаунт пользователя.
    Доступна только тем, у кого role='admin' в БД.
    """
    if not message.from_user or not message.from_user.username:
        await message.answer("Команда доступна только пользователям с username.")
        return

    sender_username = message.from_user.username
    if not await db.is_admin(sender_username):
        await message.answer("Команда доступна только администраторам.")
        return

    # Парсим аргументы: «/add @ivan» или «/add ivan».
    args = (message.text or "").split(maxsplit=1)
    if len(args) < 2:
        await message.answer("Использование: <code>/add @username</code>")
        return

    target = args[1].strip().lstrip("@")
    if not target or " " in target:
        await message.answer("Некорректный username.")
        return

    existed = await db.get_user_by_username(target)
    if existed:
        await message.answer(
            f"Пользователь @{target} уже существует в базе (id={existed['id']})."
        )
        return

    user_id = await db.create_user(target, role="user")
    await message.answer(
        f"Готово. Пользователь @{target} добавлен (id={user_id}).\n"
        f"Пароль по умолчанию: <code>admin</code>\n"
        f"PIN-код по умолчанию: <code>0000</code>"
    )


# ---------------------------- /makeadmin @username -------------------------

@dp.message(Command("makeadmin"))
async def cmd_makeadmin(message: Message) -> None:
    """Дополнительная команда, чтобы повысить уже существующего пользователя."""
    if not message.from_user or not message.from_user.username:
        return
    if not await db.is_admin(message.from_user.username):
        await message.answer("Команда доступна только администраторам.")
        return

    args = (message.text or "").split(maxsplit=1)
    if len(args) < 2:
        await message.answer("Использование: <code>/makeadmin @username</code>")
        return

    target = args[1].strip().lstrip("@")
    if not await db.get_user_by_username(target):
        await db.create_user(target, role="admin")
        await message.answer(f"@{target} создан и сразу назначен админом.")
        return

    if await db.set_admin(target):
        await message.answer(f"@{target} теперь администратор.")
    else:
        await message.answer("Не удалось обновить роль.")


# ===========================================================================
#  FASTAPI: API + СТАТИКА
# ===========================================================================

@asynccontextmanager
async def lifespan(_: FastAPI):
    """
    На старте приложения создаём таблицы и поднимаем root-админа,
    указанного в .env. На завершении — ничего особенного, aiosqlite
    закрывает соединения сам.
    """
    await db.init_db()
    if ROOT_ADMIN_USERNAME:
        existing = await db.get_user_by_username(ROOT_ADMIN_USERNAME)
        if not existing:
            await db.create_user(ROOT_ADMIN_USERNAME, role="admin")
            log.info("Создан root-админ @%s", ROOT_ADMIN_USERNAME)
        elif existing["role"] != "admin":
            await db.set_admin(ROOT_ADMIN_USERNAME)
            log.info("Пользователь @%s повышен до admin", ROOT_ADMIN_USERNAME)
    yield


api = FastAPI(title="ГосУслуги RP API", lifespan=lifespan)

# CORS открываем полностью: Web App грузится с того же origin, что и API,
# но Telegram иногда подменяет referer — лучше не упираться в preflight.
api.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
    allow_credentials=False,
)


# --- No-cache для всей статики, чтобы каждый раз отдавалась 200 OK -------
# 304 не ошибка, но при активной разработке хочется видеть, что свежие
# файлы реально доходят до клиента.
@api.middleware("http")
async def no_cache_static(request: Request, call_next):
    response = await call_next(request)
    path = request.url.path
    if path.startswith(("/api/", "/uploads/")):
        return response
    response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
    response.headers["Pragma"] = "no-cache"
    response.headers["Expires"] = "0"
    return response


# ----------------------- helpers -------------------------------------------

def _clean_username(value: Optional[str]) -> str:
    if not value:
        return ""
    return value.strip().lstrip("@")


async def _require_admin(username: str) -> None:
    """Бросает 403, если пользователь не админ. Используется в защищённых ручках."""
    if not username or not await db.is_admin(username):
        raise HTTPException(status_code=403, detail="Доступ запрещён")


# ----------------------- /api/auth -----------------------------------------

@api.post("/api/auth")
async def api_auth(payload: dict) -> JSONResponse:
    """
    Принимает { "username": "..." }.
    Возвращает базовый статус: существует ли пользователь, нужно ли первичную
    авторизацию по паролю или сразу можно показывать PIN-экран.
    """
    username = _clean_username(payload.get("username"))
    if not username:
        raise HTTPException(status_code=400, detail="username обязателен")

    user = await db.get_user_by_username(username)
    if not user:
        return JSONResponse(
            {
                "ok": False,
                "exists": False,
                "message": (
                    "Аккаунт не найден. Обратитесь к администрации сервера, "
                    "чтобы он добавил вас командой /add."
                ),
            }
        )

    return JSONResponse(
        {
            "ok": True,
            "exists": True,
            "username": user["username"],
            "is_first_login": bool(user["is_first_login"]),
            "role": user["role"],
        }
    )


# ----------------------- /api/verify_password ------------------------------

@api.post("/api/verify_password")
async def api_verify_password(payload: dict) -> JSONResponse:
    """
    Принимает { username, password }.
    На успехе сбрасывает is_first_login=0.
    """
    username = _clean_username(payload.get("username"))
    password = (payload.get("password") or "").strip()
    if not username or not password:
        raise HTTPException(status_code=400, detail="username и password обязательны")

    ok = await db.verify_password(username, password)
    return JSONResponse({"ok": ok})


# ----------------------- /api/verify_pin -----------------------------------

@api.post("/api/verify_pin")
async def api_verify_pin(payload: dict) -> JSONResponse:
    username = _clean_username(payload.get("username"))
    pin = (payload.get("pin") or "").strip()
    if not username or len(pin) != 4 or not pin.isdigit():
        raise HTTPException(status_code=400, detail="Неверный формат PIN")

    ok = await db.verify_pin(username, pin)
    return JSONResponse({"ok": ok})


# ----------------------- /api/set_pin --------------------------------------

@api.post("/api/set_pin")
async def api_set_pin(payload: dict) -> JSONResponse:
    """
    Принимает { username, pin }. Сохраняет PIN после первичной авторизации.
    """
    username = _clean_username(payload.get("username"))
    pin = (payload.get("pin") or "").strip()
    if not username or len(pin) != 4 or not pin.isdigit():
        raise HTTPException(status_code=400, detail="Неверный формат PIN")

    ok = await db.set_pin(username, pin)
    if not ok:
        raise HTTPException(status_code=404, detail="Пользователь не найден")
    return JSONResponse({"ok": True})


# ----------------------- /api/get_data -------------------------------------

@api.post("/api/get_data")
async def api_get_data(payload: dict) -> JSONResponse:
    username = _clean_username(payload.get("username"))
    target   = _clean_username(payload.get("target")) or username
    if not username:
        raise HTTPException(status_code=400, detail="username обязателен")

    # Если просят чужие данные — нужен админ.
    if target != username:
        await _require_admin(username)

    data = await db.get_full_user_data(target)
    if not data:
        raise HTTPException(status_code=404, detail="Пользователь не найден")
    return JSONResponse(data)


# ----------------------- /api/admin/list_users (admin) ---------------------

@api.post("/api/admin/list_users")
async def api_admin_list_users(payload: dict) -> JSONResponse:
    """Список всех пользователей для админ-панели."""
    admin_username = _clean_username(payload.get("admin_username"))
    await _require_admin(admin_username)
    users = await db.list_all_users()
    return JSONResponse({"users": users})


# ----------------------- /api/mark_read ------------------------------------

@api.post("/api/mark_read")
async def api_mark_read(payload: dict) -> JSONResponse:
    """Помечает все уведомления пользователя прочитанными."""
    username = _clean_username(payload.get("username"))
    user = await db.get_user_by_username(username) if username else None
    if not user:
        raise HTTPException(status_code=404, detail="Пользователь не найден")
    cnt = await db.mark_notifications_read(user["id"])
    return JSONResponse({"ok": True, "updated": cnt})


# ----------------------- /api/pay_fines ------------------------------------

@api.post("/api/pay_fines")
async def api_pay_fines(payload: dict) -> JSONResponse:
    """Имитация оплаты штрафов — просто чистит таблицу штрафов пользователя."""
    username = _clean_username(payload.get("username"))
    if not username:
        raise HTTPException(status_code=400, detail="username обязателен")
    paid = await db.pay_all_fines(username)
    return JSONResponse({"ok": True, "paid": paid})


# ----------------------- /api/update_field (admin) -------------------------

@api.post("/api/update_field")
async def api_update_field(payload: dict) -> JSONResponse:
    """
    Принимает { admin_username, target_username, entity, field, value, [fine_id] }.
    entity ∈ {"passport", "fine"}.
    """
    admin_username = _clean_username(payload.get("admin_username"))
    target_username = _clean_username(payload.get("target_username"))
    entity = (payload.get("entity") or "").strip()
    field = (payload.get("field") or "").strip()
    value = payload.get("value")

    await _require_admin(admin_username)

    if not target_username:
        raise HTTPException(status_code=400, detail="target_username обязателен")

    if entity == "passport":
        ok = await db.update_passport_field(target_username, field, str(value))
        if not ok:
            raise HTTPException(
                status_code=400,
                detail="Неверное поле паспорта или пользователь не найден",
            )
        return JSONResponse({"ok": True})

    if entity == "fine":
        fine_id = payload.get("fine_id")
        if not isinstance(fine_id, int):
            raise HTTPException(status_code=400, detail="fine_id обязателен")
        # amount храним как INT.
        if field == "amount":
            try:
                value = int(value)
            except (TypeError, ValueError):
                raise HTTPException(status_code=400, detail="amount должен быть числом")
        ok = await db.update_fine_field(fine_id, field, value)
        if not ok:
            raise HTTPException(status_code=400, detail="Не удалось обновить штраф")
        return JSONResponse({"ok": True})

    raise HTTPException(status_code=400, detail="entity ∈ {passport, fine}")


# ----------------------- /api/add_fine (admin) -----------------------------

@api.post("/api/add_fine")
async def api_add_fine(payload: dict) -> JSONResponse:
    admin_username = _clean_username(payload.get("admin_username"))
    target_username = _clean_username(payload.get("target_username"))
    title = (payload.get("title") or "Штраф").strip()
    date = (payload.get("date") or "").strip()
    try:
        amount = int(payload.get("amount") or 0)
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="amount должен быть числом")

    await _require_admin(admin_username)

    fine_id = await db.add_fine(target_username, title, amount, date)
    if not fine_id:
        raise HTTPException(status_code=404, detail="Пользователь не найден")
    return JSONResponse({"ok": True, "id": fine_id})


# ----------------------- /api/delete_fine (admin) --------------------------

@api.post("/api/delete_fine")
async def api_delete_fine(payload: dict) -> JSONResponse:
    admin_username = _clean_username(payload.get("admin_username"))
    fine_id = payload.get("fine_id")
    await _require_admin(admin_username)
    if not isinstance(fine_id, int):
        raise HTTPException(status_code=400, detail="fine_id обязателен")
    ok = await db.delete_fine(fine_id)
    return JSONResponse({"ok": ok})


# ----------------------- /api/upload_photo (admin) -------------------------

# Допустимые MIME для фото паспорта.
_ALLOWED_IMAGE_MIME = {"image/jpeg", "image/png", "image/webp"}
_MAX_PHOTO_BYTES = 5 * 1024 * 1024  # 5 МБ


@api.post("/api/upload_photo")
async def api_upload_photo(
    admin_username: str = Form(...),
    target_username: str = Form(...),
    file: UploadFile = File(...),
) -> JSONResponse:
    """
    Multipart-загрузка фото паспорта. Файл сохраняется в /uploads под
    случайным именем (предотвращает path traversal и коллизии),
    путь записывается в passports.photo_path.
    """
    admin_username = _clean_username(admin_username)
    target_username = _clean_username(target_username)

    await _require_admin(admin_username)

    if file.content_type not in _ALLOWED_IMAGE_MIME:
        raise HTTPException(
            status_code=400,
            detail=f"Недопустимый тип файла: {file.content_type}",
        )

    # Читаем файл целиком в память, проверяем размер.
    content = await file.read()
    if len(content) > _MAX_PHOTO_BYTES:
        raise HTTPException(status_code=413, detail="Файл больше 5 МБ")
    if not content:
        raise HTTPException(status_code=400, detail="Пустой файл")

    # Расширение определяем по MIME, а не по имени, чтобы не доверять клиенту.
    ext = mimetypes.guess_extension(file.content_type) or ".jpg"
    if ext == ".jpe":
        ext = ".jpg"

    # Безопасное случайное имя.
    safe_name = f"{secrets.token_hex(16)}{ext}"
    full_path = UPLOADS_PATH / safe_name

    # Защита от выхода за пределы папки (на всякий случай).
    if not str(full_path.resolve()).startswith(str(UPLOADS_PATH.resolve())):
        raise HTTPException(status_code=400, detail="Некорректный путь")

    with open(full_path, "wb") as f:
        f.write(content)

    public_path = f"/uploads/{safe_name}"
    ok = await db.update_passport_photo(target_username, public_path)
    if not ok:
        # Если в БД не записалось, файл с диска удалим, чтобы не плодить мусор.
        try:
            full_path.unlink(missing_ok=True)
        except Exception:
            pass
        raise HTTPException(status_code=404, detail="Пользователь не найден")

    return JSONResponse({"ok": True, "photo_path": public_path})


# ----------------------- СТАТИКА -------------------------------------------

# Загруженные файлы. Монтируем ПЕРВЫМ — иначе общий mount на "/" перехватит.
api.mount("/uploads", StaticFiles(directory=str(UPLOADS_PATH)), name="uploads")

# Фронтенд Web App. Монтируем на корень, чтобы относительные пути из HTML
# (style.css, js/common.js, ...) разрешались без префикса /webapp/.
# POST-роуты /api/* регистрируются раньше и не перехватываются StaticFiles.
if WEBAPP_DIR.exists():
    api.mount(
        "/",
        StaticFiles(directory=str(WEBAPP_DIR), html=True),
        name="webapp",
    )
else:
    log.warning("Папка webapp/ не найдена — статика отключена.")


# ===========================================================================
#  ЗАПУСК: aiogram + uvicorn в одном event loop
# ===========================================================================

async def _run_uvicorn() -> None:
    config = uvicorn.Config(
        app=api,
        host=API_HOST,
        port=API_PORT,
        log_level="info",
        # access_log можно выключить на проде, чтобы лог не пух.
        access_log=True,
    )
    server = uvicorn.Server(config)
    await server.serve()


async def _run_aiogram() -> None:
    # На всякий случай удаляем вебхук, чтобы long polling точно работал.
    await bot.delete_webhook(drop_pending_updates=True)
    await dp.start_polling(bot, allowed_updates=dp.resolve_used_update_types())


async def main() -> None:
    log.info("Запуск ГосУслуги RP. API на http://%s:%s", API_HOST, API_PORT)
    log.info("Статика Web App: %s", WEBAPP_DIR)
    log.info("Загрузки: %s", UPLOADS_PATH)

    # gather с return_exceptions=False — если падает любая из задач,
    # падает всё. Это нам и нужно: процесс рестартует целиком.
    await asyncio.gather(_run_uvicorn(), _run_aiogram())


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except (KeyboardInterrupt, SystemExit):
        log.info("Остановка.")
